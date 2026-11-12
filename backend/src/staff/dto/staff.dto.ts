import { PartialType } from '@nestjs/swagger';
import { IncidentStatus, Priority } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/utils/pagination';

export class StaffQueryDto {
  @IsOptional()
  @IsInt()
  branchId?: number;

  @IsOptional()
  @IsString()
  roleCode?: string;
}

export class ShiftsQueryDto {
  @IsOptional()
  @IsInt()
  branchId?: number;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

export class CreateShiftDto {
  @IsOptional()
  @IsInt()
  branchId?: number;

  /** vd: Ca sáng, Ca chiều, Ca tối */
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsDateString()
  startAt: string;

  @IsDateString()
  endAt: string;

  @IsOptional()
  @IsString()
  note?: string;

  /** Nhân viên được phân vào ca */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  userIds?: number[];
}

export class UpdateShiftDto extends PartialType(CreateShiftDto) {}

export class AssignShiftDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  userIds: number[];

  /** Vị trí trong ca (thu ngân, phục vụ khu A...) */
  @IsOptional()
  @IsString()
  position?: string;
}

export class AttendanceQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsInt()
  userId?: number;

  @IsOptional()
  @IsInt()
  branchId?: number;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

export class TimekeeperEventDto {
  /** Định danh nhân viên: userId hoặc SĐT hoặc email */
  @IsOptional()
  @IsInt()
  userId?: number;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsIn(['IN', 'OUT'])
  type: 'IN' | 'OUT';

  @IsOptional()
  @IsDateString()
  timestamp?: string;
}

export class UpdateAttendanceDto {
  @IsOptional()
  @IsDateString()
  checkInAt?: string;

  @IsOptional()
  @IsDateString()
  checkOutAt?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateShiftReportDto {
  @IsOptional()
  @IsInt()
  shiftId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  incidentsSummary?: string;

  /** Món sắp hết / hết hàng; bỏ trống => tự lấy các món đang "tạm hết" */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  lowStockItems?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class ShiftReportPreviewQueryDto {
  @IsOptional()
  @IsInt()
  shiftId?: number;

  @IsOptional()
  @IsInt()
  branchId?: number;
}

export class ShiftReportsQueryDto extends ShiftsQueryDto {}

export class CreateIncidentDto {
  @IsOptional()
  @IsInt()
  branchId?: number;

  @IsIn(['COMPLAINT', 'ACCIDENT', 'EQUIPMENT', 'OTHER'])
  type: string;

  @IsOptional()
  @IsEnum(Priority)
  severity?: Priority;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description: string;

  @IsOptional()
  @IsInt()
  sessionId?: number;

  @IsOptional()
  @IsInt()
  tableId?: number;

  @IsOptional()
  @IsInt()
  feedbackId?: number;
}

export class ResolveIncidentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  resolution: string;
}

export class IncidentsQueryDto extends ShiftsQueryDto {
  @IsOptional()
  @IsEnum(IncidentStatus)
  status?: IncidentStatus;
}
