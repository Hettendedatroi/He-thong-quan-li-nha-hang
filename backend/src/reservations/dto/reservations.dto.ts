import { ReservationStatus } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PHONE_REGEX } from '../../auth/dto/auth.dto';
import { PaginationQueryDto } from '../../common/utils/pagination';

export class AvailabilityQueryDto {
  @IsInt()
  branchId: number;

  /** Thời điểm đến, ISO 8601 có múi giờ, vd: 2026-10-20T19:00:00+07:00 */
  @IsDateString()
  startAt: string;

  @IsInt()
  @Min(1)
  @Max(50)
  partySize: number;

  @IsOptional()
  @IsInt()
  zoneId?: number;

  /** Vị trí mong muốn: INDOOR, OUTDOOR, VIP... (FR-01) */
  @IsOptional()
  @IsString()
  locationType?: string;
}

export class CreateReservationDto extends AvailabilityQueryDto {
  /** Chọn bàn cụ thể (tùy chọn) */
  @IsOptional()
  @IsInt()
  tableId?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  customerName: string;

  @Matches(PHONE_REGEX, { message: 'Số điện thoại không hợp lệ' })
  customerPhone: string;

  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  /** FR-03: BIRTHDAY, VEGETARIAN, ALLERGY, KIDS, WHEELCHAIR... */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  specialRequests?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class GuestLookupQueryDto {
  /** Khách vãng lai cần nhập SĐT đã dùng khi đặt để xem / sửa / hủy */
  @IsOptional()
  @IsString()
  phone?: string;
}

export class UpdateReservationDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  partySize?: number;

  @IsOptional()
  @IsInt()
  zoneId?: number;

  @IsOptional()
  @IsString()
  locationType?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  specialRequests?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class StaffUpdateReservationDto extends UpdateReservationDto {
  @IsOptional()
  @IsInt()
  tableId?: number;
}

export class CancelReservationDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class DepositDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsIn(['ONLINE', 'E_WALLET', 'BANK_TRANSFER'])
  method: 'ONLINE' | 'E_WALLET' | 'BANK_TRANSFER';
}

export class MockPaymentConfirmDto {
  /** true = thanh toán thành công, false = thất bại */
  @IsBoolean()
  success: boolean;
}

export class ListReservationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsInt()
  branchId?: number;

  /** Một ngày cụ thể YYYY-MM-DD (giờ địa phương) */
  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsEnum(ReservationStatus)
  status?: ReservationStatus;

  /** Tìm theo mã, tên, SĐT */
  @IsOptional()
  @IsString()
  search?: string;
}

export class ConfirmReservationDto {
  @IsOptional()
  @IsInt()
  tableId?: number;
}

export class RejectReservationDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class CheckInByCodeDto {
  /** Mã đặt bàn (quét từ QR) */
  @IsString()
  @IsNotEmpty()
  code: string;
}
