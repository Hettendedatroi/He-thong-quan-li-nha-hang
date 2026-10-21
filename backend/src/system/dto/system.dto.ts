import { PartialType } from '@nestjs/swagger';
import { DeviceType } from '@prisma/client';
import { IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/utils/pagination';

export class UpdateSettingDto {
  /** Các trường cần cập nhật của nhóm cấu hình (merge với giá trị hiện tại) */
  @IsObject()
  value: Record<string, unknown>;
}

export class CreateDeviceDto {
  @IsInt()
  branchId: number;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(DeviceType)
  type: DeviceType;
}

export class UpdateDeviceDto extends PartialType(CreateDeviceDto) {}

export class DeviceHeartbeatDto {
  @IsString()
  @IsNotEmpty()
  deviceKey: string;
}

export class ErrorLogQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
