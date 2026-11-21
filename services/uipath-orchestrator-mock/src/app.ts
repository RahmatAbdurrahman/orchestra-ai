import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { RobotSystemError, type RobotOutputs } from './robot';

/**
 * DEVELOPMENT / TEST ONLY.
 * Implements the subset of the UiPath Orchestrator API that Orchestra AI uses:
 *   POST /identity_/connect/token                                  (client credentials)
 *   GET  /odata/Releases?$filter=Name eq '...'
 *   POST /odata/Jobs/UiPath.Server.Configuration.OData.StartJobs
 *   GET  /odata/Jobs(<id>)
 *   GET  /odata/Jobs?$filter=Reference eq '...'
 *   POST /odata/Jobs/UiPath.Server.Configuration.OData.StopJobs
 * Results produced here are NOT evidence that a real UiPath robot works.
 */

export const SCENARIO_MODES = [
  'success',
  'fault',
  'fault-after-erp',
  'business-error',
  'robot-unavailable',
  'submit-timeout',
  'submit-error',
] as const;
export type ScenarioMode = (typeof SCENARIO_MODES)[number];

export interface MockRobot {
  createPurchaseOrder(inputArguments: Record<string, unknown>): Promise<RobotOutputs>;
}

export interface OrchestratorMockOptions {
  clientId: string;
  clientSecret: string;
  folderId: string;
  processes: string[];
  adminToken: string;
  robot: MockRobot;
  pendingMs?: number;
  runMs?: number;
  /** How long StartJobs stalls in the "submit-timeout" scenario. */
  submitTimeoutDelayMs?: number;
}

export interface MockJob {
  Id: number;
  Key: string;
  State: 'Pending' | 'Running' | 'Successful' | 'Faulted' | 'Stopped';
  Reference: string | null;
  ReleaseName: string;
  ReleaseKey: string;
  InputArguments: string;
  OutputArguments: string | null;
  Info: string | null;
  CreationTime: string;
  StartTime: string | null;
  EndTime: string | null;
  HostMachineName: string | null;
  JobError: { Code: string; Category: string; Title: string; Details: string } | null;
  scenario: ScenarioMode;
  timers: NodeJS.Timeout[];
}

function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

function releaseKey(name: string): string {
  const hex = createHash('sha256').update(`release:${name}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Parses `Field eq 'value'` from an OData $filter. */
function parseEqFilter(filter: unknown, field: string): string | null {
  if (typeof filter !== 'string') return null;
  const match = new RegExp(`${field}\\s+eq\\s+'((?:[^']|'')*)'`).exec(filter);
  return match ? match[1]!.replace(/''/g, "'") : null;
}

export interface OrchestratorMock {
  app: Express;
  jobs: Map<number, MockJob>;
  scenarios: Array<{ mode: ScenarioMode; remaining: number }>;
  close: () => void;
}

export function createOrchestratorMock(options: OrchestratorMockOptions): OrchestratorMock {
  const app = express();
  const tokens = new Map<string, number>();
  const jobs = new Map<number, MockJob>();
  const scenarios: Array<{ mode: ScenarioMode; remaining: number }> = [];
  let nextId = 1000;
  const pendingMs = options.pendingMs ?? 1_500;
  const runMs = options.runMs ?? 2_500;

  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-UiPath-Mock', 'true');
    next();
  });

  const view = (job: MockJob) => {
    const { scenario: _scenario, timers: _timers, ...rest } = job;
    return rest;
  };

  const takeScenario = (): ScenarioMode => {
    const next = scenarios[0];
    if (!next) return 'success';
    next.remaining -= 1;
    if (next.remaining <= 0) scenarios.shift();
    return next.mode;
  };

  const finish = (job: MockJob, state: MockJob['State'], patch: Partial<MockJob> = {}) => {
    if (job.State === 'Successful' || job.State === 'Faulted' || job.State === 'Stopped') return;
    Object.assign(job, patch, { State: state, EndTime: new Date().toISOString() });
  };

  const runRobot = async (job: MockJob) => {
    if (job.State !== 'Running') return;
    let inputArguments: Record<string, unknown> = {};
    try {
      inputArguments = JSON.parse(job.InputArguments) as Record<string, unknown>;
    } catch {
      // handled below by the robot
    }
    if (job.scenario === 'fault') {
      finish(job, 'Faulted', {
        Info: 'System.Exception: Could not find the UI element #submit-po (simulated selector failure)',
        JobError: { Code: 'Robot.SelectorNotFound', Category: 'System', Title: 'Selector not found', Details: '#submit-po' },
      });
      return;
    }
    if (job.scenario === 'business-error') {
      finish(job, 'Successful', {
        OutputArguments: JSON.stringify({
          out_Status: 'BUSINESS_ERROR',
          out_PoNumber: null,
          out_IdempotencyKey: inputArguments.in_IdempotencyKey ?? null,
          out_ErpReference: null,
          out_Message: 'Simulated business exception: vendor is on hold in the ERP',
          out_ScreenshotPath: null,
        }),
      });
      return;
    }
    try {
      const outputs = await options.robot.createPurchaseOrder(inputArguments);
      if (job.State !== 'Running') return; // stopped meanwhile
      if (job.scenario === 'fault-after-erp') {
        finish(job, 'Faulted', {
          Info: `System.Exception: Robot crashed after the ERP accepted the order (${outputs.out_PoNumber}); result not reported (simulated)`,
          JobError: { Code: 'Robot.Crashed', Category: 'System', Title: 'Robot process crashed', Details: 'Simulated crash after submit' },
        });
        return;
      }
      finish(job, 'Successful', { OutputArguments: JSON.stringify(outputs) });
    } catch (error) {
      const message = error instanceof RobotSystemError ? error.message : (error as Error).message;
      finish(job, 'Faulted', {
        Info: `System.Exception: ${message}`,
        JobError: { Code: 'Robot.SystemException', Category: 'System', Title: 'System exception', Details: message },
      });
    }
  };

  const schedule = (job: MockJob) => {
    if (job.scenario === 'robot-unavailable') return; // stays Pending until stopped
    job.timers.push(
      setTimeout(() => {
        if (job.State !== 'Pending') return;
        job.State = 'Running';
        job.StartTime = new Date().toISOString();
        job.HostMachineName = 'SIM-ROBOT-01';
        job.timers.push(setTimeout(() => void runRobot(job), runMs));
      }, pendingMs),
    );
  };

  // --- Identity ---------------------------------------------------------------
  app.post('/identity_/connect/token', (req, res) => {
    const body = (req.body ?? {}) as Record<string, string>;
    if (body.grant_type !== 'client_credentials') {
      res.status(400).json({ error: 'unsupported_grant_type' });
      return;
    }
    if (!safeEqual(body.client_id ?? '', options.clientId) || !safeEqual(body.client_secret ?? '', options.clientSecret)) {
      res.status(400).json({ error: 'invalid_client' });
      return;
    }
    const token = randomBytes(24).toString('hex');
    tokens.set(token, Date.now() + 3600_000);
    res.json({ access_token: token, expires_in: 3600, token_type: 'Bearer', scope: body.scope ?? '' });
  });

  // --- OData ------------------------------------------------------------------
  const authenticate = (req: Request, res: Response, next: NextFunction) => {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const expiresAt = tokens.get(token);
    if (!expiresAt || expiresAt < Date.now()) {
      res.status(401).json({ message: 'You are not authenticated!', errorCode: 0 });
      return;
    }
    if (req.header('x-uipath-organizationunitid') !== options.folderId) {
      res.status(403).json({ message: 'Folder does not exist or the user does not have access to the folder', errorCode: 1100 });
      return;
    }
    next();
  };

  app.use('/odata', authenticate, (req, res) => {
    const path = req.path;
    if (req.method === 'GET' && path === '/Releases') {
      const name = parseEqFilter(req.query.$filter, 'Name');
      const value = options.processes
        .filter((process) => name === null || process === name)
        .map((process) => ({ Key: releaseKey(process), Name: process, ProcessKey: process, ProcessVersion: '1.0.0' }));
      res.json({ '@odata.context': 'mock/$metadata#Releases', value });
      return;
    }

    if (req.method === 'POST' && path === '/Jobs/UiPath.Server.Configuration.OData.StartJobs') {
      const startInfo = ((req.body ?? {}) as { startInfo?: Record<string, unknown> }).startInfo ?? {};
      const process = options.processes.find((candidate) => releaseKey(candidate) === startInfo.ReleaseKey);
      if (!process) {
        res.status(400).json({ message: 'Release not found', errorCode: 1002 });
        return;
      }
      const scenario = takeScenario();
      if (scenario === 'submit-error') {
        res.status(500).json({ message: 'Simulated Orchestrator error; no job was created', errorCode: 9999 });
        return;
      }
      const job: MockJob = {
        Id: nextId++,
        Key: randomUUID(),
        State: 'Pending',
        Reference: typeof startInfo.Reference === 'string' ? startInfo.Reference : null,
        ReleaseName: process,
        ReleaseKey: String(startInfo.ReleaseKey),
        InputArguments: typeof startInfo.InputArguments === 'string' ? startInfo.InputArguments : '{}',
        OutputArguments: null,
        Info: null,
        CreationTime: new Date().toISOString(),
        StartTime: null,
        EndTime: null,
        HostMachineName: null,
        JobError: null,
        scenario,
        timers: [],
      };
      jobs.set(job.Id, job);
      schedule(job);
      const respond = () => res.status(201).json({ '@odata.context': 'mock/$metadata#Jobs', value: [view(job)] });
      if (scenario === 'submit-timeout') {
        // The job exists, but the HTTP response arrives after the client has given up.
        setTimeout(() => {
          if (!res.writableEnded && !res.destroyed) respond();
        }, options.submitTimeoutDelayMs ?? 25_000);
        return;
      }
      respond();
      return;
    }

    if (req.method === 'POST' && path === '/Jobs/UiPath.Server.Configuration.OData.StopJobs') {
      const body = (req.body ?? {}) as { jobIds?: Array<number | string> };
      for (const id of body.jobIds ?? []) {
        const job = jobs.get(Number(id));
        if (!job) continue;
        job.timers.forEach(clearTimeout);
        finish(job, 'Stopped', { Info: 'Stopped by API request' });
      }
      res.status(200).json({});
      return;
    }

    const byId = /^\/Jobs\((\d+)\)$/.exec(path);
    if (req.method === 'GET' && byId) {
      const job = jobs.get(Number(byId[1]));
      if (!job) {
        res.status(404).json({ message: 'Job does not exist.', errorCode: 1002 });
        return;
      }
      res.json({ '@odata.context': 'mock/$metadata#Jobs/$entity', ...view(job) });
      return;
    }

    if (req.method === 'GET' && path === '/Jobs') {
      const reference = parseEqFilter(req.query.$filter, 'Reference');
      const top = Number(req.query.$top ?? 100);
      const value = [...jobs.values()]
        .filter((job) => reference === null || job.Reference === reference)
        .sort((a, b) => b.CreationTime.localeCompare(a.CreationTime) || b.Id - a.Id)
        .slice(0, Number.isFinite(top) ? top : 100)
        .map(view);
      res.json({ '@odata.context': 'mock/$metadata#Jobs', value });
      return;
    }

    res.status(404).json({ message: `Mock does not implement ${req.method} /odata${path}` });
  });

  // --- Mock control (scenario injection for tests and demos) -----------------
  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (!safeEqual(req.header('x-mock-admin-token') ?? '', options.adminToken)) {
      res.status(401).json({ error: 'Invalid mock admin token' });
      return;
    }
    next();
  };
  app.get('/__mock/health', (_req, res) => {
    res.json({ status: 'ok', mock: true, jobs: jobs.size });
  });
  app.get('/__mock/state', requireAdmin, (_req, res) => {
    res.json({ scenarios, jobs: [...jobs.values()].map((job) => ({ ...view(job), scenario: job.scenario })) });
  });
  app.post('/__mock/scenarios', requireAdmin, (req, res) => {
    const body = (req.body ?? {}) as { mode?: string; count?: number };
    if (!SCENARIO_MODES.includes(body.mode as ScenarioMode)) {
      res.status(400).json({ error: `mode must be one of ${SCENARIO_MODES.join(', ')}` });
      return;
    }
    const count = Number.isInteger(body.count) && body.count! > 0 ? body.count! : 1;
    scenarios.push({ mode: body.mode as ScenarioMode, remaining: count });
    res.status(201).json({ scenarios });
  });
  app.post('/__mock/reset', requireAdmin, (_req, res) => {
    scenarios.length = 0;
    for (const job of jobs.values()) job.timers.forEach(clearTimeout);
    jobs.clear();
    res.json({ ok: true });
  });

  const close = () => {
    for (const job of jobs.values()) job.timers.forEach(clearTimeout);
  };

  return { app, jobs, scenarios, close };
}
