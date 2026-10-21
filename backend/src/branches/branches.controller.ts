import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '../common/constants/permissions';
import { CurrentUser, Public, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/types/auth-user';
import { BranchesService } from './branches.service';
import {
  BranchQueryDto,
  CreateBranchDto,
  CreateTableDto,
  CreateZoneDto,
  UpdateBranchDto,
  UpdateTableDto,
  UpdateZoneDto,
} from './dto/branches.dto';

@ApiTags('Public - Chi nhánh')
@Public()
@Controller('public/branches')
export class PublicBranchesController {
  constructor(private readonly branches: BranchesService) {}

  /** FR-01: khách chọn chi nhánh */
  @Get()
  list() {
    return this.branches.listBranches(true);
  }

  /** Chi tiết chi nhánh + khu vực (để chọn vị trí bàn mong muốn) */
  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.branches.getBranch(id);
  }
}

@ApiTags('Admin - Chi nhánh & Sơ đồ bàn')
@ApiBearerAuth()
@Controller('admin')
export class BranchesAdminController {
  constructor(private readonly branches: BranchesService) {}

  // FR-ADM-05
  @Get('branches')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.TABLE_CONFIGURE)
  listBranches() {
    return this.branches.listBranches();
  }

  @Post('branches')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  createBranch(@CurrentUser() user: AuthUser, @Body() dto: CreateBranchDto) {
    return this.branches.createBranch(user.id, dto);
  }

  @Patch('branches/:id')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  updateBranch(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBranchDto) {
    return this.branches.updateBranch(user.id, id, dto);
  }

  // FR-ADM-06
  @Get('zones')
  @RequirePermissions(PERMISSIONS.TABLE_CONFIGURE)
  listZones(@Query() q: BranchQueryDto) {
    return this.branches.listZones(q.branchId);
  }

  @Post('zones')
  @RequirePermissions(PERMISSIONS.TABLE_CONFIGURE)
  createZone(@CurrentUser() user: AuthUser, @Body() dto: CreateZoneDto) {
    return this.branches.createZone(user.id, dto);
  }

  @Patch('zones/:id')
  @RequirePermissions(PERMISSIONS.TABLE_CONFIGURE)
  updateZone(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateZoneDto) {
    return this.branches.updateZone(user.id, id, dto);
  }

  @Delete('zones/:id')
  @RequirePermissions(PERMISSIONS.TABLE_CONFIGURE)
  deleteZone(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.branches.deleteZone(user.id, id);
  }

  @Get('tables')
  @RequirePermissions(PERMISSIONS.TABLE_CONFIGURE)
  listTables(@Query() q: BranchQueryDto) {
    return this.branches.listTables(q.branchId);
  }

  @Post('tables')
  @RequirePermissions(PERMISSIONS.TABLE_CONFIGURE)
  createTable(@CurrentUser() user: AuthUser, @Body() dto: CreateTableDto) {
    return this.branches.createTable(user.id, dto);
  }

  @Patch('tables/:id')
  @RequirePermissions(PERMISSIONS.TABLE_CONFIGURE)
  updateTable(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTableDto) {
    return this.branches.updateTable(user.id, id, dto);
  }

  @Delete('tables/:id')
  @RequirePermissions(PERMISSIONS.TABLE_CONFIGURE)
  deleteTable(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.branches.deleteTable(user.id, id);
  }

  /** FR-07: lấy ảnh QR của bàn để in */
  @Get('tables/:id/qr')
  @RequirePermissions(PERMISSIONS.TABLE_CONFIGURE, PERMISSIONS.TABLE_OPERATE)
  tableQr(@Param('id', ParseIntPipe) id: number) {
    return this.branches.tableQr(id);
  }

  @Post('tables/:id/regenerate-qr')
  @RequirePermissions(PERMISSIONS.TABLE_CONFIGURE)
  regenerateQr(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.branches.regenerateQr(user.id, id);
  }
}
