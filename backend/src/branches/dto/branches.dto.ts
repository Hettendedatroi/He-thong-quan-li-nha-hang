import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateBranchDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsOptional()
  @IsString()
  phone?: string;

  /** Giờ mở cửa "HH:mm" */
  @IsOptional()
  @Matches(HHMM, { message: 'openTime dạng HH:mm' })
  openTime?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'closeTime dạng HH:mm' })
  closeTime?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateBranchDto extends PartialType(CreateBranchDto) {}

export class CreateZoneDto {
  @IsInt()
  branchId: number;

  @IsString()
  @IsNotEmpty()
  name: string;

  /** INDOOR | OUTDOOR | VIP | ROOFTOP ... */
  @IsOptional()
  @IsString()
  locationType?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateZoneDto extends PartialType(CreateZoneDto) {}

export class CreateTableDto {
  @IsInt()
  zoneId: number;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsInt()
  @Min(1)
  @Max(50)
  capacity: number;

  @IsOptional()
  @IsInt()
  posX?: number;

  @IsOptional()
  @IsInt()
  posY?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTableDto extends PartialType(CreateTableDto) {}

export class BranchQueryDto {
  @IsOptional()
  @IsInt()
  branchId?: number;
}
