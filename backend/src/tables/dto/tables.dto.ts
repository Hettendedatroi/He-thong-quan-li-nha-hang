import { SessionStatus, TableStatus } from '@prisma/client';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class FloorPlanQueryDto {
  @IsOptional()
  @IsInt()
  branchId?: number;
}

export class UpdateTableStatusDto {
  /** FR-WAT-11, US-9 AC1: vd CLEANING (Đang dọn dẹp) -> AVAILABLE (Trống) */
  @IsEnum(TableStatus)
  status: TableStatus;
}

export class OpenSessionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  guestCount?: number;

  /** SĐT khách thành viên để tích điểm (FR-27) */
  @IsOptional()
  @IsString()
  customerPhone?: string;
}

export class MergeTablesDto {
  /** Bàn chính (giữ phiên & hóa đơn) */
  @IsInt()
  targetTableId: number;

  /** Các bàn gộp vào bàn chính */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsInt({ each: true })
  tableIds: number[];
}

export class MoveSessionDto {
  @IsInt()
  toTableId: number;
}

export class SplitSessionDto {
  @IsInt()
  toTableId: number;

  /** Các món chuyển sang bàn mới */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsInt({ each: true })
  orderItemIds: number[];

  /** Số khách chuyển sang bàn mới */
  @IsOptional()
  @IsInt()
  @Min(1)
  guestCount?: number;
}

export class UpdateSessionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  guestCount?: number;

  @IsOptional()
  @IsString()
  customerPhone?: string;
}

export class SessionsQueryDto {
  @IsOptional()
  @IsInt()
  branchId?: number;

  @IsOptional()
  @IsEnum(SessionStatus)
  status?: SessionStatus;
}
