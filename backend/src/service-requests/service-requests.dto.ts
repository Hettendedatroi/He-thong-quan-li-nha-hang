import { Priority, ServiceRequestStatus, ServiceRequestType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateServiceRequestDto {
  /** FR-13: CALL_STAFF, MORE_ITEMS, REQUEST_BILL, CHANGE_ITEM, CANCEL_ITEM, OTHER */
  @IsEnum(ServiceRequestType)
  type: ServiceRequestType;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  message?: string;

  /** Bắt buộc với CHANGE_ITEM / CANCEL_ITEM */
  @IsOptional()
  @IsInt()
  orderItemId?: number;
}

export class ListServiceRequestsQueryDto {
  @IsOptional()
  @IsInt()
  branchId?: number;

  @IsOptional()
  @IsEnum(ServiceRequestStatus)
  status?: ServiceRequestStatus;

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;
}

export class ResolveServiceRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  response?: string;
}
