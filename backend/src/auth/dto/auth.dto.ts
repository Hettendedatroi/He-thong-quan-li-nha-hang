import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export const PHONE_REGEX = /^(\+?84|0)\d{9,10}$/;
/** US-6 AC1, DoD A-03: mật khẩu tối thiểu 8 ký tự */
export const MIN_PASSWORD_LENGTH = 8;
/** US-18: tên đăng nhập của nhân viên (chữ thường, số, dấu chấm, gạch dưới) */
export const USERNAME_REGEX = /^[a-z0-9._]{3,30}$/;

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName: string;

  /** US-6 AC1: email là bắt buộc và duy nhất */
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email: string;

  @IsOptional()
  @Matches(PHONE_REGEX, { message: 'Số điện thoại không hợp lệ' })
  phone?: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, { message: `Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự` })
  @MaxLength(100)
  password: string;
}

export class LoginDto {
  /** Tên đăng nhập (nhân viên), email hoặc số điện thoại */
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

export class SocialLoginDto {
  @IsIn(['GOOGLE', 'FACEBOOK'])
  provider: 'GOOGLE' | 'FACEBOOK';

  /** Google: id_token; Facebook: access_token */
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class UpdateProfileDto {
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
  avatarUrl?: string;

  /** FR-24: bật / tắt nhận thông báo khuyến mãi */
  @IsOptional()
  @IsBoolean()
  promoOptIn?: boolean;

  @IsOptional()
  @IsString()
  language?: string;
}

export class ChangePasswordDto {
  @IsOptional()
  @IsString()
  currentPassword?: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, { message: `Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự` })
  @MaxLength(100)
  newPassword: string;
}
