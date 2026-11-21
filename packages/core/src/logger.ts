export interface CoreLogger {
  log(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug?(message: string, context?: Record<string, unknown>): void;
}

function write(level: string, scope: string, message: string, context?: Record<string, unknown>): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, scope, message, ...context });
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

/** Structured JSON-lines logger used outside of NestJS contexts. */
export function createConsoleLogger(scope: string): CoreLogger {
  return {
    log: (message, context) => write('info', scope, message, context),
    warn: (message, context) => write('warn', scope, message, context),
    error: (message, context) => write('error', scope, message, context),
    debug: (message, context) => {
      if (process.env.LOG_LEVEL === 'debug') write('debug', scope, message, context);
    },
  };
}

export const silentLogger: CoreLogger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown error';
}
