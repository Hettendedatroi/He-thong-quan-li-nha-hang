import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ClientMeta, CurrentUser, Public } from '../common/decorators';
import type { RequestMeta } from '../common/decorators';
import type { AuthUser } from '../common/types/auth-user';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  SocialLoginDto,
  UpdateProfileDto,
} from './dto/auth.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** FR-25: đăng ký tài khoản khách hàng */
  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto, @ClientMeta() meta: RequestMeta) {
    return this.auth.register(dto, meta);
  }

  /** FR-25: đăng nhập bằng email hoặc số điện thoại (dùng chung cho nhân viên) */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto, @ClientMeta() meta: RequestMeta) {
    return this.auth.login(dto, meta);
  }

  /** FR-25: đăng nhập mạng xã hội */
  @Public()
  @HttpCode(200)
  @Post('social')
  social(@Body() dto: SocialLoginDto, @ClientMeta() meta: RequestMeta) {
    return this.auth.socialLogin(dto, meta);
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto, @ClientMeta() meta: RequestMeta) {
    return this.auth.refresh(dto.refreshToken, meta);
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('logout')
  logout(@CurrentUser() user: AuthUser) {
    return this.auth.logout(user.sessionId);
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @ApiBearerAuth()
  @Patch('me')
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user.id, dto);
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('change-password')
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, user.sessionId, dto);
  }

  /** Các phiên đăng nhập đang hoạt động của tôi */
  @ApiBearerAuth()
  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user.id);
  }

  @ApiBearerAuth()
  @Delete('sessions/:id')
  revokeSession(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.auth.revokeSession(user.id, id);
  }
}
