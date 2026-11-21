/** Authentication, RBAC (PRD section 4), data scoping and audit immutability. */
import request from 'supertest';
import { APP_CONFIG } from '../src/config/app-config';
import { API, createVerifiedRequest, startHarness, type Harness } from './support/harness';

describe('Authentication and RBAC', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('rejects unauthenticated requests', async () => {
    const response = await request(harness.http).get(`${API}/purchase-requests`).expect(401);
    expect(response.body.error).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(response.body.error.correlationId).toEqual(expect.any(String));
  });

  it('logs in with an HttpOnly session cookie and logs out by revoking the session', async () => {
    const agent = request.agent(harness.http);
    const login = await agent.post(`${API}/auth/login`).send({ email: 'Requester@Orchestra.local', password: 'Orchestra#2026' }).expect(200);
    const cookie = login.headers['set-cookie']![0]!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(login.body.roles).toEqual(['REQUESTER']);
    expect(login.body.permissions).toContain('requests:create');
    expect(JSON.stringify(login.body)).not.toMatch(/passwordHash|token/i);

    await agent.get(`${API}/auth/me`).expect(200);
    await agent.post(`${API}/auth/logout`).expect(204);
    await request(harness.http).get(`${API}/auth/me`).set('Cookie', cookie.split(';')[0]!).expect(401);
  });

  it('uses a generic error for unknown users and wrong passwords, and locks after repeated failures', async () => {
    const unknown = await request(harness.http).post(`${API}/auth/login`).send({ email: 'nobody@orchestra.local', password: 'whatever-123' }).expect(401);
    const wrong = await request(harness.http).post(`${API}/auth/login`).send({ email: 'viewer@orchestra.local', password: 'wrong-password-1' }).expect(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);

    for (let i = 0; i < 2; i += 1) {
      await request(harness.http).post(`${API}/auth/login`).send({ email: 'viewer@orchestra.local', password: 'wrong-password-1' }).expect(401);
    }
    const locked = await request(harness.http).post(`${API}/auth/login`).send({ email: 'viewer@orchestra.local', password: 'Orchestra#2026' }).expect(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    await harness.prisma.user.update({ where: { email: 'viewer@orchestra.local' }, data: { lockedUntil: null, failedLoginCount: 0 } });

    const audit = await harness.prisma.auditLog.count({ where: { action: 'AUTH.LOGIN_FAILED' } });
    expect(audit).toBeGreaterThanOrEqual(4);
  });

  it('offers one-click demo sign-in only when DEMO_LOGIN_ENABLED is on', async () => {
    await request(harness.http).get(`${API}/auth/demo-accounts`).expect(404);
    await request(harness.http).post(`${API}/auth/demo-login`).send({ email: 'approver.ops@orchestra.local' }).expect(404);

    const config = harness.app.get<{ demoLoginEnabled: boolean }>(APP_CONFIG);
    config.demoLoginEnabled = true;
    try {
      const accounts = await request(harness.http).get(`${API}/auth/demo-accounts`).expect(200);
      expect(accounts.body).toEqual(
        expect.arrayContaining([expect.objectContaining({ email: 'approver.ops@orchestra.local', roles: ['APPROVER'] })]),
      );
      expect(JSON.stringify(accounts.body)).not.toMatch(/passwordHash/i);

      const agent = request.agent(harness.http);
      const login = await agent.post(`${API}/auth/demo-login`).send({ email: 'approver.ops@orchestra.local' }).expect(200);
      expect(login.headers['set-cookie']![0]).toMatch(/HttpOnly/i);
      expect(login.body.roles).toEqual(['APPROVER']);
      await agent.get(`${API}/auth/me`).expect(200);

      await request(harness.http).post(`${API}/auth/demo-login`).send({ email: 'nobody@orchestra.local' }).expect(401);
      const audit = await harness.prisma.auditLog.findFirst({
        where: { action: 'AUTH.LOGIN_SUCCEEDED', entityId: login.body.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit?.metadata).toMatchObject({ method: 'DEMO' });
    } finally {
      config.demoLoginEnabled = false;
    }
  });

  it('enforces the RBAC matrix on the server', async () => {
    const requester = await harness.login('requester@orchestra.local');
    const approver = await harness.login('approver.ops@orchestra.local');
    const operator = await harness.login('operator@orchestra.local');
    const viewer = await harness.login('viewer@orchestra.local');
    const admin = await harness.login('admin@orchestra.local');

    // User management: admin only.
    await admin.get(`${API}/users`).expect(200);
    for (const agent of [requester, approver, operator, viewer]) await agent.get(`${API}/users`).expect(403);

    // Create request: requester and admin only.
    for (const agent of [approver, operator, viewer]) {
      await agent.post(`${API}/purchase-requests`).send({ title: 'Not allowed' }).expect(403);
    }

    // Approve: approvers only (admin is "configurable" and disabled by default).
    for (const agent of [requester, operator, viewer, admin]) await agent.get(`${API}/approvals/pending`).expect(403);

    // Workflow configuration: admin only; viewer can read.
    await viewer.get(`${API}/workflows`).expect(200);
    await viewer.post(`${API}/workflows`).send({ key: 'x-workflow', name: 'X', workflowType: 'PURCHASE_REQUEST' }).expect(403);
    await operator.get(`${API}/workflows`).expect(403);

    // Automation: operator executes, viewer reads, requester has no automation access.
    await operator.get(`${API}/automation/jobs`).expect(200);
    await viewer.get(`${API}/automation/jobs`).expect(200);
    await requester.get(`${API}/automation/jobs`).expect(403);

    // Audit: everybody has some scope.
    for (const agent of [requester, approver, operator, viewer, admin]) await agent.get(`${API}/audit-logs`).expect(200);
  });

  it('scopes request visibility: own, assigned, all', async () => {
    const requesterOps = await harness.login('requester@orchestra.local');
    const requesterIt = await harness.login('requester.it@orchestra.local');
    const approverOps = await harness.login('approver.ops@orchestra.local');
    const approverIt = await harness.login('approver.it@orchestra.local');
    const viewer = await harness.login('viewer@orchestra.local');

    const { id } = await createVerifiedRequest(harness, requesterOps, { title: 'Scoped request' });

    await requesterOps.get(`${API}/purchase-requests/${id}`).expect(200);
    await requesterIt.get(`${API}/purchase-requests/${id}`).expect(404);
    await approverOps.get(`${API}/purchase-requests/${id}`).expect(200);
    await approverIt.get(`${API}/purchase-requests/${id}`).expect(404);
    await viewer.get(`${API}/purchase-requests/${id}`).expect(200);

    const itList = await requesterIt.get(`${API}/purchase-requests`).expect(200);
    expect(itList.body.data.some((row: { id: string }) => row.id === id)).toBe(false);

    // A requester sees only their own activity in the audit log.
    const audit = await requesterIt.get(`${API}/audit-logs`).query({ pageSize: 100 }).expect(200);
    const requesterItUser = await harness.prisma.user.findUniqueOrThrow({ where: { email: 'requester.it@orchestra.local' } });
    expect(audit.body.data.every((row: { actor: { id: string } | null }) => row.actor?.id === requesterItUser.id)).toBe(true);

    // Only the requester can change their request.
    await requesterIt.post(`${API}/purchase-requests/${id}/cancel`).send({ reason: 'not mine' }).expect(404);
  });

  it('keeps the audit trail append-only at the database level', async () => {
    const event = await harness.prisma.auditLog.findFirstOrThrow();
    await expect(harness.prisma.auditLog.update({ where: { id: event.id }, data: { action: 'TAMPERED' } })).rejects.toThrow(
      /append-only/,
    );
    await expect(harness.prisma.auditLog.delete({ where: { id: event.id } })).rejects.toThrow(/append-only/);
    // No API route exists to modify audit events.
    const admin = await harness.login('admin@orchestra.local');
    await admin.delete(`${API}/audit-logs/${event.id}`).expect(404);
  });

  it('rejects state-changing requests from foreign origins', async () => {
    const requester = await harness.login('requester@orchestra.local');
    const response = await requester
      .post(`${API}/purchase-requests`)
      .set('Origin', 'https://evil.example')
      .send({ title: 'CSRF attempt' })
      .expect(403);
    expect(response.body.error.message).toContain('Cross-origin');
  });

  it('validates input and rejects unknown fields', async () => {
    const requester = await harness.login('requester@orchestra.local');
    const response = await requester.post(`${API}/purchase-requests`).send({ title: 'x', isAdmin: true }).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});
