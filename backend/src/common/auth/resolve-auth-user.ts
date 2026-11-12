import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../types/auth-user';

export interface AccessTokenPayload {
  sub: number;
  sid: string;
}

/**
 * Xác thực access token và nạp thông tin người dùng + quyền từ DB.
 * Kiểm tra phiên chưa bị thu hồi & tài khoản chưa bị khóa (FR-ADM-01, FR-ADM-03).
 * Dùng chung cho HTTP guard và WebSocket gateway.
 */
export async function resolveAuthUser(
  prisma: PrismaService,
  jwt: JwtService,
  token: string,
): Promise<AuthUser> {
  let payload: AccessTokenPayload;
  try {
    payload = await jwt.verifyAsync<AccessTokenPayload>(token);
  } catch {
    throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
  }
  const session = await prisma.userSession.findUnique({
    where: { id: payload.sid },
    include: { user: { include: { role: true } } },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.userId !== payload.sub) {
    throw new UnauthorizedException('Phiên đăng nhập đã hết hạn hoặc bị thu hồi');
  }
  if (session.user.status !== 'ACTIVE') {
    throw new UnauthorizedException('Tài khoản đã bị khóa');
  }
  const { user } = session;
  return {
    id: user.id,
    sessionId: session.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    roleCode: user.role.code,
    permissions: user.role.permissions,
    branchId: user.branchId,
  };
}

export function extractBearerToken(header?: string | string[]): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const [type, token] = value.split(' ');
  return type?.toLowerCase() === 'bearer' && token ? token : null;
}
