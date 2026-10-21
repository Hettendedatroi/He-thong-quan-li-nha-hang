import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/utils/pagination';

/** US-2: số lượng mỗi món 1-20, ghi chú tối đa 100 ký tự */
export const MAX_ITEM_QUANTITY = 20;
export const MAX_NOTE_LENGTH = 100;

export class OrderItemInputDto {
  /** Truyền menuItemId HOẶC comboId */
  @IsOptional()
  @IsInt()
  menuItemId?: number;

  @IsOptional()
  @IsInt()
  comboId?: number;

  @IsInt()
  @Min(1)
  @Max(MAX_ITEM_QUANTITY)
  quantity: number;

  /** FR-10: ghi chú món (ít cay, không hành...) */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  note?: string;
}

export class CreateCustomerOrderDto {
  /** Bỏ trống => đặt toàn bộ giỏ hàng của bàn */
  @ApiProperty({ type: () => OrderItemInputDto, isArray: true, required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items?: OrderItemInputDto[];

  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  note?: string;
}

export class CreateStaffOrderDto {
  /** US-10 AC1: chọn bàn (hệ thống tự mở phiên nếu bàn chưa có) */
  @IsOptional()
  @IsInt()
  tableId?: number;

  /** Hoặc truyền phiên bàn đang mở */
  @IsOptional()
  @IsInt()
  sessionId?: number;

  @ApiProperty({ type: () => OrderItemInputDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items: OrderItemInputDto[];

  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  note?: string;

  /** 0 = thường, 1 = ưu tiên, 2 = gấp */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  priority?: number;
}

export class CartItemDto extends OrderItemInputDto {}

export class UpdateCartItemDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_ITEM_QUANTITY)
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  note?: string;
}

export class UpdateOrderItemDto extends UpdateCartItemDto {}

export class CancelOrderItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class SetPriorityDto {
  @IsInt()
  @Min(0)
  @Max(2)
  priority: number;
}

export class ListOrdersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsInt()
  branchId?: number;

  @IsOptional()
  @IsIn(Object.values(OrderStatus))
  status?: OrderStatus;

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

export class KitchenQueueQueryDto {
  @IsOptional()
  @IsInt()
  branchId?: number;
}

export class KitchenStatusDto {
  /** FR-KIT-03: RECEIVED (đã nhận) -> PREPARING (đang làm) -> READY (hoàn thành) -> SERVED (đã giao phục vụ) */
  @IsIn(['RECEIVED', 'PREPARING', 'READY', 'SERVED'])
  status: 'RECEIVED' | 'PREPARING' | 'READY' | 'SERVED';
}
