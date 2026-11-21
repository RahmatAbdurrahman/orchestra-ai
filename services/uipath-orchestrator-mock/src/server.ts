import { existsSync } from 'node:fs';
import path from 'node:path';

/** Loads the repository root .env for local development (existing variables win). */
function loadRootEnv(): void {
  let dir = __dirname;
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      const file = path.join(dir, '.env');
      if (existsSync(file)) process.loadEnvFile(file);
      return;
    }
    dir = path.dirname(dir);
  }
}
loadRootEnv();

import { createOrchestratorMock } from './app';
import { ErpUiRobot } from './robot';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable ${name}`);
    process.exit(1);
  }
  return value;
}

const port = Number(process.env.UIPATH_MOCK_PORT ?? 4200);
const robot = new ErpUiRobot(
  process.env.ERP_SIMULATION_URL ?? 'http://localhost:4100',
  required('ERP_USERNAME'),
  required('ERP_PASSWORD'),
);
const mock = createOrchestratorMock({
  clientId: required('UIPATH_CLIENT_ID'),
  clientSecret: required('UIPATH_CLIENT_SECRET'),
  folderId: required('UIPATH_FOLDER_ID'),
  processes: (process.env.UIPATH_MOCK_PROCESSES ?? 'PurchaseOrderAutomation').split(',').map((name) => name.trim()),
  adminToken: required('UIPATH_MOCK_ADMIN_TOKEN'),
  robot,
  pendingMs: Number(process.env.UIPATH_MOCK_PENDING_MS ?? 1_500),
  runMs: Number(process.env.UIPATH_MOCK_RUN_MS ?? 2_500),
  submitTimeoutDelayMs: Number(process.env.UIPATH_MOCK_SUBMIT_TIMEOUT_DELAY_MS ?? 25_000),
});

const server = mock.app.listen(port, () => {
  console.log(
    JSON.stringify({
      level: 'warn',
      scope: 'uipath-orchestrator-mock',
      message: `UiPath Orchestrator MOCK listening on port ${port} (development/test only - not a real UiPath robot)`,
    }),
  );
});

function shutdown(): void {
  mock.close();
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
