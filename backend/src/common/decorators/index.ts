import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Transform } from 'class-transformer';
import type { Request } from 'express';
import type { PermissionCode } from '../constants/permissions';
import type { AuthUser } from '../types/auth-user';

export const IS_PUBLIC_KEY = 'isPublic';
/** Route không bắt buộc đăng nhập (nếu có token hợp lệ vẫn gắn req.user). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'permissions';
/** Yêu cầu người dùng có ÍT NHẤT MỘT trong các quyền được liệt kê. */
export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Lấy người dùng hiện tại (undefined nếu là khách vãng lai trên route @Public). */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
  return req.user;
});

export const ClientMeta = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
});

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

/** Chuyển "true"/"false" trong query string thành boolean. */
export const ToBoolean = () =>
  Transform(({ obj, key }) => {
    const raw = obj[key];
    if (raw === undefined || raw === null || raw === '') return undefined;
    return raw === true || raw === 'true' || raw === '1';
  });
