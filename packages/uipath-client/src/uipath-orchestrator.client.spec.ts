/**
 * Adapter tests against a fake Orchestrator (mocked HTTP). These verify request
 * shapes, token handling and error classification only; they say nothing about
 * a real UiPath tenant.
 */
import type { UiPathConfig } from './config';
import { loadUiPathConfigFromEnv } from './config';
import { UiPathApiError } from './errors';
import { UiPathOrchestratorClient } from './uipath-orchestrator.client';

interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

type Handler = (request: RecordedRequest) => Response | Promise<Response>;

const config: UiPathConfig = {
  mode: 'cloud',
  orchestratorUrl: 'https://orch.test/org/tenant/orchestrator_',
  identityUrl: 'https://orch.test/identity_/connect/token',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  scopes: 'OR.Jobs',
  folderId: '42',
  processName: 'PurchaseOrderAutomation',
  runtimeType: null,
  requestTimeoutMs: 1_000,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function createFakeFetch(routes: Array<[RegExp, Handler]>) {
  const requests: RecordedRequest[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = Object.fromEntries(
      Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const request: RecordedRequest = {
      method: init?.method ?? 'GET',
      url,
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    requests.push(request);
    const route = routes.find(([pattern]) => pattern.test(`${request.method} ${url}`));
    if (!route) return json(404, { message: `no route for ${request.method} ${url}` });
    return route[1](request);
  }) as typeof fetch;
  return { fakeFetch, requests };
}

const tokenRoute: [RegExp, Handler] = [
  /^POST https:\/\/orch\.test\/identity_\/connect\/token$/,
  () => json(200, { access_token: 'token-1', expires_in: 3600, token_type: 'Bearer' }),
];
const releaseRoute: [RegExp, Handler] = [
  /^GET .*\/odata\/Releases\?/,
  () => json(200, { value: [{ Key: 'release-key-1', Name: 'PurchaseOrderAutomation' }] }),
];

describe('UiPathOrchestratorClient', () => {
  it('authenticates, resolves the release and starts a job with a reference', async () => {
    const { fakeFetch, requests } = createFakeFetch([
      tokenRoute,
      releaseRoute,
      [/^POST .*StartJobs$/, () => json(201, { value: [{ Id: 1001, Key: 'job-key', State: 'Pending' }] })],
    ]);
    const client = new UiPathOrchestratorClient(config, { fetch: fakeFetch });

    const result = await client.startJob({
      processName: 'PurchaseOrderAutomation',
      reference: 'oa-job-1',
      inputArguments: { in_IdempotencyKey: 'oa-po-1' },
    });

    expect(result).toEqual({ jobId: '1001', jobKey: 'job-key', state: 'PENDING', rawState: 'Pending' });
    const tokenRequest = requests[0]!;
    expect(tokenRequest.body).toContain('grant_type=client_credentials');
    const start = requests.find((request) => request.url.endsWith('StartJobs'))!;
    expect(start.headers.authorization).toBe('Bearer token-1');
    expect(start.headers['x-uipath-organizationunitid']).toBe('42');
    const body = JSON.parse(start.body!);
    expect(body.startInfo).toMatchObject({
      ReleaseKey: 'release-key-1',
      Strategy: 'ModernJobsCount',
      JobsCount: 1,
      Reference: 'oa-job-1',
    });
    expect(JSON.parse(body.startInfo.InputArguments)).toEqual({ in_IdempotencyKey: 'oa-po-1' });
  });

  it('caches the access token and the release key', async () => {
    const { fakeFetch, requests } = createFakeFetch([
      tokenRoute,
      releaseRoute,
      [/^POST .*StartJobs$/, () => json(201, { value: [{ Id: 1, State: 'Pending' }] })],
    ]);
    const client = new UiPathOrchestratorClient(config, { fetch: fakeFetch });
    const input = { processName: 'PurchaseOrderAutomation', reference: 'r', inputArguments: {} };
    await client.startJob(input);
    await client.startJob(input);
    expect(requests.filter((request) => request.url.includes('connect/token'))).toHaveLength(1);
    expect(requests.filter((request) => request.url.includes('Releases'))).toHaveLength(1);
  });

  it('refreshes the token once when Orchestrator answers 401', async () => {
    let calls = 0;
    const { fakeFetch, requests } = createFakeFetch([
      tokenRoute,
      [
        /^GET .*\/odata\/Jobs\(7\)$/,
        () => {
          calls += 1;
          return calls === 1 ? json(401, { message: 'expired' }) : json(200, { Id: 7, State: 'Running' });
        },
      ],
    ]);
    const client = new UiPathOrchestratorClient(config, { fetch: fakeFetch });
    const status = await client.getJobStatus('7');
    expect(status.state).toBe('RUNNING');
    expect(requests.filter((request) => request.url.includes('connect/token'))).toHaveLength(2);
  });

  it('parses output arguments of a finished job', async () => {
    const { fakeFetch } = createFakeFetch([
      tokenRoute,
      [
        /^GET .*\/odata\/Jobs\(9\)$/,
        () =>
          json(200, {
            Id: 9,
            Key: 'k',
            State: 'Successful',
            Reference: 'oa-job-1',
            OutputArguments: JSON.stringify({ out_Status: 'CREATED', out_PoNumber: 'PO-2026-000001' }),
          }),
      ],
    ]);
    const client = new UiPathOrchestratorClient(config, { fetch: fakeFetch });
    const result = await client.getJobResult('9');
    expect(result.state).toBe('SUCCESSFUL');
    expect(result.outputArguments).toEqual({ out_Status: 'CREATED', out_PoNumber: 'PO-2026-000001' });
  });

  it('finds a job by reference using an OData filter', async () => {
    const { fakeFetch, requests } = createFakeFetch([
      tokenRoute,
      [/^GET .*\/odata\/Jobs\?/, () => json(200, { value: [{ Id: 55, State: 'Running', Reference: "o'a" }] })],
    ]);
    const client = new UiPathOrchestratorClient(config, { fetch: fakeFetch });
    const job = await client.findJobByReference("o'a");
    expect(job?.jobId).toBe('55');
    const url = decodeURIComponent(requests[1]!.url.replace(/\+/g, ' '));
    expect(url).toContain("$filter=Reference eq 'o''a'");
  });

  it('returns null when no job has the reference', async () => {
    const { fakeFetch } = createFakeFetch([tokenRoute, [/^GET .*\/odata\/Jobs\?/, () => json(200, { value: [] })]]);
    const client = new UiPathOrchestratorClient(config, { fetch: fakeFetch });
    await expect(client.findJobByReference('missing')).resolves.toBeNull();
  });

  it('marks a StartJobs timeout as retryable and ambiguous', async () => {
    const { fakeFetch } = createFakeFetch([
      tokenRoute,
      releaseRoute,
      [
        /^POST .*StartJobs$/,
        () => {
          const error = new Error('The operation was aborted due to timeout');
          error.name = 'TimeoutError';
          throw error;
        },
      ],
    ]);
    const client = new UiPathOrchestratorClient(config, { fetch: fakeFetch });
    const failure = await client
      .startJob({ processName: 'PurchaseOrderAutomation', reference: 'r', inputArguments: {} })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UiPathApiError);
    expect(failure).toMatchObject({ kind: 'TIMEOUT', retryable: true, ambiguous: true });
  });

  it('classifies HTTP errors', async () => {
    const { fakeFetch } = createFakeFetch([
      tokenRoute,
      releaseRoute,
      [/^POST .*StartJobs$/, () => json(400, { message: 'No robots are available for this process', errorCode: 2818 })],
      [/^GET .*\/odata\/Jobs\(1\)$/, () => json(503, { message: 'maintenance' })],
      [/^GET .*\/odata\/Jobs\(2\)$/, () => json(403, { message: 'forbidden' })],
    ]);
    const client = new UiPathOrchestratorClient(config, { fetch: fakeFetch });
    await expect(
      client.startJob({ processName: 'PurchaseOrderAutomation', reference: 'r', inputArguments: {} }),
    ).rejects.toMatchObject({ kind: 'ROBOT_UNAVAILABLE', retryable: true, ambiguous: false });
    await expect(client.getJobStatus('1')).rejects.toMatchObject({ kind: 'SERVER', retryable: true, ambiguous: false });
    await expect(client.getJobStatus('2')).rejects.toMatchObject({ kind: 'AUTHORIZATION', retryable: false });
  });

  it('reports a missing process in the health check', async () => {
    const { fakeFetch } = createFakeFetch([tokenRoute, [/^GET .*\/odata\/Releases\?/, () => json(200, { value: [] })]]);
    const client = new UiPathOrchestratorClient(config, { fetch: fakeFetch });
    const health = await client.healthCheck();
    expect(health).toMatchObject({ ok: false, authenticated: true, folderAccessible: true, processFound: false });
  });

  it('reports invalid credentials in the health check', async () => {
    const { fakeFetch } = createFakeFetch([
      [/connect\/token$/, () => json(400, { error: 'invalid_client' })],
    ]);
    const client = new UiPathOrchestratorClient(config, { fetch: fakeFetch });
    const health = await client.healthCheck();
    expect(health.ok).toBe(false);
    expect(health.authenticated).toBe(false);
    expect(health.message).toContain('authentication failed');
  });
});

describe('loadUiPathConfigFromEnv', () => {
  it('returns null when the integration is not configured', () => {
    expect(loadUiPathConfigFromEnv({})).toBeNull();
  });

  it('derives the cloud identity endpoint by default', () => {
    const loaded = loadUiPathConfigFromEnv({
      UIPATH_ORCHESTRATOR_URL: 'https://cloud.uipath.com/org/tenant/orchestrator_/',
      UIPATH_CLIENT_ID: 'id',
      UIPATH_CLIENT_SECRET: 'secret',
      UIPATH_FOLDER_ID: '1',
    });
    expect(loaded).toMatchObject({
      mode: 'cloud',
      orchestratorUrl: 'https://cloud.uipath.com/org/tenant/orchestrator_',
      identityUrl: 'https://cloud.uipath.com/identity_/connect/token',
    });
  });

  it('derives the on-premises identity endpoint from the orchestrator origin', () => {
    const loaded = loadUiPathConfigFromEnv({
      UIPATH_MODE: 'onprem',
      UIPATH_ORCHESTRATOR_URL: 'https://orchestrator.corp.local',
      UIPATH_CLIENT_ID: 'id',
      UIPATH_CLIENT_SECRET: 'secret',
    });
    expect(loaded?.identityUrl).toBe('https://orchestrator.corp.local/identity/connect/token');
  });
});
