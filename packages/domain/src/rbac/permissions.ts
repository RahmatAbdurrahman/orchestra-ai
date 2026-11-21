import { RoleName } from '../enums';

export const Permission = Object.freeze({
  DASHBOARD_VIEW: 'dashboard:view',
  USERS_MANAGE: 'users:manage',
  REQUESTS_CREATE: 'requests:create',
  REQUESTS_READ_OWN: 'requests:read:own',
  REQUESTS_READ_ASSIGNED: 'requests:read:assigned',
  REQUESTS_READ_ALL: 'requests:read:all',
  APPROVALS_DECIDE: 'approvals:decide',
  WORKFLOWS_READ: 'workflows:read',
  WORKFLOWS_MANAGE: 'workflows:manage',
  AUTOMATION_READ: 'automation:read',
  AUTOMATION_EXECUTE: 'automation:execute',
  AUTOMATION_RETRY: 'automation:retry',
  AUDIT_READ_ALL: 'audit:read:all',
  AUDIT_READ_OWN: 'audit:read:own',
  AUDIT_READ_RELEVANT: 'audit:read:relevant',
  AUDIT_READ_OPERATIONAL: 'audit:read:operational',
  INTEGRATIONS_READ: 'integrations:read',
  INTEGRATIONS_MANAGE: 'integrations:manage',
  REFERENCE_DATA_MANAGE: 'reference-data:manage',
} as const);
export type Permission = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS = Object.values(Permission) as Permission[];

/**
 * "Configurable" / "Controlled" cells of the PRD RBAC matrix for the
 * administrator role. Both default to false: an administrator configures the
 * platform but does not approve requests or operate robots unless enabled.
 */
export interface RbacPolicyOptions {
  adminCanApprove: boolean;
  adminCanOperateAutomation: boolean;
}

export const DEFAULT_RBAC_POLICY_OPTIONS: RbacPolicyOptions = Object.freeze({
  adminCanApprove: false,
  adminCanOperateAutomation: false,
});

const BASE_ROLE_PERMISSIONS: Readonly<Record<RoleName, readonly Permission[]>> = Object.freeze({
  ADMIN: [
    Permission.DASHBOARD_VIEW,
    Permission.USERS_MANAGE,
    Permission.REQUESTS_CREATE,
    Permission.REQUESTS_READ_ALL,
    Permission.WORKFLOWS_READ,
    Permission.WORKFLOWS_MANAGE,
    Permission.AUTOMATION_READ,
    Permission.AUDIT_READ_ALL,
    Permission.INTEGRATIONS_READ,
    Permission.INTEGRATIONS_MANAGE,
    Permission.REFERENCE_DATA_MANAGE,
  ],
  REQUESTER: [
    Permission.DASHBOARD_VIEW,
    Permission.REQUESTS_CREATE,
    Permission.REQUESTS_READ_OWN,
    Permission.AUDIT_READ_OWN,
  ],
  APPROVER: [
    Permission.DASHBOARD_VIEW,
    Permission.REQUESTS_READ_ASSIGNED,
    Permission.APPROVALS_DECIDE,
    Permission.AUDIT_READ_RELEVANT,
  ],
  OPERATOR: [
    Permission.DASHBOARD_VIEW,
    Permission.REQUESTS_READ_ALL,
    Permission.AUTOMATION_READ,
    Permission.AUTOMATION_EXECUTE,
    Permission.AUTOMATION_RETRY,
    Permission.AUDIT_READ_OPERATIONAL,
    Permission.INTEGRATIONS_READ,
  ],
  VIEWER: [
    Permission.DASHBOARD_VIEW,
    Permission.REQUESTS_READ_ALL,
    Permission.WORKFLOWS_READ,
    Permission.AUTOMATION_READ,
    Permission.AUDIT_READ_ALL,
  ],
});

export function permissionsForRole(role: RoleName, options: RbacPolicyOptions): Permission[] {
  const permissions = [...BASE_ROLE_PERMISSIONS[role]];
  if (role === 'ADMIN') {
    if (options.adminCanApprove) permissions.push(Permission.APPROVALS_DECIDE);
    if (options.adminCanOperateAutomation) {
      permissions.push(Permission.AUTOMATION_EXECUTE, Permission.AUTOMATION_RETRY);
    }
  }
  return permissions;
}

export function permissionsForRoles(
  roles: readonly RoleName[],
  options: RbacPolicyOptions = DEFAULT_RBAC_POLICY_OPTIONS,
): Set<Permission> {
  const result = new Set<Permission>();
  for (const role of roles) {
    for (const permission of permissionsForRole(role, options)) result.add(permission);
  }
  return result;
}

export function hasAllPermissions(
  granted: ReadonlySet<Permission> | readonly Permission[],
  required: readonly Permission[],
): boolean {
  const set = granted instanceof Set ? granted : new Set(granted as readonly Permission[]);
  return required.every((permission) => set.has(permission));
}

export interface RequestAccessScope {
  all: boolean;
  own: boolean;
  assigned: boolean;
}

export function requestAccessScope(granted: ReadonlySet<Permission>): RequestAccessScope {
  return {
    all: granted.has(Permission.REQUESTS_READ_ALL),
    own: granted.has(Permission.REQUESTS_READ_OWN),
    assigned: granted.has(Permission.REQUESTS_READ_ASSIGNED),
  };
}

export interface AuditAccessScope {
  all: boolean;
  own: boolean;
  relevant: boolean;
  operational: boolean;
}

export function auditAccessScope(granted: ReadonlySet<Permission>): AuditAccessScope {
  return {
    all: granted.has(Permission.AUDIT_READ_ALL),
    own: granted.has(Permission.AUDIT_READ_OWN),
    relevant: granted.has(Permission.AUDIT_READ_RELEVANT),
    operational: granted.has(Permission.AUDIT_READ_OPERATIONAL),
  };
}

export function hasAnyAuditAccess(scope: AuditAccessScope): boolean {
  return scope.all || scope.own || scope.relevant || scope.operational;
}
