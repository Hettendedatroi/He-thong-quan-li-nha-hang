import { PartialType } from '@nestjs/swagger';
import { PromotionScope, PromotionType } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ToBoolean } from '../../common/decorators';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreatePromotionDto {
  /** Bỏ trống = khuyến mãi tự động (vd happy hour). Có code = voucher khách nhập */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_-]{3,30}$/i, { message: 'Mã voucher gồm chữ, số, -, _ (3-30 ký tự)' })
  code?: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(PromotionType)
  type: PromotionType;

  /** PERCENT: 1-100; FIXED: số tiền VND */
  @IsInt()
  @Min(1)
  value: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxDiscount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minOrderAmount?: number;

  @IsOptional()
  @IsEnum(PromotionScope)
  scope?: PromotionScope;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  categoryIds?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  menuItemIds?: number[];

  @IsDateString()
  startAt: string;

  @IsDateString()
  endAt: string;

  /** 0 = CN ... 6 = T7; rỗng = mọi ngày */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[];

  /** Khung giờ happy hour "HH:mm" */
  @IsOptional()
  @Matches(HHMM)
  startTime?: string;

  @IsOptional()
  @Matches(HHMM)
  endTime?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number;

  @IsOptional()
  @IsInt()
  branchId?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePromotionDto extends PartialType(CreatePromotionDto) {}

export class ListPromotionsQueryDto {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  activeOnly?: boolean;

  @IsOptional()
  @IsInt()
  branchId?: number;
}

export class CheckVoucherDto {
  @IsString()
  @IsNotEmpty()
  code: string;
}
