import { PartialType } from '@nestjs/swagger';
import { ReportFrequency } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ToBoolean } from '../../common/decorators';

export const REPORT_TYPES = ['revenue', 'dishes', 'reservations', 'feedback'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export const EXPORT_FORMATS = ['xlsx', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export class RangeQueryDto {
  /** YYYY-MM-DD hoặc ISO. Mặc định 30 ngày gần nhất */
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  /** FR-MGR-15: lọc theo chi nhánh */
  @IsOptional()
  @IsInt()
  branchId?: number;
}

export class RevenueQueryDto extends RangeQueryDto {
  /** FR-MGR-01: theo ca / ngày / tuần / tháng / năm */
  @IsOptional()
  @IsIn(['shift', 'day', 'week', 'month', 'year'])
  groupBy?: 'shift' | 'day' | 'week' | 'month' | 'year';

  /** So sánh với kỳ liền trước (mặc định true) */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  compare?: boolean;
}

export class OperationsQueryDto extends RangeQueryDto {
  /** FR-MGR-02: theo ca / ngày */
  @IsOptional()
  @IsIn(['shift', 'day'])
  groupBy?: 'shift' | 'day';
}

export class DishesQueryDto extends RangeQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class PopularDishesQueryDto {
  @IsOptional()
  @IsInt()
  branchId?: number;

  /** FR-WAT-03: ca hiện tại hoặc hôm nay */
  @IsOptional()
  @IsIn(['shift', 'day'])
  period?: 'shift' | 'day';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class ShiftMonitorQueryDto {
  @IsOptional()
  @IsInt()
  branchId?: number;
}

export class ExportQueryDto extends RangeQueryDto {
  /** FR-MGR-14: revenue | dishes | reservations | feedback */
  @IsIn(REPORT_TYPES)
  type: ReportType;

  @IsIn(EXPORT_FORMATS)
  format: ExportFormat;
}

export class CreateReportScheduleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsIn(REPORT_TYPES)
  reportType: ReportType;

  @IsIn(EXPORT_FORMATS)
  format: ExportFormat;

  @IsEnum(ReportFrequency)
  frequency: ReportFrequency;

  @IsArray()
  @ArrayMinSize(1)
  @IsEmail({}, { each: true })
  recipients: string[];

  @IsOptional()
  @IsInt()
  branchId?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateReportScheduleDto extends PartialType(CreateReportScheduleDto) {}
