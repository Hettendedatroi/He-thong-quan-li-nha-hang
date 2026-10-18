import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '../common/constants/permissions';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/types/auth-user';
import {
  AuditLogQueryDto,
  CreateRoleDto,
  CreateUserDto,
  ListUsersQueryDto,
  LockUserDto,
  ResetPasswordDto,
  UpdateRoleDto,
  UpdateUserDto,
} from './dto/users.dto';
import { RolesService } from './roles.service';
import { UsersService } from './users.service';

@ApiTags('Admin - Tài khoản')
@ApiBearerAuth()
@RequirePermissions(PERMISSIONS.USER_MANAGE)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query() q: ListUsersQueryDto) {
    return this.users.list(q);
  }

  /** FR-ADM-01: tạo tài khoản Quản lý / Bếp / Phục vụ */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto) {
    return this.users.create(user.id, dto);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.users.get(id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    return this.users.update(user.id, id, dto);
  }

  @Post(':id/lock')
  lock(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: LockUserDto) {
    return this.users.setLocked(user.id, id, true, dto.reason);
  }

  @Post(':id/unlock')
  unlock(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.users.setLocked(user.id, id, false);
  }

  /** FR-ADM-03 */
  @Post(':id/reset-password')
  resetPassword(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ResetPasswordDto) {
    return this.users.resetPassword(user.id, id, dto.newPassword);
  }

  @Get(':id/sessions')
  sessions(@Param('id', ParseIntPipe) id: number) {
    return this.users.sessions(id);
  }

  @Delete(':id/sessions/:sessionId')
  revokeSession(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('sessionId') sessionId: string,
  ) {
    return this.users.revokeSession(user.id, id, sessionId);
  }

  @Delete(':id/sessions')
  revokeAll(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.users.revokeAllSessions(id, user.id);
  }
}

@ApiTags('Admin - Phân quyền')
@ApiBearerAuth()
@RequirePermissions(PERMISSIONS.ROLE_MANAGE)
@Controller('admin')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** Danh mục quyền để frontend dựng màn hình tick chọn quyền */
  @Get('permissions')
  permissions() {
    return this.roles.permissionCatalog();
  }

  @Get('roles')
  list() {
    return this.roles.list();
  }

  @Post('roles')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRoleDto) {
    return this.roles.create(user.id, dto);
  }

  @Patch('roles/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoleDto) {
    return this.roles.update(user.id, id, dto);
  }

  @Delete('roles/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.roles.remove(user.id, id);
  }
}

@ApiTags('Admin - Nhật ký')
@ApiBearerAuth()
@Controller('admin/audit-logs')
export class AuditLogsController {
  constructor(private readonly users: UsersService) {}

  /** FR-ADM-04, NFR-06 */
  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_VIEW)
  list(@Query() q: AuditLogQueryDto) {
    return this.users.auditLogs(q);
  }
}
