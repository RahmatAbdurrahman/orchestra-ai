import { normalizeUiPathJobState } from '@orchestra/domain';
import type { UiPathConfig } from './config';
import { errorFromResponse, errorFromTransport, isUiPathApiError, UiPathApiError } from './errors';
import type {
  JobResult,
  JobStatusResult,
  RobotJobError,
  RpaExecutionProvider,
  RpaHealthResult,
  StartJobInput,
  StartJobResult,
} from './types';

type FetchLike = typeof fetch;

export interface UiPathClientLogger {
  debug?(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
}

export interface UiPathClientDependencies {
  fetch?: FetchLike;
  logger?: UiPathClientLogger;
  now?: () => number;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

interface ODataJob {
  Id?: number | string;
  Key?: string;
  State?: string | number;
  Reference?: string | null;
  CreationTime?: string | null;
  StartTime?: string | null;
  EndTime?: string | null;
  Info?: string | null;
  OutputArguments?: string | null;
  HostMachineName?: string | null;
  JobError?: { Code?: string; Category?: string; Title?: string; Detail?: string; Details?: string } | null;
}

const RELEASE_CACHE_TTL_MS = 5 * 60_000;
const TOKEN_EXPIRY_SKEW_MS = 60_000;

function odataString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * UiPath Orchestrator REST/OData client.
 *
 * - Authenticates with OAuth2 client credentials (External Application) and
 *   caches the access token server-side; tokens are never exposed to callers.
 * - Resolves the release key from the process name.
 * - Starts jobs with a per-attempt `Reference` so an ambiguous submission can
 *   be found again (findJobByReference) instead of being submitted twice.
 */
export class UiPathOrchestratorClient implements RpaExecutionProvider {
  private readonly fetchImpl: FetchLike;
  private readonly logger: UiPathClientLogger;
  private readonly now: () => number;
  private token: CachedToken | null = null;
  private tokenRequest: Promise<string> | null = null;
  private readonly releaseKeys = new Map<string, { key: string; cachedAt: number }>();

  constructor(
    private readonly config: UiPathConfig,
    dependencies: UiPathClientDependencies = {},
  ) {
    this.fetchImpl = dependencies.fetch ?? fetch;
    this.logger = dependencies.logger ?? { warn: () => undefined };
    this.now = dependencies.now ?? Date.now;
  }

  get mode(): UiPathConfig['mode'] {
    return this.config.mode;
  }

  get defaultProcessName(): string {
    return this.config.processName;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async startJob(input: StartJobInput): Promise<StartJobResult> {
    const releaseKey = await this.resolveReleaseKey(input.processName);
    const startInfo: Record<string, unknown> = {
      ReleaseKey: releaseKey,
      Strategy: 'ModernJobsCount',
      JobsCount: 1,
      InputArguments: JSON.stringify(input.inputArguments),
      Reference: input.reference,
    };
    if (this.config.runtimeType) startInfo.RuntimeType = this.config.runtimeType;

    const body = await this.request<{ value?: ODataJob[] }>(
      'POST',
      '/odata/Jobs/UiPath.Server.Configuration.OData.StartJobs',
      { startInfo },
    );
    const job = body.value?.[0];
    if (!job || job.Id === undefined || job.Id === null) {
      throw new UiPathApiError({
        kind: 'INVALID_RESPONSE',
        message: 'StartJobs returned no job',
        retryable: true,
        ambiguous: true,
      });
    }
    return {
      jobId: String(job.Id),
      jobKey: job.Key ?? null,
      state: normalizeUiPathJobState(job.State),
      rawState: job.State === undefined || job.State === null ? null : String(job.State),
    };
  }

  async getJobStatus(jobId: string): Promise<JobStatusResult> {
    const job = await this.request<ODataJob>('GET', `/odata/Jobs(${encodeURIComponent(jobId)})`);
    return this.mapJob(job);
  }

  async getJobResult(jobId: string): Promise<JobResult> {
    const job = await this.request<ODataJob>('GET', `/odata/Jobs(${encodeURIComponent(jobId)})`);
    const status = this.mapJob(job);
    const raw = job.OutputArguments ?? null;
    let outputArguments: Record<string, unknown> | null = null;
    if (raw && raw.trim() !== '') {
      try {
        const parsed: unknown = JSON.parse(raw);
        outputArguments = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
      } catch {
        outputArguments = null;
      }
    }
    return { ...status, outputArguments, rawOutputArguments: raw };
  }

  async findJobByReference(reference: string): Promise<JobStatusResult | null> {
    const query = new URLSearchParams({
      $filter: `Reference eq ${odataString(reference)}`,
      $orderby: 'CreationTime desc',
      $top: '1',
    });
    const body = await this.request<{ value?: ODataJob[] }>('GET', `/odata/Jobs?${query.toString()}`);
    const job = body.value?.[0];
    return job ? this.mapJob(job) : null;
  }

  async stopJob(jobId: string, strategy: 'SoftStop' | 'Kill' = 'Kill'): Promise<void> {
    const numericId = Number(jobId);
    await this.request('POST', '/odata/Jobs/UiPath.Server.Configuration.OData.StopJobs', {
      jobIds: [Number.isFinite(numericId) ? numericId : jobId],
      strategy,
    });
  }

  async healthCheck(options: { processName?: string; forceTokenRefresh?: boolean } = {}): Promise<RpaHealthResult> {
    const started = this.now();
    const processName = options.processName ?? this.config.processName;
    const result: RpaHealthResult = {
      ok: false,
      configured: true,
      mode: this.config.mode,
      authenticated: false,
      folderAccessible: false,
      processFound: false,
      processName,
      latencyMs: 0,
      checkedAt: new Date(started).toISOString(),
      message: null,
    };
    try {
      if (options.forceTokenRefresh) this.token = null;
      await this.getAccessToken();
      result.authenticated = true;
      if (!this.config.folderId) {
        result.message = 'UIPATH_FOLDER_ID is not configured';
        return result;
      }
      this.releaseKeys.delete(processName);
      await this.resolveReleaseKey(processName);
      result.folderAccessible = true;
      result.processFound = true;
      result.ok = true;
    } catch (error) {
      if (isUiPathApiError(error)) {
        if (error.kind === 'PROCESS_NOT_FOUND') result.folderAccessible = true;
        result.message = error.message;
      } else {
        result.message = (error as Error)?.message ?? 'Unknown error';
      }
    } finally {
      result.latencyMs = this.now() - started;
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private mapJob(job: ODataJob): JobStatusResult {
    if (job.Id === undefined || job.Id === null) {
      throw new UiPathApiError({
        kind: 'INVALID_RESPONSE',
        message: 'Orchestrator returned a job without an Id',
        retryable: true,
        ambiguous: false,
      });
    }
    const jobError: RobotJobError | null = job.JobError
      ? {
          code: job.JobError.Code ?? null,
          category: job.JobError.Category ?? null,
          title: job.JobError.Title ?? null,
          details: job.JobError.Details ?? job.JobError.Detail ?? null,
        }
      : null;
    return {
      jobId: String(job.Id),
      jobKey: job.Key ?? null,
      reference: job.Reference ?? null,
      state: normalizeUiPathJobState(job.State),
      rawState: job.State === undefined || job.State === null ? null : String(job.State),
      creationTime: job.CreationTime ?? null,
      startTime: job.StartTime ?? null,
      endTime: job.EndTime ?? null,
      info: job.Info ?? null,
      jobError,
      hostMachineName: job.HostMachineName ?? null,
    };
  }

  private async resolveReleaseKey(processName: string): Promise<string> {
    const cached = this.releaseKeys.get(processName);
    if (cached && this.now() - cached.cachedAt < RELEASE_CACHE_TTL_MS) return cached.key;
    const query = new URLSearchParams({
      $filter: `Name eq ${odataString(processName)}`,
      $top: '1',
      $select: 'Key,Name,ProcessKey,ProcessVersion',
    });
    const body = await this.request<{ value?: Array<{ Key?: string }> }>('GET', `/odata/Releases?${query.toString()}`);
    const key = body.value?.[0]?.Key;
    if (!key) {
      throw new UiPathApiError({
        kind: 'PROCESS_NOT_FOUND',
        message: `UiPath process "${processName}" was not found in folder ${this.config.folderId}`,
        retryable: false,
        ambiguous: false,
      });
    }
    this.releaseKeys.set(processName, { key, cachedAt: this.now() });
    return key;
  }

  private async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_EXPIRY_SKEW_MS > this.now()) {
      return this.token.accessToken;
    }
    // De-duplicate concurrent token requests.
    if (!this.tokenRequest) {
      this.tokenRequest = this.requestToken().finally(() => {
        this.tokenRequest = null;
      });
    }
    return this.tokenRequest;
  }

  private async requestToken(): Promise<string> {
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: this.config.scopes,
    });
    const path = '/connect/token';
    let response: Response;
    try {
      response = await this.fetchImpl(this.config.identityUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: form.toString(),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
    } catch (error) {
      throw errorFromTransport(error, { method: 'POST', path, timeoutMs: this.config.requestTimeoutMs });
    }
    const body = await this.readBody(response);
    if (!response.ok) {
      const error = errorFromResponse(response.status, body, { method: 'POST', path });
      // A rejected client credential is an authentication problem, not a validation one.
      if (response.status === 400 || response.status === 401) {
        throw new UiPathApiError({
          kind: 'AUTHENTICATION',
          status: response.status,
          message: `UiPath authentication failed: ${error.message}`,
          retryable: false,
          ambiguous: false,
        });
      }
      throw error;
    }
    const payload = body as { access_token?: string; expires_in?: number };
    if (!payload?.access_token) {
      throw new UiPathApiError({
        kind: 'AUTHENTICATION',
        message: 'UiPath token response did not contain an access token',
        retryable: false,
        ambiguous: false,
      });
    }
    const expiresInMs = (payload.expires_in && payload.expires_in > 0 ? payload.expires_in : 3600) * 1000;
    this.token = { accessToken: payload.access_token, expiresAt: this.now() + expiresInMs };
    return payload.access_token;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, payload?: unknown, isRetry = false): Promise<T> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'OrchestraAI/0.1',
    };
    if (this.config.folderId) headers['X-UIPATH-OrganizationUnitId'] = this.config.folderId;
    if (payload !== undefined) headers['Content-Type'] = 'application/json';

    const pathOnly = path.split('?')[0] ?? path;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.orchestratorUrl}${path}`, {
        method,
        headers,
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
    } catch (error) {
      throw errorFromTransport(error, { method, path: pathOnly, timeoutMs: this.config.requestTimeoutMs });
    }

    const body = await this.readBody(response);
    if (response.status === 401 && !isRetry) {
      // Token revoked or expired early: refresh once.
      this.logger.warn('UiPath returned 401, refreshing access token', { path: pathOnly });
      this.token = null;
      return this.request<T>(method, path, payload, true);
    }
    if (!response.ok) {
      throw errorFromResponse(response.status, body, { method, path: pathOnly });
    }
    if (body === null || body === undefined || body === '') return {} as T;
    if (typeof body === 'string') {
      throw new UiPathApiError({
        kind: 'INVALID_RESPONSE',
        status: response.status,
        message: `UiPath ${method} ${pathOnly} returned a non-JSON response`,
        retryable: true,
        ambiguous: method !== 'GET',
      });
    }
    return body as T;
  }

  private async readBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}
