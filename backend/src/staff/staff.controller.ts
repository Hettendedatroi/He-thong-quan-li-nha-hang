import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '../common/constants/permissions';
import { CurrentUser, Public, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/types/auth-user';
import { isStaff } from '../common/types/auth-user';
import { PaginationQueryDto } from '../common/utils/pagination';
import {
  AssignShiftDto,
  AttendanceQueryDto,
  CreateIncidentDto,
  CreateShiftDto,
  CreateShiftReportDto,
  IncidentsQueryDto,
  ResolveIncidentDto,
  ShiftReportPreviewQueryDto,
  ShiftReportsQueryDto,
  ShiftsQueryDto,
  StaffQueryDto,
  TimekeeperEventDto,
  UpdateAttendanceDto,
  UpdateShiftDto,
} from './dto/staff.dto';
import { StaffService } from './staff.service';

function assertStaffUser(user: AuthUser) {
  if (!isStaff(user)) throw new ForbiddenException('Chức năng dành cho nhân viên');
}

@ApiTags('Quản lý - Nhân viên & Ca làm')
@ApiBearerAuth()
@Controller()
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  /** FR-MGR-17: danh sách nhân viên (kèm ca hôm nay) */
  @Get('staff')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE, PERMISSIONS.SHIFT_MONITOR)
  list(@CurrentUser() user: AuthUser, @Query() q: StaffQueryDto) {
    return this.staff.listStaff(user, q.branchId, q.roleCode);
  }

  @Get('shifts')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE, PERMISSIONS.SHIFT_MONITOR)
  shifts(@CurrentUser() user: AuthUser, @Query() q: ShiftsQueryDto) {
    return this.staff.listShifts(user, q);
  }

  /** Ca làm của tôi */
  @Get('shifts/me')
  myShifts(@CurrentUser() user: AuthUser) {
    assertStaffUser(user);
    return this.staff.myShifts(user.id);
  }

  /** FR-MGR-17: tạo ca & phân công */
  @Post('shifts')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  createShift(@CurrentUser() user: AuthUser, @Body() dto: CreateShiftDto) {
    return this.staff.createShift(user, dto);
  }

  @Patch('shifts/:id')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  updateShift(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateShiftDto) {
    return this.staff.updateShift(user, id, dto);
  }

  @Delete('shifts/:id')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  deleteShift(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.staff.deleteShift(user, id);
  }

  @Post('shifts/:id/assignments')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  assign(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: AssignShiftDto) {
    return this.staff.assign(user, id, dto);
  }

  @Delete('shifts/:id/assignments/:userId')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  unassign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.staff.unassign(user, id, userId);
  }
}

@ApiTags('Nhân viên - Chấm công')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly staff: StaffService) {}

  @Post('check-in')
  checkIn(@CurrentUser() user: AuthUser) {
    assertStaffUser(user);
    return this.staff.checkIn(user);
  }

  @Post('check-out')
  checkOut(@CurrentUser() user: AuthUser) {
    assertStaffUser(user);
    return this.staff.checkOut(user.id);
  }

  @Get('me')
  mine(@CurrentUser() user: AuthUser, @Query() q: PaginationQueryDto) {
    assertStaffUser(user);
    return this.staff.listAttendance(user, q, user.id);
  }

  /** FR-MGR-18: theo dõi chấm công */
  @Get()
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  list(@CurrentUser() user: AuthUser, @Query() q: AttendanceQueryDto) {
    return this.staff.listAttendance(user, q);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAttendanceDto) {
    return this.staff.updateAttendance(user, id, dto);
  }

  /** FR-MGR-18: tích hợp máy chấm công (gửi header x-api-key) */
  @Public()
  @Post('timekeeper')
  @ApiHeader({ name: 'x-api-key', required: true })
  timekeeper(@Headers('x-api-key') apiKey: string | undefined, @Body() dto: TimekeeperEventDto) {
    return this.staff.timekeeperEvent(apiKey, dto);
  }
}

@ApiTags('Phục vụ - Báo cáo cuối ca & Sự cố')
@ApiBearerAuth()
@Controller()
export class ShiftOpsController {
  constructor(private readonly staff: StaffService) {}

  /** FR-WAT-18: xem trước số liệu cuối ca */
  @Get('shift-reports/preview')
  @RequirePermissions(PERMISSIONS.SHIFT_REPORT_SUBMIT)
  preview(@CurrentUser() user: AuthUser, @Query() q: ShiftReportPreviewQueryDto) {
    return this.staff.previewShiftReport(user, q.shiftId, q.branchId);
  }

  /** FR-WAT-18: gửi báo cáo cuối ca cho Quản lý */
  @Post('shift-reports')
  @RequirePermissions(PERMISSIONS.SHIFT_REPORT_SUBMIT)
  submit(@CurrentUser() user: AuthUser, @Body() dto: CreateShiftReportDto) {
    return this.staff.submitShiftReport(user, dto);
  }

  @Get('shift-reports')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE, PERMISSIONS.REPORT_VIEW)
  reports(@CurrentUser() user: AuthUser, @Query() q: ShiftReportsQueryDto) {
    return this.staff.listShiftReports(user, q);
  }

  @Get('shift-reports/:id')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE, PERMISSIONS.REPORT_VIEW)
  report(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.staff.getShiftReport(user, id);
  }

  /** FR-WAT-17: sự cố / khiếu nại trong ca */
  @Get('incidents')
  @RequirePermissions(PERMISSIONS.INCIDENT_MANAGE)
  incidents(@CurrentUser() user: AuthUser, @Query() q: IncidentsQueryDto) {
    return this.staff.listIncidents(user, q);
  }

  @Post('incidents')
  @RequirePermissions(PERMISSIONS.INCIDENT_MANAGE)
  createIncident(@CurrentUser() user: AuthUser, @Body() dto: CreateIncidentDto) {
    return this.staff.createIncident(user, dto);
  }

  @Post('incidents/:id/resolve')
  @RequirePermissions(PERMISSIONS.INCIDENT_MANAGE)
  resolveIncident(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ResolveIncidentDto) {
    return this.staff.resolveIncident(user, id, dto.resolution);
  }
}
