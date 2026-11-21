import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { extractBearerToken, resolveAuthUser } from '../auth/resolve-auth-user';
import { IS_PUBLIC_KEY } from '../decorators';
import { AuthUser } from '../types/auth-user';

/** Guard toàn cục: mọi route mặc định cần đăng nhập, trừ route gắn @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Bạn cần đăng nhập');
    }
    try {
      req.user = await resolveAuthUser(this.prisma, this.jwt, token);
    } catch (err) {
      if (!isPublic) throw err;
    }
    return true;
  }
}
