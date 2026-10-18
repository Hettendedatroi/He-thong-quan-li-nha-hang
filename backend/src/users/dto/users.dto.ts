import { UserStatus } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PHONE_REGEX } from '../../auth/dto/auth.dto';
import { PaginationQueryDto } from '../../common/utils/pagination';

export class ListUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  roleCode?: string;

  @IsOptional()
  @IsInt()
  branchId?: number;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsString()
  search?: string;
}

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @Matches(PHONE_REGEX, { message: 'Số điện thoại không hợp lệ' })
  phone?: string;

  @IsString()
  @MinLength(6)
  password: string;

  /** Mã vai trò: MANAGER, WAITER, SENIOR_WAITER, KITCHEN, ADMIN hoặc vai trò tự tạo */
  @IsString()
  @IsNotEmpty()
  roleCode: string;

  @IsOptional()
  @IsInt()
  branchId?: number;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @Matches(PHONE_REGEX, { message: 'Số điện thoại không hợp lệ' })
  phone?: string;

  @IsOptional()
  @IsString()
  roleCode?: string;

  /** null = bỏ gắn chi nhánh */
  @IsOptional()
  @IsInt()
  branchId?: number | null;
}

export class LockUserDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ResetPasswordDto {
  /** Bỏ trống để hệ thống sinh mật khẩu tạm */
  @IsOptional()
  @IsString()
  @MinLength(6)
  newPassword?: string;
}

export class CreateRoleDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{2,40}$/, { message: 'Mã vai trò dạng IN_HOA, vd: CASHIER' })
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions: string[];
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];
}

export class AuditLogQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsInt()
  userId?: number;

  @IsOptional()
  @IsString()
  entity?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}
