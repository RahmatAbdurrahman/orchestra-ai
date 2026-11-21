/**
 * Idempotent seed for development, demos and integration tests.
 *
 * Creates roles, departments, demo users (one per role), the supplier master
 * and the Purchase Request -> Purchase Order workflow template. Existing rows
 * are updated in place; existing user passwords are never overwritten.
 */
import { hash } from '@node-rs/argon2';
import {
  DEFAULT_PURCHASE_WORKFLOW_CONFIGURATION,
  normalizeSupplierName,
  type RoleName,
} from '@orchestra/domain';
import { Prisma, type PrismaClient } from '../generated/client';

export const ARGON2_OPTIONS = Object.freeze({ memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 });

export const PURCHASE_WORKFLOW_KEY = 'purchase-request-to-po';

export const SEED_ROLES: ReadonlyArray<{ name: RoleName; description: string }> = [
  { name: 'ADMIN', description: 'Manages users, roles, workflows and integrations' },
  { name: 'REQUESTER', description: 'Creates purchase requests and uploads supporting documents' },
  { name: 'APPROVER', description: 'Approves or rejects purchase requests' },
  { name: 'OPERATOR', description: 'Monitors robot executions and handles failures' },
  { name: 'VIEWER', description: 'Read-only access to dashboards and reports' },
];

export const SEED_DEPARTMENTS = [
  { code: 'OPS', name: 'Operations', isFinance: false, monthlyBudget: 150_000_000 },
  { code: 'IT', name: 'Information Technology', isFinance: false, monthlyBudget: 200_000_000 },
  { code: 'PROC', name: 'Procurement', isFinance: false, monthlyBudget: 100_000_000 },
  { code: 'FIN', name: 'Finance', isFinance: true, monthlyBudget: 50_000_000 },
] as const;

export const SEED_USERS: ReadonlyArray<{ email: string; name: string; department: string; roles: RoleName[] }> = [
  { email: 'admin@orchestra.local', name: 'Admin Orchestra', department: 'IT', roles: ['ADMIN'] },
  { email: 'requester@orchestra.local', name: 'Rina Wijaya', department: 'OPS', roles: ['REQUESTER'] },
  { email: 'requester.it@orchestra.local', name: 'Dimas Saputra', department: 'IT', roles: ['REQUESTER'] },
  { email: 'approver.ops@orchestra.local', name: 'Budi Santoso', department: 'OPS', roles: ['APPROVER'] },
  { email: 'approver.it@orchestra.local', name: 'Joko Susilo', department: 'IT', roles: ['APPROVER'] },
  { email: 'approver.finance@orchestra.local', name: 'Sari Dewi', department: 'FIN', roles: ['APPROVER'] },
  { email: 'operator@orchestra.local', name: 'Andi Pratama', department: 'IT', roles: ['OPERATOR'] },
  { email: 'viewer@orchestra.local', name: 'Maya Lestari', department: 'FIN', roles: ['VIEWER'] },
];

export const SEED_SUPPLIERS = [
  { code: 'SUP-001', name: 'PT Sinar Jaya Abadi', taxId: '01.234.567.8-901.000', isActive: true },
  { code: 'SUP-002', name: 'CV Maju Bersama', taxId: '02.345.678.9-012.000', isActive: true },
  { code: 'SUP-003', name: 'PT Teknologi Nusantara', taxId: '03.456.789.0-123.000', isActive: true },
  { code: 'SUP-004', name: 'PT Kertas Prima Indonesia', taxId: '04.567.890.1-234.000', isActive: true },
  { code: 'SUP-005', name: 'Global Office Supplies Ltd', taxId: null, isActive: true },
  { code: 'SUP-006', name: 'PT Mitra Lama Sentosa', taxId: '06.789.012.3-456.000', isActive: false },
] as const;

export interface SeedOptions {
  /** Password for newly created demo users (development only). */
  defaultPassword: string;
  log?: (message: string) => void;
}

export async function seedDatabase(prisma: PrismaClient, options: SeedOptions): Promise<void> {
  if (!options.defaultPassword || options.defaultPassword.length < 10) {
    throw new Error('A default password of at least 10 characters is required to seed demo users');
  }

  for (const role of SEED_ROLES) {
    await prisma.role.upsert({ where: { name: role.name }, update: { description: role.description }, create: role });
  }

  const departments = new Map<string, string>();
  for (const department of SEED_DEPARTMENTS) {
    const row = await prisma.department.upsert({
      where: { code: department.code },
      update: { name: department.name, isFinance: department.isFinance },
      create: {
        code: department.code,
        name: department.name,
        isFinance: department.isFinance,
        monthlyBudget: new Prisma.Decimal(department.monthlyBudget),
      },
    });
    departments.set(department.code, row.id);
  }

  const roles = new Map((await prisma.role.findMany()).map((role) => [role.name, role.id]));
  const passwordHash = await hash(options.defaultPassword, ARGON2_OPTIONS);

  for (const user of SEED_USERS) {
    const departmentId = departments.get(user.department)!;
    const row = await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, departmentId },
      create: { email: user.email, name: user.name, departmentId, passwordHash },
    });
    for (const roleName of user.roles) {
      const roleId = roles.get(roleName)!;
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: row.id, roleId } },
        update: {},
        create: { userId: row.id, roleId },
      });
    }
  }

  for (const supplier of SEED_SUPPLIERS) {
    const normalizedName = normalizeSupplierName(supplier.name);
    await prisma.supplier.upsert({
      where: { code: supplier.code },
      update: { name: supplier.name, normalizedName, taxId: supplier.taxId, isActive: supplier.isActive },
      create: { ...supplier, normalizedName },
    });
  }

  const existing = await prisma.workflow.findUnique({ where: { key: PURCHASE_WORKFLOW_KEY } });
  if (!existing) {
    const configuration = DEFAULT_PURCHASE_WORKFLOW_CONFIGURATION as unknown as Prisma.InputJsonValue;
    await prisma.workflow.create({
      data: {
        key: PURCHASE_WORKFLOW_KEY,
        name: 'Purchase Request to Purchase Order',
        description:
          'Document intelligence, business rule validation, tiered approval and UiPath purchase order creation in the ERP simulation.',
        workflowType: 'PURCHASE_REQUEST',
        configuration,
        version: 1,
        versions: { create: { version: 1, configuration, changeNote: 'Initial template' } },
      },
    });
  }

  const counts = {
    users: await prisma.user.count(),
    suppliers: await prisma.supplier.count(),
    workflows: await prisma.workflow.count(),
  };
  options.log?.(`Seed complete: ${counts.users} users, ${counts.suppliers} suppliers, ${counts.workflows} workflow(s).`);
}

/** Removes all data (integration tests only). TRUNCATE bypasses the audit row triggers by design. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE audit_logs, notifications, automation_logs, automation_attempts, automation_jobs, approvals,
       documents, purchase_request_items, purchase_requests, workflow_versions, workflows, sessions, user_roles,
       users, roles, suppliers, departments RESTART IDENTITY CASCADE`,
  );
  await prisma.$executeRawUnsafe('ALTER SEQUENCE purchase_request_number_seq RESTART WITH 1');
}
