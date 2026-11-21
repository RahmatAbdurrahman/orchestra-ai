import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@orchestra/database';
import { requestAccessScope } from '@orchestra/domain';
import type { AuthUser } from '../../common/auth-user';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma.service';

const NO_ACCESS: Prisma.PurchaseRequestWhereInput = { id: '00000000-0000-0000-0000-000000000000' };

/**
 * Data-level authorization for purchase requests (PRD RBAC "View Requests"):
 * ALL for admin/operator/viewer, OWN for requesters, ASSIGNED for approvers.
 */
@Injectable()
export class RequestAccessService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  readableWhere(user: AuthUser): Prisma.PurchaseRequestWhereInput {
    const scope = requestAccessScope(user.permissions);
    if (scope.all) return {};
    const or: Prisma.PurchaseRequestWhereInput[] = [];
    if (scope.own) or.push({ requesterId: user.id });
    if (scope.assigned) or.push(this.assignedWhere(user));
    return or.length > 0 ? { OR: or } : NO_ACCESS;
  }

  /** Requests with an approval level the user may act on (or has acted on). */
  assignedWhere(user: AuthUser): Prisma.PurchaseRequestWhereInput {
    const conditions: Prisma.ApprovalWhereInput[] = [{ approverId: user.id }];
    if (user.departmentId && user.roles.includes('APPROVER')) {
      conditions.push({ departmentId: user.departmentId, activatedAt: { not: null } });
    }
    if (this.config.rbac.adminCanApprove && user.roles.includes('ADMIN')) {
      conditions.push({ activatedAt: { not: null } });
    }
    return { approvals: { some: { OR: conditions } } };
  }

  /** Throws 404 (not 403) so the existence of other users' requests is not revealed. */
  async assertReadable(user: AuthUser, purchaseRequestId: string): Promise<void> {
    const found = await this.prisma.purchaseRequest.findFirst({
      where: { AND: [{ id: purchaseRequestId }, this.readableWhere(user)] },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Purchase request not found');
  }

  async readableIds(user: AuthUser, limit = 2000): Promise<string[] | null> {
    const scope = requestAccessScope(user.permissions);
    if (scope.all) return null;
    const rows = await this.prisma.purchaseRequest.findMany({
      where: this.readableWhere(user),
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => row.id);
  }
}
