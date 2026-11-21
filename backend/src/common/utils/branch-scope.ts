import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthUser } from '../types/auth-user';

/**
 * Nhân viên gắn với chi nhánh chỉ được thao tác trên chi nhánh của mình.
 * Admin / quản lý chuỗi (branchId = null) được chọn chi nhánh bất kỳ (undefined = tất cả).
 */
export function scopeBranch(user: AuthUser, requested?: number | null): number | undefined {
  if (user.branchId) return user.branchId;
  return requested ?? undefined;
}

export function requireBranch(user: AuthUser, requested?: number | null): number {
  const branchId = scopeBranch(user, requested);
  if (!branchId) throw new BadRequestException('Vui lòng chọn chi nhánh (branchId)');
  return branchId;
}

export function assertBranchAccess(user: AuthUser, entityBranchId: number) {
  if (user.branchId && user.branchId !== entityBranchId) {
    throw new ForbiddenException('Bạn không có quyền thao tác trên dữ liệu của chi nhánh khác');
  }
}
