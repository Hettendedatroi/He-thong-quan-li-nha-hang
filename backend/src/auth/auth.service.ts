import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ROLE_CODES } from '../common/constants/permissions';
import { RequestMeta } from '../common/decorators';
import { randomToken } from '../common/utils/codes';
import { addDays } from '../common/utils/time';
import { AuditService } from '../core/audit.service';
import { CryptoService } from '../core/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto, LoginDto, RegisterDto, SocialLoginDto, UpdateProfileDto } from './dto/auth.dto';

type UserWithRole = User & { role: Role };

export function toPublicUser(user: UserWithRole) {
  const { passwordHash: _p, providerId: _pid, ...rest } = user;
  return {
    ...rest,
    role: { id: user.role.id, code: user.role.code, name: user.role.name, permissions: user.role.permissions },
  };
}

export function normalizePhone(phone?: string | null): string | null {
  if (!phone) return null;
  const p = phone.replace(/[\s.-]/g, '');
  return p.startsWith('+84') ? `0${p.slice(3)}` : p.startsWith('84') && p.length > 10 ? `0${p.slice(2)}` : p;
}

/** FR-25, FR-ADM-03 */
@Injectable()
export class AuthService {
  private readonly accessTtl: number;
  private readonly refreshTtlDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {
    this.accessTtl = Number(config.get('JWT_ACCESS_TTL_SECONDS') ?? 900);
    this.refreshTtlDays = Number(config.get('REFRESH_TOKEN_TTL_DAYS') ?? 30);
  }

  async register(dto: RegisterDto, meta: RequestMeta) {
    const email = dto.email?.toLowerCase().trim() || null;
    const phone = normalizePhone(dto.phone);
    if (!email && !phone) throw new BadRequestException('Cần nhập email hoặc số điện thoại');
    await this.assertUnique(email, phone);

    const role = await this.prisma.role.findUniqueOrThrow({ where: { code: ROLE_CODES.CUSTOMER } });
    const user = await this.prisma.user.create({
      data: {
        fullName: dto.fullName.trim(),
        email,
        phone,
        passwordHash: await bcrypt.hash(dto.password, 10),
        roleId: role.id,
      },
      include: { role: true },
    });
    await this.audit.log({ userId: user.id, action: 'auth.register', entity: 'User', entityId: user.id, ip: meta.ip });
    return this.issueTokens(user, meta);
  }

  async login(dto: LoginDto, meta: RequestMeta) {
    const identifier = dto.identifier.trim();
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: identifier.toLowerCase() },
          { email: identifier.toLowerCase() },
          { phone: normalizePhone(identifier) ?? identifier },
        ],
      },
      include: { role: true },
    });
    if (!user?.passwordHash || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Sai tài khoản hoặc mật khẩu');
    }
    if (user.status === 'LOCKED') throw new ForbiddenException('Tài khoản đã bị khóa, vui lòng liên hệ quản trị viên');
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'auth.login', entity: 'User', entityId: user.id, ip: meta.ip });
    return this.issueTokens(user, meta);
  }

  /** Đăng nhập Google / Facebook (FR-25) - xác minh token với nhà cung cấp */
  async socialLogin(dto: SocialLoginDto, meta: RequestMeta) {
    const profile = await this.verifySocialToken(dto.provider, dto.token);
    let user = await this.prisma.user.findFirst({
      where: { provider: dto.provider, providerId: profile.id },
      include: { role: true },
    });
    if (!user && profile.email) {
      const byEmail = await this.prisma.user.findUnique({ where: { email: profile.email }, include: { role: true } });
      if (byEmail) {
        user = await this.prisma.user.update({
          where: { id: byEmail.id },
          data: { provider: dto.provider, providerId: profile.id, avatarUrl: byEmail.avatarUrl ?? profile.avatar },
          include: { role: true },
        });
      }
    }
    if (!user) {
      const role = await this.prisma.role.findUniqueOrThrow({ where: { code: ROLE_CODES.CUSTOMER } });
      user = await this.prisma.user.create({
        data: {
          fullName: profile.name ?? 'Khách hàng',
          email: profile.email,
          avatarUrl: profile.avatar,
          provider: dto.provider,
          providerId: profile.id,
          roleId: role.id,
        },
        include: { role: true },
      });
    }
    if (user.status === 'LOCKED') throw new ForbiddenException('Tài khoản đã bị khóa');
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ userId: user.id, action: `auth.login_${dto.provider.toLowerCase()}`, entity: 'User', entityId: user.id, ip: meta.ip });
    return this.issueTokens(user, meta);
  }

  /** Refresh token có dạng "<sessionId>.<secret>"; mỗi lần refresh sẽ xoay vòng secret */
  async refresh(refreshToken: string, meta: RequestMeta) {
    const [sessionId, secret] = refreshToken.split('.');
    if (!sessionId || !secret) throw new UnauthorizedException('Refresh token không hợp lệ');
    const session = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
      include: { user: { include: { role: true } } },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt < new Date() ||
      session.refreshTokenHash !== this.crypto.sha256(secret)
    ) {
      throw new UnauthorizedException('Refresh token không hợp lệ hoặc đã hết hạn');
    }
    if (session.user.status === 'LOCKED') throw new ForbiddenException('Tài khoản đã bị khóa');

    const newSecret = randomToken(32);
    await this.prisma.userSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: this.crypto.sha256(newSecret),
        lastUsedAt: new Date(),
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return {
      accessToken: await this.signAccess(session.userId, session.id),
      refreshToken: `${session.id}.${newSecret}`,
      expiresIn: this.accessTtl,
      user: toPublicUser(session.user),
    };
  }

  async logout(sessionId: string) {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  async me(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { role: true, branch: true } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    return { ...toPublicUser(user), branch: user.branch };
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    const email = dto.email?.toLowerCase().trim();
    const phone = dto.phone ? normalizePhone(dto.phone) : undefined;
    await this.assertUnique(email ?? null, phone ?? null, userId);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { ...dto, email, phone },
      include: { role: true },
    });
    return toPublicUser(user);
  }

  async changePassword(userId: number, currentSessionId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.passwordHash) {
      if (!dto.currentPassword || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
        throw new BadRequestException('Mật khẩu hiện tại không đúng');
      }
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, 10) },
    });
    // Đăng xuất các thiết bị khác
    await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null, id: { not: currentSessionId } },
      data: { revokedAt: new Date() },
    });
    await this.audit.log({ userId, action: 'auth.change_password', entity: 'User', entityId: userId });
    return { ok: true };
  }

  listSessions(userId: number) {
    return this.prisma.userSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, userAgent: true, ipAddress: true, createdAt: true, lastUsedAt: true, expiresAt: true },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  async revokeSession(userId: number, sessionId: string) {
    const r = await this.prisma.userSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!r.count) throw new NotFoundException('Không tìm thấy phiên đăng nhập');
    return { ok: true };
  }

  // ----------------------------------------------------------------- helpers

  private async issueTokens(user: UserWithRole, meta: RequestMeta) {
    const secret = randomToken(32);
    const session = await this.prisma.userSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: this.crypto.sha256(secret),
        userAgent: meta.userAgent,
        ipAddress: meta.ip,
        expiresAt: addDays(new Date(), this.refreshTtlDays),
      },
    });
    return {
      accessToken: await this.signAccess(user.id, session.id),
      refreshToken: `${session.id}.${secret}`,
      expiresIn: this.accessTtl,
      user: toPublicUser(user),
    };
  }

  private signAccess(userId: number, sessionId: string) {
    return this.jwt.signAsync({ sub: userId, sid: sessionId }, { expiresIn: this.accessTtl });
  }

  private async assertUnique(email: string | null, phone: string | null, exceptUserId?: number) {
    const or: Prisma.UserWhereInput[] = [];
    if (email) or.push({ email });
    if (phone) or.push({ phone });
    if (!or.length) return;
    const exists = await this.prisma.user.findFirst({
      where: { OR: or, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) },
    });
    if (exists) throw new ConflictException('Email hoặc số điện thoại đã được sử dụng');
  }

  private async verifySocialToken(provider: 'GOOGLE' | 'FACEBOOK', token: string) {
    try {
      if (provider === 'GOOGLE') {
        const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
        if (!res.ok) throw new Error('invalid');
        const data = (await res.json()) as { sub: string; email?: string; name?: string; picture?: string; aud?: string };
        const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
        if (clientId && data.aud !== clientId) throw new Error('aud mismatch');
        return { id: data.sub, email: data.email?.toLowerCase() ?? null, name: data.name ?? null, avatar: data.picture ?? null };
      }
      const res = await fetch(
        `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${encodeURIComponent(token)}`,
      );
      if (!res.ok) throw new Error('invalid');
      const data = (await res.json()) as { id: string; name?: string; email?: string; picture?: { data?: { url?: string } } };
      return {
        id: data.id,
        email: data.email?.toLowerCase() ?? null,
        name: data.name ?? null,
        avatar: data.picture?.data?.url ?? null,
      };
    } catch {
      throw new UnauthorizedException(`Không xác minh được tài khoản ${provider}`);
    }
  }
}
