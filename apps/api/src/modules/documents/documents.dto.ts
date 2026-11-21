import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { VERIFIABLE_FIELDS } from '@orchestra/domain';
import { PurchaseRequestItemDto } from '../purchase-requests/purchase-requests.dto';

export class VerifyDocumentDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Supplier from the supplier master (recommended)' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiProperty({ example: 'PT Sinar Jaya Abadi' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  supplierName: string;

  @ApiPropertyOptional({ example: 'INV/2026/11/0042' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  documentNumber?: string;

  @ApiPropertyOptional({ example: '2026-11-10' })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  documentDate?: string;

  @ApiProperty({ example: 'IDR' })
  @Matches(/^[A-Z]{3}$/)
  currency: string;

  @ApiProperty({ example: '2026-12-15' })
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  requiredDate: string;

  @ApiProperty({ example: 165000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000_000)
  taxAmount: number;

  @ApiProperty({ type: [PurchaseRequestItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PurchaseRequestItemDto)
  items: PurchaseRequestItemDto[];

  @ApiProperty({
    enum: VERIFIABLE_FIELDS,
    isArray: true,
    description: 'Low-confidence fields the requester explicitly confirmed after checking the document',
  })
  @IsArray()
  @ArrayUnique()
  @IsIn(VERIFIABLE_FIELDS as unknown as string[], { each: true })
  acknowledgedFields: string[];
}
