import { loadAppConfig } from './app-config';

const base = {
  DATABASE_URL: 'postgres://localhost/test',
  DOCUMENT_INTELLIGENCE_TOKEN: 'a-token-of-at-least-16-chars',
};

describe('loadAppConfig: demo login', () => {
  it('is off unless enabled explicitly', () => {
    expect(loadAppConfig({ ...base }).demoLoginEnabled).toBe(false);
    expect(loadAppConfig({ ...base, DEMO_LOGIN_ENABLED: 'true' }).demoLoginEnabled).toBe(true);
  });

  it('is refused in production', () => {
    expect(() => loadAppConfig({ ...base, NODE_ENV: 'production', QUEUE_DRIVER: 'bullmq', DEMO_LOGIN_ENABLED: 'true' })).toThrow(
      /DEMO_LOGIN_ENABLED/,
    );
  });
});
