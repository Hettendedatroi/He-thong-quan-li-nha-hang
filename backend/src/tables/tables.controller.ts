import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { normalizePhone } from '../auth/auth.service';
import { PERMISSIONS } from '../common/constants/permissions';
import { CurrentUser, Public, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/types/auth-user';
import { assertBranchAccess, requireBranch, scopeBranch } from '../common/utils/branch-scope';
import { PrismaService } from '../prisma/prisma.service';
import {
  FloorPlanQueryDto,
  MergeTablesDto,
  MoveSessionDto,
  OpenSessionDto,
  SessionsQueryDto,
  SplitSessionDto,
  UpdateSessionDto,
  UpdateTableStatusDto,
} from './dto/tables.dto';
import { TableSessionsService } from './table-sessions.service';
import { TablesService } from './tables.service';

@ApiTags('Phục vụ - Bàn')
@ApiBearerAuth()
@Controller('tables')
export class TablesController {
  constructor(
    private readonly tables: TablesService,
    private readonly sessions: TableSessionsService,
    private readonly prisma: PrismaService,
  ) {}

  /** FR-WAT-02 */
  @Get('floor-plan')
  @RequirePermissions(PERMISSIONS.TABLE_VIEW)
  floorPlan(@CurrentUser() user: AuthUser, @Query() q: FloorPlanQueryDto) {
    return this.tables.floorPlan(requireBranch(user, q.branchId));
  }

  /** FR-WAT-11 */
  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.TABLE_OPERATE)
  updateStatus(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTableStatusDto) {
    return this.tables.updateStatus(user, id, dto.status);
  }

  /** Mở bàn cho khách vãng lai (walk-in) */
  @Post(':id/sessions')
  @RequirePermissions(PERMISSIONS.TABLE_OPERATE)
  async openSession(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: OpenSessionDto) {
    const table = await this.sessions.resolvePrimaryTable(id);
    assertBranchAccess(user, table.branchId);
    let customerId: number | undefined;
    if (dto.customerPhone) {
      const customer = await this.prisma.user.findFirst({
        where: { phone: normalizePhone(dto.customerPhone), role: { code: 'CUSTOMER' } },
      });
      if (!customer) throw new NotFoundException('Không tìm thấy khách hàng thành viên với số điện thoại này');
      customerId = customer.id;
    }
    const { session } = await this.sessions.openForTable(id, {
      guestCount: dto.guestCount,
      customerId,
      openedById: user.id,
    });
    return this.sessions.detail({ id: session.id });
  }

  /** FR-WAT-07: gộp bàn */
  @Post('merge')
  @RequirePermissions(PERMISSIONS.TABLE_OPERATE)
  merge(@CurrentUser() user: AuthUser, @Body() dto: MergeTablesDto) {
    return this.tables.merge(user, dto);
  }

  @Post(':id/unmerge')
  @RequirePermissions(PERMISSIONS.TABLE_OPERATE)
  unmerge(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.tables.unmerge(user, id);
  }
}

@ApiTags('Phục vụ - Phiên bàn')
@ApiBearerAuth()
@Controller('sessions')
export class TableSessionsController {
  constructor(private readonly sessions: TableSessionsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TABLE_VIEW, PERMISSIONS.ORDER_VIEW)
  list(@CurrentUser() user: AuthUser, @Query() q: SessionsQueryDto) {
    return this.sessions.list(scopeBranch(user, q.branchId), q.status);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TABLE_VIEW, PERMISSIONS.ORDER_VIEW)
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const detail = await this.sessions.detail({ id });
    assertBranchAccess(user, detail.branchId);
    return detail;
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.TABLE_OPERATE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSessionDto) {
    return this.sessions.update(user, id, dto);
  }

  /** FR-WAT-07: đổi bàn */
  @Post(':id/move')
  @RequirePermissions(PERMISSIONS.TABLE_OPERATE)
  move(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: MoveSessionDto) {
    return this.sessions.move(user, id, dto.toTableId);
  }

  /** FR-WAT-07: tách bàn */
  @Post(':id/split')
  @RequirePermissions(PERMISSIONS.TABLE_OPERATE)
  split(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SplitSessionDto) {
    return this.sessions.split(user, id, dto);
  }
}

@ApiTags('Public - Bàn (QR)')
@Public()
@Controller('public')
export class PublicTablesController {
  constructor(private readonly sessions: TableSessionsService) {}

  /** FR-07: quét QR trên bàn -> nhận sessionToken (không cần cài app) */
  @Post('tables/:qrToken/session')
  open(@Param('qrToken') qrToken: string, @CurrentUser() user?: AuthUser) {
    return this.sessions.openFromQr(qrToken, user);
  }

  /** FR-14, FR-15: xem trạng thái món & hóa đơn tạm tính của bàn */
  @Get('sessions/:token')
  async get(@Param('token') token: string) {
    await this.sessions.getByToken(token, false);
    const { token: _t, customer, ...detail } = await this.sessions.detail({ token });
    return { ...detail, customer: customer ? { fullName: customer.fullName, loyaltyPoints: customer.loyaltyPoints } : null };
  }
}
