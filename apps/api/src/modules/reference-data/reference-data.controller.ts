import {
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { isUniqueConstraintError } from '@orchestra/database';
import { writeAudit } from '@orchestra/core';
import { AuditAction, AuditEntity, normalizeSupplierName, Permission } from '@orchestra/domain';
import type { AuthUser } from '../../common/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { actorFor } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma.service';

class ListSuppliersQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  activeOnly?: boolean;
}

class CreateSupplierDto {
  @ApiProperty({ example: 'SUP-007' })
  @IsString()
  @Matches(/^[A-Z0-9-]{3,30}$/)
  code: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  taxId?: string;
}

class UpdateSupplierDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

@Injectable()
export class ReferenceDataService {
  constructor(private readonly prisma: PrismaService) {}

  departments() {
    return this.prisma.department.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, isFinance: true, monthlyBudget: true },
    });
  }

  suppliers(query: ListSuppliersQueryDto) {
    return this.prisma.supplier.findMany({
      where: {
        ...(query.activeOnly ? { isActive: true } : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { code: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      take: 200,
    });
  }

  async createSupplier(user: AuthUser, input: CreateSupplierDto) {
    try {
      const supplier = await this.prisma.supplier.create({
        data: { code: input.code, name: input.name.trim(), normalizedName: normalizeSupplierName(input.name), taxId: input.taxId ?? null },
      });
      await writeAudit(this.prisma, actorFor(user), {
        action: AuditAction.SUPPLIER_CREATED,
        entityType: AuditEntity.SUPPLIER,
        entityId: supplier.id,
        newValue: { code: supplier.code, name: supplier.name },
      });
      return supplier;
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictException('A supplier with this code or name already exists');
      throw error;
    }
  }

  async updateSupplier(user: AuthUser, id: string, input: UpdateSupplierDto) {
    const existing = await this.prisma.supplier.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Supplier not found');
    const supplier = await this.prisma.supplier.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name.trim(), normalizedName: normalizeSupplierName(input.name) } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    await writeAudit(this.prisma, actorFor(user), {
      action: AuditAction.SUPPLIER_UPDATED,
      entityType: AuditEntity.SUPPLIER,
      entityId: id,
      oldValue: { name: existing.name, isActive: existing.isActive },
      newValue: { name: supplier.name, isActive: supplier.isActive },
    });
    return supplier;
  }
}

@ApiTags('Reference data')
@ApiCookieAuth()
@Controller()
export class ReferenceDataController {
  constructor(private readonly service: ReferenceDataService) {}

  @Get('departments')
  @ApiOperation({ summary: 'List departments' })
  departments() {
    return this.service.departments();
  }

  @Get('suppliers')
  @ApiOperation({ summary: 'Search the supplier master' })
  suppliers(@Query() query: ListSuppliersQueryDto) {
    return this.service.suppliers(query);
  }

  @Post('suppliers')
  @RequirePermissions(Permission.REFERENCE_DATA_MANAGE)
  createSupplier(@CurrentUser() user: AuthUser, @Body() body: CreateSupplierDto) {
    return this.service.createSupplier(user, body);
  }

  @Patch('suppliers/:id')
  @RequirePermissions(Permission.REFERENCE_DATA_MANAGE)
  updateSupplier(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateSupplierDto) {
    return this.service.updateSupplier(user, id, body);
  }
}
