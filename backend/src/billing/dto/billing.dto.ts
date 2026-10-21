import { BillStatus, PaymentMethod } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/utils/pagination';

export class GenerateBillDto {
  @IsInt()
  sessionId: number;

  /** FR-WAT-13: mã voucher */
  @IsOptional()
  @IsString()
  voucherCode?: string;

  /** FR-27: số điểm muốn đổi */
  @IsOptional()
  @IsInt()
  @Min(0)
  redeemPoints?: number;

  /** SĐT khách thành viên để tích / đổi điểm */
  @IsOptional()
  @IsString()
  customerPhone?: string;

  /** FR-WAT-16: giảm giá ngoài chính sách (cần quyền bill.discount_override) */
  @IsOptional()
  @IsInt()
  @Min(0)
  manualDiscount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  manualDiscountReason?: string;
}

export class SplitBillDto {
  /** EQUAL: chia đều N phần; ITEMS: chia theo nhóm món */
  @IsIn(['EQUAL', 'ITEMS'])
  mode: 'EQUAL' | 'ITEMS';

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(20)
  parts?: number;

  /** Với ITEMS: mỗi phần tử là danh sách id dòng hóa đơn (BillLine). Dòng còn lại tự gom vào nhóm cuối */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsArray({ each: true })
  groups?: number[][];
}

export class PayBillDto {
  /** FR-WAT-14: CASH, BANK_TRANSFER, E_WALLET, POS_CARD */
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  /** Số tiền khách đưa (tiền mặt có thể lớn hơn để thối lại) */
  @IsInt()
  @Min(1)
  amount: number;

  /** Mã giao dịch chuyển khoản / POS - được mã hóa khi lưu (NFR-03) */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class VoidBillDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason: string;
}

export class RefundBillDto {
  @IsInt()
  @Min(1)
  amount: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;
}

export class ListBillsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsInt()
  branchId?: number;

  @IsOptional()
  @IsEnum(BillStatus)
  status?: BillStatus;

  @IsOptional()
  @IsInt()
  sessionId?: number;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}
