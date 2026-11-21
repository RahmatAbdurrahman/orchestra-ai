import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Loads the repository root .env (if present) for local development.
 * Variables already set in the environment always win; production
 * deployments set variables directly and do not need a file.
 */
export function loadRootEnv(startDir: string): void {
  let dir = path.resolve(startDir);
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, '.env');
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      if (existsSync(candidate)) process.loadEnvFile(candidate);
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}
