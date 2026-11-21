import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PERMISSIONS_KEY } from '../decorators';
import { AuthUser, hasPermission } from '../types/auth-user';

/** Kiểm tra quyền theo @RequirePermissions(...) - RBAC (FR-ADM-02, NFR-03). */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest<Request & { user?: AuthUser }>().user;
    if (!user) throw new UnauthorizedException('Bạn cần đăng nhập');
    if (required.some((p) => hasPermission(user, p))) return true;
    throw new ForbiddenException(`Bạn không có quyền thực hiện thao tác này (cần: ${required.join(' | ')})`);
  }
}
