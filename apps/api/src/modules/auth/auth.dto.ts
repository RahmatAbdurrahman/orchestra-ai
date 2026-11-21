import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'requester@orchestra.local' })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ format: 'password' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}

export class DemoLoginDto {
  @ApiProperty({ example: 'approver.ops@orchestra.local' })
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ format: 'password', description: 'Required when changing the password' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  currentPassword?: string;

  @ApiPropertyOptional({ format: 'password', minLength: 12 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  newPassword?: string;
}
