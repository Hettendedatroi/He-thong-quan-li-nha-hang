import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { normalizePhone } from '../auth/auth.service';
import type { AuthUser } from '../common/types/auth-user';
import { assertBranchAccess, requireBranch, scopeBranch } from '../common/utils/branch-scope';
import { paged, toSkipTake } from '../common/utils/pagination';
import { addDays, addMinutes, parseDateRange, startOfLocalDay } from '../common/utils/time';
import { AuditService } from '../core/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ReportsService } from '../reports/reports.service';
import {
  AssignShiftDto,
  AttendanceQueryDto,
  CreateIncidentDto,
  CreateShiftDto,
  CreateShiftReportDto,
  IncidentsQueryDto,
  ShiftReportsQueryDto,
  ShiftsQueryDto,
  TimekeeperEventDto,
  UpdateAttendanceDto,
  UpdateShiftDto,
} from './dto/staff.dto';

const USER_BRIEF = { select: { id: true, fullName: true, role: { select: { code: true, name: true } } } } as const;

/** FR-MGR-17, FR-MGR-18, FR-WAT-17, FR-WAT-18 */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  // =========================================================== Nhân viên & ca làm (FR-MGR-17)

  async listStaff(user: AuthUser, branchId?: number, roleCode?: string) {
    const b = scopeBranch(user, branchId);
    const dayStart = startOfLocalDay();
    return this.prisma.user.findMany({
      where: {
        role: { code: roleCode ? roleCode : { notIn: ['CUSTOMER'] } },
        ...(b ? { branchId: b } : {}),
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        status: true,
        branchId: true,
        role: { select: { code: true, name: true } },
        shiftAssignments: {
          where: { shift: { endAt: { gt: dayStart }, startAt: { lt: addDays(dayStart, 1) } } },
          select: { position: true, shift: { select: { id: true, name: true, startAt: true, endAt: true } } },
        },
      },
      orderBy: { fullName: 'asc' },
    });
  }

  listShifts(user: AuthUser, q: ShiftsQueryDto) {
    const b = scopeBranch(user, q.branchId);
    const { from, to } = parseDateRange(q.from, q.to, 7);
    return this.prisma.shift.findMany({
      where: { startAt: { gte: from, lt: addDays(to, 7) }, ...(b ? { branchId: b } : {}) },
      include: { assignments: { include: { user: USER_BRIEF } }, branch: { select: { id: true, name: true } } },
      orderBy: { startAt: 'asc' },
    });
  }

  myShifts(userId: number) {
    const from = addDays(startOfLocalDay(), -1);
    return this.prisma.shift.findMany({
      where: { assignments: { some: { userId } }, endAt: { gte: from } },
      include: { branch: { select: { id: true, name: true } } },
      orderBy: { startAt: 'asc' },
      take: 30,
    });
  }

  async createShift(user: AuthUser, dto: CreateShiftDto) {
    const branchId = requireBranch(user, dto.branchId);
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (startAt >= endAt) throw new BadRequestException('Giờ kết thúc phải sau giờ bắt đầu');
    if (dto.userIds?.length) await this.assertStaff(dto.userIds, branchId);
    const shift = await this.prisma.shift.create({
      data: {
        branchId,
        name: dto.name,
        startAt,
        endAt,
        note: dto.note,
        assignments: dto.userIds?.length ? { create: dto.userIds.map((userId) => ({ userId })) } : undefined,
      },
      include: { assignments: { include: { user: USER_BRIEF } } },
    });
    await this.audit.log({ userId: user.id, action: 'shift.create', entity: 'Shift', entityId: shift.id, data: dto });
    for (const a of shift.assignments) {
      this.realtime.toUser(a.userId, 'shift.assigned', { shiftId: shift.id, name: shift.name, startAt, endAt });
    }
    return shift;
  }

  async updateShift(user: AuthUser, id: number, dto: UpdateShiftDto) {
    const shift = await this.getShift(user, id);
    const startAt = dto.startAt ? new Date(dto.startAt) : shift.startAt;
    const endAt = dto.endAt ? new Date(dto.endAt) : shift.endAt;
    if (startAt >= endAt) throw new BadRequestException('Giờ kết thúc phải sau giờ bắt đầu');
    const updated = await this.prisma.shift.update({
      where: { id },
      data: { name: dto.name, note: dto.note, startAt, endAt },
      include: { assignments: { include: { user: USER_BRIEF } } },
    });
    await this.audit.log({ userId: user.id, action: 'shift.update', entity: 'Shift', entityId: id, data: dto });
    return updated;
  }

  async deleteShift(user: AuthUser, id: number) {
    await this.getShift(user, id);
    await this.prisma.shift.delete({ where: { id } });
    await this.audit.log({ userId: user.id, action: 'shift.delete', entity: 'Shift', entityId: id });
    return { ok: true };
  }

  async assign(user: AuthUser, shiftId: number, dto: AssignShiftDto) {
    const shift = await this.getShift(user, shiftId);
    await this.assertStaff(dto.userIds, shift.branchId);
    await this.prisma.shiftAssignment.createMany({
      data: dto.userIds.map((userId) => ({ shiftId, userId, position: dto.position })),
      skipDuplicates: true,
    });
    for (const userId of dto.userIds) {
      this.realtime.toUser(userId, 'shift.assigned', { shiftId, name: shift.name, startAt: shift.startAt, endAt: shift.endAt });
    }
    await this.audit.log({ userId: user.id, action: 'shift.assign', entity: 'Shift', entityId: shiftId, data: dto });
    return this.prisma.shift.findUnique({ where: { id: shiftId }, include: { assignments: { include: { user: USER_BRIEF } } } });
  }

  async unassign(user: AuthUser, shiftId: number, userId: number) {
    await this.getShift(user, shiftId);
    await this.prisma.shiftAssignment.deleteMany({ where: { shiftId, userId } });
    await this.audit.log({ userId: user.id, action: 'shift.unassign', entity: 'Shift', entityId: shiftId, data: { userId } });
    return { ok: true };
  }

  // =========================================================== Chấm công (FR-MGR-18)

  async checkIn(user: AuthUser, at = new Date(), source: 'MANUAL' | 'TIMEKEEPER' = 'MANUAL') {
    const open = await this.prisma.attendance.findFirst({
      where: { userId: user.id, checkOutAt: null, checkInAt: { gte: addMinutes(at, -16 * 60) } },
    });
    if (open) throw new BadRequestException('Bạn đã check-in và chưa check-out');
    const assignment = await this.prisma.shiftAssignment.findFirst({
      where: { userId: user.id, shift: { startAt: { lte: addMinutes(at, 60) }, endAt: { gt: at } } },
      include: { shift: true },
    });
    return this.prisma.attendance.create({
      data: {
        userId: user.id,
        branchId: user.branchId ?? assignment?.shift.branchId ?? null,
        shiftId: assignment?.shiftId ?? null,
        checkInAt: at,
        source,
      },
      include: { shift: { select: { id: true, name: true, startAt: true, endAt: true } } },
    });
  }

  async checkOut(userId: number, at = new Date()) {
    const open = await this.prisma.attendance.findFirst({
      where: { userId, checkOutAt: null },
      orderBy: { checkInAt: 'desc' },
    });
    if (!open) throw new BadRequestException('Bạn chưa check-in');
    return this.prisma.attendance.update({ where: { id: open.id }, data: { checkOutAt: at } });
  }

  async listAttendance(user: AuthUser, q: AttendanceQueryDto, onlyUserId?: number) {
    const b = onlyUserId ? undefined : scopeBranch(user, q.branchId);
    const range = q.from || q.to ? parseDateRange(q.from, q.to) : null;
    const where: Prisma.AttendanceWhereInput = {
      ...(onlyUserId ? { userId: onlyUserId } : q.userId ? { userId: q.userId } : {}),
      ...(b ? { branchId: b } : {}),
      ...(range ? { checkInAt: { gte: range.from, lt: range.to } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        include: { user: USER_BRIEF, shift: { select: { id: true, name: true, startAt: true, endAt: true } } },
        orderBy: { checkInAt: 'desc' },
        ...toSkipTake(q.page, q.limit),
      }),
      this.prisma.attendance.count({ where }),
    ]);
    const withHours = items.map((a) => ({
      ...a,
      workedMinutes: a.checkOutAt ? Math.round((a.checkOutAt.getTime() - a.checkInAt.getTime()) / 60_000) : null,
      lateMinutes: a.shift ? Math.max(0, Math.round((a.checkInAt.getTime() - a.shift.startAt.getTime()) / 60_000)) : null,
    }));
    return paged(withHours, total, q.page, q.limit);
  }

  async updateAttendance(user: AuthUser, id: number, dto: UpdateAttendanceDto) {
    const before = await this.prisma.attendance.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Không tìm thấy bản ghi chấm công');
    if (before.branchId) assertBranchAccess(user, before.branchId);
    const updated = await this.prisma.attendance.update({
      where: { id },
      data: {
        checkInAt: dto.checkInAt ? new Date(dto.checkInAt) : undefined,
        checkOutAt: dto.checkOutAt ? new Date(dto.checkOutAt) : undefined,
        note: dto.note,
      },
    });
    await this.audit.log({ userId: user.id, action: 'attendance.update', entity: 'Attendance', entityId: id, data: { before, after: dto } });
    return updated;
  }

  /** Webhook cho máy chấm công (vân tay / thẻ từ) - xác thực bằng header x-api-key */
  async timekeeperEvent(apiKey: string | undefined, dto: TimekeeperEventDto) {
    const expected = this.config.get<string>('TIMEKEEPER_API_KEY');
    if (!expected || apiKey !== expected) throw new UnauthorizedException('API key máy chấm công không hợp lệ');
    const or: Prisma.UserWhereInput[] = [];
    if (dto.userId) or.push({ id: dto.userId });
    if (dto.phone) or.push({ phone: normalizePhone(dto.phone) });
    if (dto.email) or.push({ email: dto.email.toLowerCase() });
    if (!or.length) throw new BadRequestException('Thiếu định danh nhân viên');
    const u = await this.prisma.user.findFirst({ where: { OR: or, role: { code: { not: 'CUSTOMER' } } }, include: { role: true } });
    if (!u) throw new NotFoundException('Không tìm thấy nhân viên');
    const at = dto.timestamp ? new Date(dto.timestamp) : new Date();
    if (dto.type === 'OUT') return this.checkOut(u.id, at);
    return this.checkIn(
      {
        id: u.id,
        sessionId: '',
        fullName: u.fullName,
        email: u.email,
        phone: u.phone,
        roleCode: u.role.code,
        permissions: u.role.permissions,
        branchId: u.branchId,
      },
      at,
      'TIMEKEEPER',
    );
  }

  // =========================================================== Báo cáo cuối ca (FR-WAT-18)

  async previewShiftReport(user: AuthUser, shiftId?: number, branchId?: number) {
    const { branch, shift, periodStart, periodEnd } = await this.resolvePeriod(user, shiftId, branchId);
    const [revenue, orderCount, sessions, incidents, outOfStock] = await Promise.all([
      this.reports.revenueSummary(periodStart, periodEnd, branch),
      this.prisma.order.count({ where: { branchId: branch, createdAt: { gte: periodStart, lt: periodEnd } } }),
      this.prisma.tableSession.aggregate({
        where: { branchId: branch, openedAt: { gte: periodStart, lt: periodEnd } },
        _sum: { guestCount: true },
      }),
      this.prisma.incident.findMany({
        where: { branchId: branch, createdAt: { gte: periodStart, lt: periodEnd } },
        select: { id: true, type: true, severity: true, description: true, status: true },
      }),
      this.prisma.menuItem.findMany({ where: { isAvailable: false, isDeleted: false }, select: { name: true } }),
    ]);
    return {
      branchId: branch,
      shift: shift ? { id: shift.id, name: shift.name } : null,
      periodStart,
      periodEnd,
      revenue: revenue.revenue,
      billCount: revenue.bills,
      revenueByMethod: revenue.byMethod,
      orderCount,
      guestCount: sessions._sum.guestCount ?? 0,
      incidents,
      lowStockItems: outOfStock.map((m) => m.name),
    };
  }

  async submitShiftReport(user: AuthUser, dto: CreateShiftReportDto) {
    const p = await this.previewShiftReport(user, dto.shiftId);
    const incidentsSummary =
      dto.incidentsSummary ??
      (p.incidents.length ? p.incidents.map((i) => `[${i.type}] ${i.description}`).join('\n') : 'Không có sự cố');
    const report = await this.prisma.shiftReport.create({
      data: {
        branchId: p.branchId,
        shiftId: p.shift?.id ?? null,
        submittedById: user.id,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        revenue: Math.round(p.revenue),
        billCount: p.billCount,
        orderCount: p.orderCount,
        guestCount: p.guestCount,
        incidentsSummary,
        lowStockItems: dto.lowStockItems ?? p.lowStockItems,
        notes: dto.notes,
      },
    });
    // Gửi tới Quản lý của chi nhánh
    const managers = await this.prisma.user.findMany({
      where: { role: { code: 'MANAGER' }, status: 'ACTIVE', OR: [{ branchId: p.branchId }, { branchId: null }] },
      select: { id: true, email: true },
    });
    for (const m of managers) {
      await this.notifications.notify({
        code: 'SHIFT_REPORT_SUBMITTED',
        userId: m.id,
        email: m.email,
        vars: {
          staff: user.fullName,
          revenue: Math.round(p.revenue).toLocaleString('vi-VN'),
          billCount: p.billCount,
          incidents: p.incidents.length,
        },
        data: { shiftReportId: report.id },
        channels: ['IN_APP', 'PUSH', 'EMAIL'],
      });
    }
    this.realtime.toBranchStaff(p.branchId, 'shift-report.submitted', { id: report.id, submittedBy: user.fullName });
    return report;
  }

  listShiftReports(user: AuthUser, q: ShiftReportsQueryDto) {
    const b = scopeBranch(user, q.branchId);
    const { from, to } = parseDateRange(q.from, q.to);
    return this.prisma.shiftReport.findMany({
      where: { createdAt: { gte: from, lt: to }, ...(b ? { branchId: b } : {}) },
      include: { submittedBy: { select: { id: true, fullName: true } }, shift: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getShiftReport(user: AuthUser, id: number) {
    const r = await this.prisma.shiftReport.findUnique({
      where: { id },
      include: { submittedBy: { select: { id: true, fullName: true } }, shift: true },
    });
    if (!r) throw new NotFoundException('Không tìm thấy báo cáo');
    assertBranchAccess(user, r.branchId);
    return r;
  }

  // =========================================================== Sự cố / khiếu nại (FR-WAT-17)

  async createIncident(user: AuthUser, dto: CreateIncidentDto) {
    const branchId = requireBranch(user, dto.branchId);
    const incident = await this.prisma.incident.create({
      data: {
        branchId,
        type: dto.type,
        severity: dto.severity ?? 'NORMAL',
        description: dto.description,
        sessionId: dto.sessionId,
        tableId: dto.tableId,
        feedbackId: dto.feedbackId,
        reportedById: user.id,
      },
    });
    await this.audit.log({ userId: user.id, action: 'incident.create', entity: 'Incident', entityId: incident.id, data: dto });
    this.realtime.toBranchStaff(branchId, 'incident.created', incident);
    return incident;
  }

  listIncidents(user: AuthUser, q: IncidentsQueryDto) {
    const b = scopeBranch(user, q.branchId);
    const range = q.from || q.to ? parseDateRange(q.from, q.to) : null;
    return this.prisma.incident.findMany({
      where: {
        ...(b ? { branchId: b } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(range ? { createdAt: { gte: range.from, lt: range.to } } : {}),
      },
      include: {
        table: { select: { code: true } },
        reportedBy: { select: { id: true, fullName: true } },
        resolvedBy: { select: { id: true, fullName: true } },
      },
      orderBy: [{ status: 'asc' }, { severity: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  async resolveIncident(user: AuthUser, id: number, resolution: string) {
    const incident = await this.prisma.incident.findUnique({ where: { id } });
    if (!incident) throw new NotFoundException('Không tìm thấy sự cố');
    assertBranchAccess(user, incident.branchId);
    const updated = await this.prisma.incident.update({
      where: { id },
      data: { status: 'RESOLVED', resolution, resolvedById: user.id, resolvedAt: new Date() },
    });
    await this.audit.log({ userId: user.id, action: 'incident.resolve', entity: 'Incident', entityId: id, data: { resolution } });
    this.realtime.toBranchStaff(incident.branchId, 'incident.updated', updated);
    return updated;
  }

  // =========================================================== helpers

  private async resolvePeriod(user: AuthUser, shiftId?: number, branchId?: number) {
    const now = new Date();
    if (shiftId) {
      const shift = await this.getShift(user, shiftId);
      return { branch: shift.branchId, shift, periodStart: shift.startAt, periodEnd: shift.endAt < now ? shift.endAt : now };
    }
    const branch = requireBranch(user, branchId);
    const shift = await this.prisma.shift.findFirst({
      where: { branchId: branch, startAt: { lte: now }, endAt: { gt: addMinutes(now, -120) } },
      orderBy: { startAt: 'desc' },
    });
    if (shift) return { branch, shift, periodStart: shift.startAt, periodEnd: now };
    return { branch, shift: null, periodStart: addMinutes(now, -8 * 60), periodEnd: now };
  }

  private async getShift(user: AuthUser, id: number) {
    const shift = await this.prisma.shift.findUnique({ where: { id } });
    if (!shift) throw new NotFoundException('Không tìm thấy ca làm');
    assertBranchAccess(user, shift.branchId);
    return shift;
  }

  private async assertStaff(userIds: number[], branchId: number) {
    const count = await this.prisma.user.count({
      where: {
        id: { in: userIds },
        status: 'ACTIVE',
        role: { code: { not: 'CUSTOMER' } },
        OR: [{ branchId }, { branchId: null }],
      },
    });
    if (count !== new Set(userIds).size) throw new BadRequestException('Có nhân viên không hợp lệ hoặc thuộc chi nhánh khác');
  }
}
