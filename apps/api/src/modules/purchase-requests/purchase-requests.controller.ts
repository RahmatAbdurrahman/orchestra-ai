import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@orchestra/domain';
import type { AuthUser } from '../../common/auth-user';
import { CurrentUser, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import {
  CreatePurchaseRequestDto,
  ListPurchaseRequestsQueryDto,
  ReasonDto,
  UpdatePurchaseRequestDto,
} from './purchase-requests.dto';
import { PurchaseRequestsService } from './purchase-requests.service';

const READ = [Permission.REQUESTS_READ_ALL, Permission.REQUESTS_READ_OWN, Permission.REQUESTS_READ_ASSIGNED];

@ApiTags('Purchase requests')
@ApiCookieAuth()
@Controller('purchase-requests')
export class PurchaseRequestsController {
  constructor(private readonly requests: PurchaseRequestsService) {}

  @Get()
  @RequireAnyPermission(...READ)
  @ApiOperation({ summary: 'List purchase requests visible to the current user (all / own / assigned)' })
  list(@CurrentUser() user: AuthUser, @Query() query: ListPurchaseRequestsQueryDto) {
    return this.requests.list(user, query);
  }

  @Post()
  @RequirePermissions(Permission.REQUESTS_CREATE)
  @ApiOperation({ summary: 'Create a draft purchase request' })
  create(@CurrentUser() user: AuthUser, @Body() body: CreatePurchaseRequestDto) {
    return this.requests.create(user, body);
  }

  @Get(':id')
  @RequireAnyPermission(...READ)
  @ApiOperation({ summary: 'Request detail with items, documents, approvals, automation and allowed actions' })
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.detail(user, id);
  }

  @Get(':id/timeline')
  @RequireAnyPermission(...READ)
  @ApiOperation({ summary: 'Audit timeline of the request' })
  timeline(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.timeline(user, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.REQUESTS_CREATE)
  @ApiOperation({ summary: 'Edit a draft request (requester only)' })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdatePurchaseRequestDto) {
    return this.requests.update(user, id, body);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions(Permission.REQUESTS_CREATE)
  @ApiOperation({ summary: 'Submit a draft; documents are queued for extraction' })
  submit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.submit(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(Permission.REQUESTS_CREATE)
  @ApiOperation({ summary: 'Withdraw a request before it is approved (requester only)' })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.requests.cancel(user, id, body.reason);
  }
}
