export interface AuthUser {
  id: number;
  sessionId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  roleCode: string;
  permissions: string[];
  /** null = không gắn chi nhánh (admin / quản lý chuỗi / khách hàng) */
  branchId: number | null;
}

export function hasPermission(user: AuthUser | undefined | null, permission: string): boolean {
  if (!user) return false;
  return user.permissions.includes('*') || user.permissions.includes(permission);
}

export function isStaff(user: AuthUser | undefined | null): boolean {
  return !!user && user.roleCode !== 'CUSTOMER';
}
