import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Permission } from '@orchestra/domain';
import type { AuthUser } from '../../common/auth-user';
import { CurrentUser, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { PaginationQueryDto } from '../../common/pagination';
import { ReasonDto } from '../purchase-requests/purchase-requests.dto';
import { ApprovalsService } from './approvals.service';

class ApproveDto {
  @ApiPropertyOptional({ example: 'Within budget, approved' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comments?: string;
}

@ApiTags('Approvals')
@ApiCookieAuth()
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get('pending')
  @RequirePermissions(Permission.APPROVALS_DECIDE)
  @ApiOperation({ summary: 'Approvals waiting for the current approver' })
  pending(@CurrentUser() user: AuthUser) {
    return this.approvals.pending(user);
  }

  @Get('decided')
  @RequirePermissions(Permission.APPROVALS_DECIDE)
  @ApiOperation({ summary: 'Decisions made by the current approver' })
  decided(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.approvals.decided(user, query);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions(Permission.APPROVALS_DECIDE)
  @ApiOperation({ summary: 'Approve the current approval level' })
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: ApproveDto) {
    return this.approvals.approve(user, id, body.comments);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions(Permission.APPROVALS_DECIDE)
  @ApiOperation({ summary: 'Reject the request (a reason is required)' })
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.approvals.reject(user, id, body.reason);
  }

  @Get(':id/history')
  @RequireAnyPermission(Permission.REQUESTS_READ_ALL, Permission.REQUESTS_READ_OWN, Permission.REQUESTS_READ_ASSIGNED)
  @ApiOperation({ summary: 'All approval levels and decisions of the request this approval belongs to' })
  history(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.approvals.history(user, id);
  }
}
