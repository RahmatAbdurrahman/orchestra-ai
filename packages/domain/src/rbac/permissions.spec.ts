import {
  auditAccessScope,
  Permission,
  permissionsForRoles,
  requestAccessScope,
} from './permissions';

describe('RBAC policy (PRD section 4)', () => {
  it('only lets administrators manage users and workflows', () => {
    for (const role of ['REQUESTER', 'APPROVER', 'OPERATOR', 'VIEWER'] as const) {
      const permissions = permissionsForRoles([role]);
      expect(permissions.has(Permission.USERS_MANAGE)).toBe(false);
      expect(permissions.has(Permission.WORKFLOWS_MANAGE)).toBe(false);
    }
    const admin = permissionsForRoles(['ADMIN']);
    expect(admin.has(Permission.USERS_MANAGE)).toBe(true);
    expect(admin.has(Permission.WORKFLOWS_MANAGE)).toBe(true);
  });

  it('lets only requesters and admins create requests', () => {
    expect(permissionsForRoles(['REQUESTER']).has(Permission.REQUESTS_CREATE)).toBe(true);
    expect(permissionsForRoles(['ADMIN']).has(Permission.REQUESTS_CREATE)).toBe(true);
    expect(permissionsForRoles(['APPROVER']).has(Permission.REQUESTS_CREATE)).toBe(false);
    expect(permissionsForRoles(['OPERATOR']).has(Permission.REQUESTS_CREATE)).toBe(false);
    expect(permissionsForRoles(['VIEWER']).has(Permission.REQUESTS_CREATE)).toBe(false);
  });

  it('lets only approvers decide approvals by default', () => {
    expect(permissionsForRoles(['APPROVER']).has(Permission.APPROVALS_DECIDE)).toBe(true);
    for (const role of ['ADMIN', 'REQUESTER', 'OPERATOR', 'VIEWER'] as const) {
      expect(permissionsForRoles([role]).has(Permission.APPROVALS_DECIDE)).toBe(false);
    }
  });

  it('makes admin approval and automation control configurable', () => {
    const admin = permissionsForRoles(['ADMIN'], { adminCanApprove: true, adminCanOperateAutomation: true });
    expect(admin.has(Permission.APPROVALS_DECIDE)).toBe(true);
    expect(admin.has(Permission.AUTOMATION_RETRY)).toBe(true);
    expect(admin.has(Permission.AUTOMATION_EXECUTE)).toBe(true);
  });

  it('lets only operators execute and retry automation by default', () => {
    expect(permissionsForRoles(['OPERATOR']).has(Permission.AUTOMATION_RETRY)).toBe(true);
    expect(permissionsForRoles(['OPERATOR']).has(Permission.AUTOMATION_EXECUTE)).toBe(true);
    for (const role of ['ADMIN', 'REQUESTER', 'APPROVER', 'VIEWER'] as const) {
      expect(permissionsForRoles([role]).has(Permission.AUTOMATION_RETRY)).toBe(false);
    }
  });

  it('keeps the viewer read-only', () => {
    const viewer = permissionsForRoles(['VIEWER']);
    const writePermissions = [
      Permission.USERS_MANAGE,
      Permission.REQUESTS_CREATE,
      Permission.APPROVALS_DECIDE,
      Permission.WORKFLOWS_MANAGE,
      Permission.AUTOMATION_EXECUTE,
      Permission.AUTOMATION_RETRY,
      Permission.INTEGRATIONS_MANAGE,
      Permission.REFERENCE_DATA_MANAGE,
    ];
    for (const permission of writePermissions) expect(viewer.has(permission)).toBe(false);
  });

  it('derives request visibility scopes', () => {
    expect(requestAccessScope(permissionsForRoles(['REQUESTER']))).toEqual({ all: false, own: true, assigned: false });
    expect(requestAccessScope(permissionsForRoles(['APPROVER']))).toEqual({ all: false, own: false, assigned: true });
    expect(requestAccessScope(permissionsForRoles(['OPERATOR'])).all).toBe(true);
    expect(requestAccessScope(permissionsForRoles(['VIEWER'])).all).toBe(true);
  });

  it('derives audit visibility scopes', () => {
    expect(auditAccessScope(permissionsForRoles(['REQUESTER']))).toEqual({
      all: false,
      own: true,
      relevant: false,
      operational: false,
    });
    expect(auditAccessScope(permissionsForRoles(['OPERATOR'])).operational).toBe(true);
    expect(auditAccessScope(permissionsForRoles(['ADMIN'])).all).toBe(true);
  });

  it('unions permissions for users with several roles', () => {
    const permissions = permissionsForRoles(['REQUESTER', 'APPROVER']);
    expect(permissions.has(Permission.REQUESTS_CREATE)).toBe(true);
    expect(permissions.has(Permission.APPROVALS_DECIDE)).toBe(true);
  });
});
