import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { normalizePhone, toPublicUser } from '../auth/auth.service';
import type { AuthUser } from '../common/types/auth-user';
import { randomCode } from '../common/utils/codes';
import { paged, toSkipTake } from '../common/utils/pagination';
import { parseDateRange } from '../common/utils/time';
import { AuditService } from '../core/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogQueryDto, CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './dto/users.dto';

/** FR-ADM-01, FR-ADM-03, FR-ADM-04 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(q: ListUsersQueryDto) {
    const where: Prisma.UserWhereInput = {
      ...(q.roleCode ? { role: { code: q.roleCode } } : {}),
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { fullName: { contains: q.search, mode: 'insensitive' } },
              { username: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
              { phone: { contains: q.search } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { role: true, branch: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(q.page, q.limit),
      }),
      this.prisma.user.count({ where }),
    ]);
    return paged(
      items.map((u) => ({ ...toPublicUser(u), branch: u.branch })),
      total,
      q.page,
      q.limit,
    );
  }

  async get(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { role: true, branch: true } });
    if (!user) throw new NotFoundException('Không tìm thấy tài khoản');
    return { ...toPublicUser(user), branch: user.branch };
  }

  /** US-18 AC1: tài khoản nhân viên cần họ tên, tên đăng nhập duy nhất, vai trò, mật khẩu ban đầu */
  async create(actor: AuthUser, dto: CreateUserDto) {
    const role = await this.findRole(dto.roleCode);
    this.assertCanGrant(actor, role);
    const email = dto.email?.toLowerCase() ?? null;
    const phone = normalizePhone(dto.phone);
    await this.assertUnique({ username: dto.username, email, phone });
    if (dto.branchId) await this.prisma.branch.findUniqueOrThrow({ where: { id: dto.branchId } });

    const user = await this.prisma.user.create({
      data: {
        fullName: dto.fullName,
        username: dto.username,
        email,
        phone,
        passwordHash: await bcrypt.hash(dto.password, 10),
        roleId: role.id,
        branchId: dto.branchId ?? null,
      },
      include: { role: true },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'user.create',
      entity: 'User',
      entityId: user.id,
      data: { role: role.code, branchId: dto.branchId },
    });
    return toPublicUser(user);
  }

  async update(actor: AuthUser, id: number, dto: UpdateUserDto) {
    const before = await this.prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!before) throw new NotFoundException('Không tìm thấy tài khoản');
    this.assertCanGrant(actor, before.role);
    const email = dto.email?.toLowerCase();
    const phone = dto.phone ? normalizePhone(dto.phone) : undefined;
    await this.assertUnique({ username: dto.username, email, phone }, id);
    const role = dto.roleCode ? await this.findRole(dto.roleCode) : null;
    if (role) {
      this.assertCanGrant(actor, role);
      if (actor.id === id && role.id !== before.roleId) throw new BadRequestException('Không thể tự đổi vai trò của chính mình');
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        fullName: dto.fullName,
        username: dto.username,
        email,
        phone,
        roleId: role?.id,
        branchId: dto.branchId === undefined ? undefined : dto.branchId,
      },
      include: { role: true },
    });
    await this.audit.log({
      userId: actor.id,
      action: role && role.id !== before.roleId ? 'user.role_change' : 'user.update',
      entity: 'User',
      entityId: id,
      data: { before: { role: before.role.code, branchId: before.branchId }, after: dto },
    });
    return toPublicUser(user);
  }

  /** FR-ADM-01, US-18 AC2/AC4: khóa tài khoản + thu hồi mọi phiên đăng nhập; không tự khóa chính mình */
  async setLocked(actor: AuthUser, id: number, locked: boolean, reason?: string) {
    if (actor.id === id) throw new BadRequestException('Không thể tự khóa / mở khóa chính mình');
    await this.assertCanManageUser(actor, id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { status: locked ? 'LOCKED' : 'ACTIVE' },
      include: { role: true },
    });
    if (locked) await this.revokeAllSessions(id);
    await this.audit.log({
      userId: actor.id,
      action: locked ? 'user.lock' : 'user.unlock',
      entity: 'User',
      entityId: id,
      data: { reason },
    });
    return toPublicUser(user);
  }

  /** FR-ADM-03, US-18 AC3: đặt lại mật khẩu */
  async resetPassword(actor: AuthUser, id: number, newPassword?: string) {
    await this.assertCanManageUser(actor, id);
    const password = newPassword ?? `Rm@${randomCode(8)}`;
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 10) } });
    await this.revokeAllSessions(id);
    await this.audit.log({ userId: actor.id, action: 'user.reset_password', entity: 'User', entityId: id });
    return { ok: true, temporaryPassword: newPassword ? undefined : password };
  }

  /** FR-ADM-03: quản lý phiên đăng nhập */
  sessions(userId: number) {
    return this.prisma.userSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, userAgent: true, ipAddress: true, createdAt: true, lastUsedAt: true, expiresAt: true },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  async revokeSession(actorId: number, userId: number, sessionId: string) {
    const r = await this.prisma.userSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!r.count) throw new NotFoundException('Không tìm thấy phiên');
    await this.audit.log({ userId: actorId, action: 'user.revoke_session', entity: 'User', entityId: userId, data: { sessionId } });
    return { ok: true };
  }

  async revokeAllSessions(userId: number, actorId?: number) {
    const r = await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (actorId) {
      await this.audit.log({ userId: actorId, action: 'user.revoke_all_sessions', entity: 'User', entityId: userId });
    }
    return { revoked: r.count };
  }

  /** FR-ADM-04: tra cứu nhật ký hoạt động */
  async auditLogs(q: AuditLogQueryDto) {
    const range = q.from || q.to ? parseDateRange(q.from, q.to) : null;
    const where: Prisma.AuditLogWhereInput = {
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.action ? { action: { contains: q.action } } : {}),
      ...(range ? { createdAt: { gte: range.from, lt: range.to } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, fullName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(q.page, q.limit),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paged(items, total, q.page, q.limit);
  }

  private async findRole(code: string) {
    const role = await this.prisma.role.findUnique({ where: { code } });
    if (!role) throw new BadRequestException(`Vai trò "${code}" không tồn tại`);
    return role;
  }

  /**
   * Chống leo thang quyền: người không có "*" chỉ được gán / quản lý vai trò
   * có quyền nằm trong quyền của chính mình (vd. Quản lý không tạo được Admin).
   */
  private assertCanGrant(actor: AuthUser, role: Pick<Role, 'permissions'>) {
    if (actor.permissions.includes('*')) return;
    if (role.permissions.some((p) => p === '*' || !actor.permissions.includes(p))) {
      throw new ForbiddenException('Không thể quản lý tài khoản có quyền cao hơn bạn');
    }
  }

  private async assertCanManageUser(actor: AuthUser, id: number) {
    const target = await this.prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!target) throw new NotFoundException('Không tìm thấy tài khoản');
    this.assertCanGrant(actor, target.role);
  }

  private async assertUnique(
    fields: { username?: string | null; email?: string | null; phone?: string | null },
    exceptId?: number,
  ) {
    const or: Prisma.UserWhereInput[] = [];
    if (fields.username) or.push({ username: fields.username });
    if (fields.email) or.push({ email: fields.email });
    if (fields.phone) or.push({ phone: fields.phone });
    if (!or.length) return;
    const exists = await this.prisma.user.findFirst({
      where: { OR: or, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (exists) throw new ConflictException('Tên đăng nhập, email hoặc số điện thoại đã được sử dụng');
  }
}
