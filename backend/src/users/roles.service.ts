import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ALL_PERMISSIONS, PERMISSION_DESCRIPTIONS } from '../common/constants/permissions';
import { AuditService } from '../core/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/users.dto';

/** FR-ADM-02: cấu hình RBAC chi tiết, kể cả các cấp quyền trong nhóm Phục vụ */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  permissionCatalog() {
    return ALL_PERMISSIONS.map((code) => ({
      code,
      module: code.split('.')[0],
      description: PERMISSION_DESCRIPTIONS[code],
    }));
  }

  async list() {
    const roles = await this.prisma.role.findMany({
      orderBy: { id: 'asc' },
      include: { _count: { select: { users: true } } },
    });
    return roles.map(({ _count, ...r }) => ({ ...r, userCount: _count.users }));
  }

  async create(actorId: number, dto: CreateRoleDto) {
    this.validatePermissions(dto.permissions);
    const exists = await this.prisma.role.findUnique({ where: { code: dto.code } });
    if (exists) throw new ConflictException('Mã vai trò đã tồn tại');
    const role = await this.prisma.role.create({ data: { ...dto, isSystem: false } });
    await this.audit.log({ userId: actorId, action: 'role.create', entity: 'Role', entityId: role.id, data: dto });
    return role;
  }

  async update(actorId: number, id: number, dto: UpdateRoleDto) {
    const before = await this.prisma.role.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Không tìm thấy vai trò');
    if (dto.permissions) {
      this.validatePermissions(dto.permissions);
      if (before.code === 'ADMIN' && !dto.permissions.includes('*')) {
        throw new BadRequestException('Không thể bỏ toàn quyền của vai trò ADMIN');
      }
    }
    const role = await this.prisma.role.update({ where: { id }, data: dto });
    // NFR-06: ghi lại thay đổi phân quyền
    await this.audit.log({
      userId: actorId,
      action: 'role.update_permissions',
      entity: 'Role',
      entityId: id,
      data: { before: before.permissions, after: role.permissions },
    });
    return role;
  }

  async remove(actorId: number, id: number) {
    const role = await this.prisma.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
    if (!role) throw new NotFoundException('Không tìm thấy vai trò');
    if (role.isSystem) throw new BadRequestException('Không thể xóa vai trò hệ thống');
    if (role._count.users > 0) throw new BadRequestException('Vai trò đang được gán cho người dùng');
    await this.prisma.role.delete({ where: { id } });
    await this.audit.log({ userId: actorId, action: 'role.delete', entity: 'Role', entityId: id, data: { code: role.code } });
    return { ok: true };
  }

  private validatePermissions(perms: string[]) {
    const invalid = perms.filter((p) => p !== '*' && !ALL_PERMISSIONS.includes(p as never));
    if (invalid.length) throw new BadRequestException(`Quyền không hợp lệ: ${invalid.join(', ')}`);
  }
}
