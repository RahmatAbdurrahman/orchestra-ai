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

import { createErpApp } from './app';
import { PurchaseOrderStore } from './store';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable ${name}`);
    process.exit(1);
  }
  return value;
}

const port = Number(process.env.ERP_PORT ?? 4100);
const store = new PurchaseOrderStore(process.env.ERP_DATABASE_PATH ?? './.data/erp-simulation.sqlite');
const { app } = createErpApp({
  store,
  username: required('ERP_USERNAME'),
  password: required('ERP_PASSWORD'),
  apiToken: required('ERP_API_TOKEN'),
  simAdminToken: required('ERP_SIM_ADMIN_TOKEN'),
});

const server = app.listen(port, () => {
  console.log(JSON.stringify({ level: 'info', scope: 'erp-simulation', message: `SimERP listening on port ${port}` }));
});

function shutdown(): void {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
