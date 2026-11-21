export type UiPathMode = 'cloud' | 'onprem' | 'mock';

export interface UiPathConfig {
  mode: UiPathMode;
  /** Orchestrator base URL, e.g. https://cloud.uipath.com/{org}/{tenant}/orchestrator_ */
  orchestratorUrl: string;
  /** OAuth token endpoint, e.g. https://cloud.uipath.com/identity_/connect/token */
  identityUrl: string;
  clientId: string;
  clientSecret: string;
  /** Space separated scopes granted to the External Application. */
  scopes: string;
  /** Orchestrator folder id (sent as X-UIPATH-OrganizationUnitId). */
  folderId: string;
  /** Default process (release) name. */
  processName: string;
  /** Optional runtime type for StartJobs (e.g. "Unattended"). */
  runtimeType: string | null;
  requestTimeoutMs: number;
}

export const DEFAULT_UIPATH_SCOPES = 'OR.Jobs OR.Execution.Read OR.Folders.Read';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Reads the UiPath configuration from environment variables.
 * Returns null when the integration is not configured.
 */
export function loadUiPathConfigFromEnv(env: NodeJS.ProcessEnv = process.env): UiPathConfig | null {
  const orchestratorUrl = env.UIPATH_ORCHESTRATOR_URL?.trim();
  const clientId = env.UIPATH_CLIENT_ID?.trim();
  const clientSecret = env.UIPATH_CLIENT_SECRET;
  if (!orchestratorUrl || !clientId || !clientSecret) return null;

  const mode = (env.UIPATH_MODE?.trim().toLowerCase() || 'cloud') as UiPathMode;
  if (!['cloud', 'onprem', 'mock'].includes(mode)) {
    throw new Error(`UIPATH_MODE must be one of cloud, onprem, mock (got "${env.UIPATH_MODE}")`);
  }
  const identityUrl =
    env.UIPATH_IDENTITY_URL?.trim() ||
    (mode === 'cloud'
      ? 'https://cloud.uipath.com/identity_/connect/token'
      : `${new URL(orchestratorUrl).origin}/identity/connect/token`);

  const timeout = Number(env.UIPATH_REQUEST_TIMEOUT_MS ?? 15_000);
  return {
    mode,
    orchestratorUrl: trimTrailingSlash(orchestratorUrl),
    identityUrl,
    clientId,
    clientSecret,
    scopes: env.UIPATH_SCOPES?.trim() || DEFAULT_UIPATH_SCOPES,
    folderId: env.UIPATH_FOLDER_ID?.trim() ?? '',
    processName: env.UIPATH_PROCESS_NAME?.trim() || 'PurchaseOrderAutomation',
    runtimeType: env.UIPATH_RUNTIME_TYPE?.trim() || null,
    requestTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 15_000,
  };
}
