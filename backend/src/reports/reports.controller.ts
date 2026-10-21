import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PERMISSIONS } from '../common/constants/permissions';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/types/auth-user';
import { requireBranch, scopeBranch } from '../common/utils/branch-scope';
import { parseDateRange } from '../common/utils/time';
import {
  CreateReportScheduleDto,
  DishesQueryDto,
  ExportQueryDto,
  OperationsQueryDto,
  PopularDishesQueryDto,
  RangeQueryDto,
  RevenueQueryDto,
  ShiftMonitorQueryDto,
  UpdateReportScheduleDto,
} from './dto/reports.dto';
import { ExportService } from './export.service';
import { ReportSchedulesService } from './report-schedules.service';
import { ReportsService } from './reports.service';

@ApiTags('Quản lý - Báo cáo & Thống kê')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly exporter: ExportService,
  ) {}

  /** FR-MGR-01: doanh thu theo ca / ngày / tuần / tháng / năm + so sánh kỳ trước */
  @Get('revenue')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  revenue(@CurrentUser() user: AuthUser, @Query() q: RevenueQueryDto) {
    const { from, to } = parseDateRange(q.from, q.to);
    return this.reports.revenue(from, to, scopeBranch(user, q.branchId), q.groupBy ?? 'day', q.compare ?? true);
  }

  /** FR-MGR-02: số khách, vòng quay bàn, thời gian phục vụ trung bình */
  @Get('operations')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  operations(@CurrentUser() user: AuthUser, @Query() q: OperationsQueryDto) {
    const { from, to } = parseDateRange(q.from, q.to);
    return this.reports.operations(from, to, scopeBranch(user, q.branchId), q.groupBy ?? 'day');
  }

  /** FR-MGR-03: món được thích nhất / nhiều đánh giá nhất / bị hủy nhiều nhất */
  @Get('dishes')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  dishes(@CurrentUser() user: AuthUser, @Query() q: DishesQueryDto) {
    const { from, to } = parseDateRange(q.from, q.to);
    return this.reports.dishes(from, to, scopeBranch(user, q.branchId), q.limit ?? 10);
  }

  /** FR-MGR-04: hiệu suất nhân viên */
  @Get('staff-performance')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  staff(@CurrentUser() user: AuthUser, @Query() q: RangeQueryDto) {
    const { from, to } = parseDateRange(q.from, q.to);
    return this.reports.staffPerformance(from, to, scopeBranch(user, q.branchId));
  }

  /** FR-MGR-05: tỉ lệ đặt bàn thành công / hủy / no-show */
  @Get('reservations')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  reservations(@CurrentUser() user: AuthUser, @Query() q: RangeQueryDto) {
    const { from, to } = parseDateRange(q.from, q.to);
    return this.reports.reservations(from, to, scopeBranch(user, q.branchId));
  }

  /** FR-WAT-03: món được gọi nhiều theo ca / ngày */
  @Get('popular-dishes')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW, PERMISSIONS.SHIFT_MONITOR, PERMISSIONS.ORDER_VIEW)
  popular(@CurrentUser() user: AuthUser, @Query() q: PopularDishesQueryDto) {
    return this.reports.popularDishes(requireBranch(user, q.branchId), q.period ?? 'day', q.limit ?? 10);
  }

  /** FR-WAT-15: giám sát hoạt động ca */
  @Get('shift-monitor')
  @RequirePermissions(PERMISSIONS.SHIFT_MONITOR, PERMISSIONS.REPORT_VIEW)
  shiftMonitor(@CurrentUser() user: AuthUser, @Query() q: ShiftMonitorQueryDto) {
    return this.reports.shiftMonitor(requireBranch(user, q.branchId));
  }

  /** FR-MGR-14, FR-MGR-15: xuất Excel / PDF */
  @Get('export')
  @RequirePermissions(PERMISSIONS.REPORT_EXPORT)
  @ApiProduces('application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async export(
    @CurrentUser() user: AuthUser,
    @Query() q: ExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { from, to } = parseDateRange(q.from, q.to);
    const file = await this.exporter.build(q.type, q.format, from, to, scopeBranch(user, q.branchId));
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
    });
    return new StreamableFile(file.buffer);
  }
}

@ApiTags('Quản lý - Lịch gửi báo cáo')
@ApiBearerAuth()
@RequirePermissions(PERMISSIONS.REPORT_EXPORT)
@Controller('reports/schedules')
export class ReportSchedulesController {
  constructor(private readonly schedules: ReportSchedulesService) {}

  @Get()
  list() {
    return this.schedules.list();
  }

  /** FR-MGR-16 */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReportScheduleDto) {
    return this.schedules.create(user.id, { ...dto, branchId: scopeBranch(user, dto.branchId) });
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateReportScheduleDto) {
    return this.schedules.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.schedules.remove(user.id, id);
  }

  /** Gửi thử ngay */
  @Post(':id/run')
  run(@Param('id', ParseIntPipe) id: number) {
    return this.schedules.runNow(id);
  }
}
