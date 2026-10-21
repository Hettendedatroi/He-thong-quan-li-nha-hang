import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Priority, ServiceRequestType } from '@prisma/client';
import type { AuthUser } from '../common/types/auth-user';
import { assertBranchAccess, scopeBranch } from '../common/utils/branch-scope';
import { addMinutes } from '../common/utils/time';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TableSessionsService } from '../tables/table-sessions.service';
import { CreateServiceRequestDto, ListServiceRequestsQueryDto } from './service-requests.dto';

/** Mức ưu tiên mặc định theo loại yêu cầu (FR-WAT-04) */
const DEFAULT_PRIORITY: Record<ServiceRequestType, Priority> = {
  CANCEL_ITEM: 'URGENT',
  CHANGE_ITEM: 'URGENT',
  REQUEST_BILL: 'HIGH',
  CALL_STAFF: 'HIGH',
  MORE_ITEMS: 'NORMAL',
  OTHER: 'NORMAL',
};

const REQUEST_LABEL: Record<ServiceRequestType, string> = {
  CALL_STAFF: 'Gọi nhân viên',
  REQUEST_BILL: 'Yêu cầu thanh toán',
  MORE_ITEMS: 'Gọi thêm món',
  CHANGE_ITEM: 'Đổi món',
  CANCEL_ITEM: 'Hủy món',
  OTHER: 'Yêu cầu khác',
};

/** Yêu cầu mở quá N phút được đánh dấu quá hạn */
const OVERDUE_MINUTES = 5;

/** US-3 AC3: khoảng chờ trước khi được gửi lại cùng loại yêu cầu */
const REPEAT_COOLDOWN_MINUTES = 2;

const INCLUDE = {
  table: { select: { id: true, code: true } },
  orderItem: { select: { id: true, name: true, quantity: true, status: true } },
  handledBy: { select: { id: true, fullName: true } },
} as const;

@Injectable()
export class ServiceRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: TableSessionsService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
  ) {}

  /** FR-13: khách gửi yêu cầu nhanh */
  async create(token: string, dto: CreateServiceRequestDto) {
    const session = await this.sessions.getByToken(token);
    if (dto.type === 'CHANGE_ITEM' || dto.type === 'CANCEL_ITEM') {
      if (!dto.orderItemId) throw new BadRequestException('Vui lòng chọn món cần đổi / hủy');
      const item = await this.prisma.orderItem.findFirst({
        where: { id: dto.orderItemId, order: { sessionId: session.id } },
      });
      if (!item) throw new BadRequestException('Món không thuộc bàn của bạn');
    }
    // US-3 AC3: cùng loại yêu cầu không được gửi lại trong 2 phút
    const dup = await this.prisma.serviceRequest.findFirst({
      where: {
        sessionId: session.id,
        type: dto.type,
        orderItemId: dto.orderItemId ?? null,
        status: { not: 'CANCELLED' },
        createdAt: { gte: addMinutes(new Date(), -REPEAT_COOLDOWN_MINUTES) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (dup) {
      const waitSeconds = Math.ceil((dup.createdAt.getTime() + REPEAT_COOLDOWN_MINUTES * 60_000 - Date.now()) / 1000);
      throw new HttpException(
        `Yêu cầu này vừa được gửi, nhân viên đang đến. Vui lòng thử lại sau ${waitSeconds} giây.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const request = await this.prisma.serviceRequest.create({
      data: {
        branchId: session.branchId,
        sessionId: session.id,
        tableId: session.tableId,
        type: dto.type,
        priority: DEFAULT_PRIORITY[dto.type],
        message: dto.message,
        orderItemId: dto.orderItemId,
      },
      include: INCLUDE,
    });
    // FR-WAT-01: popup + âm thanh trên máy phục vụ
    this.realtime.toBranchStaff(session.branchId, 'service-request.created', request);
    // US-9 AC2: lưu thông báo cho phục vụ (danh sách + bộ đếm chưa đọc)
    await this.notifications.notifyBranchStaff(
      session.branchId,
      'STAFF_SERVICE_REQUEST',
      { table: request.table.code, type: REQUEST_LABEL[dto.type], message: dto.message ?? '' },
      { serviceRequestId: request.id, tableId: request.table.id, event: 'SERVICE_REQUEST', requestType: dto.type },
    );
    return request;
  }

  listForSession(token: string) {
    return this.sessions.getByToken(token, false).then((s) =>
      this.prisma.serviceRequest.findMany({
        where: { sessionId: s.id },
        include: INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
  }

  async cancelByCustomer(token: string, id: number) {
    const session = await this.sessions.getByToken(token);
    const r = await this.prisma.serviceRequest.findFirst({ where: { id, sessionId: session.id } });
    if (!r) throw new NotFoundException('Không tìm thấy yêu cầu');
    if (r.status !== 'OPEN') throw new BadRequestException('Yêu cầu đã được xử lý');
    const updated = await this.prisma.serviceRequest.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: INCLUDE,
    });
    this.realtime.toBranchStaff(r.branchId, 'service-request.updated', updated);
    return updated;
  }

  /** FR-WAT-04: danh sách yêu cầu mới nhất, gắn cờ ưu tiên / quá hạn */
  async list(user: AuthUser, q: ListServiceRequestsQueryDto) {
    const branchId = scopeBranch(user, q.branchId);
    const rows = await this.prisma.serviceRequest.findMany({
      where: {
        ...(branchId ? { branchId } : {}),
        ...(q.priority ? { priority: q.priority } : {}),
        status: q.status ?? { in: ['OPEN', 'ACKNOWLEDGED'] },
      },
      include: INCLUDE,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 200,
    });
    const now = Date.now();
    return rows.map((r) => {
      const waitingMinutes = Math.floor((now - r.createdAt.getTime()) / 60_000);
      return { ...r, waitingMinutes, isOverdue: r.status === 'OPEN' && waitingMinutes >= OVERDUE_MINUTES };
    });
  }

  /** Nhân viên nhận xử lý (tính thời gian phản hồi cho FR-MGR-04) */
  async acknowledge(user: AuthUser, id: number) {
    const r = await this.get(user, id);
    if (r.status !== 'OPEN') throw new BadRequestException('Yêu cầu đã được nhận / xử lý');
    return this.update(r.branchId, id, { status: 'ACKNOWLEDGED', handledById: user.id, acknowledgedAt: new Date() });
  }

  async resolve(user: AuthUser, id: number, response?: string) {
    const r = await this.get(user, id);
    if (r.status === 'RESOLVED' || r.status === 'CANCELLED') throw new BadRequestException('Yêu cầu đã đóng');
    return this.update(r.branchId, id, {
      status: 'RESOLVED',
      response,
      handledById: r.handledById ?? user.id,
      acknowledgedAt: r.acknowledgedAt ?? new Date(),
      resolvedAt: new Date(),
    });
  }

  private async get(user: AuthUser, id: number) {
    const r = await this.prisma.serviceRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Không tìm thấy yêu cầu');
    assertBranchAccess(user, r.branchId);
    return r;
  }

  private async update(branchId: number, id: number, data: Prisma.ServiceRequestUncheckedUpdateInput) {
    const updated = await this.prisma.serviceRequest.update({
      where: { id },
      data,
      include: { ...INCLUDE, session: { select: { token: true } } },
    });
    const { session, ...payload } = updated;
    this.realtime.toBranchStaff(branchId, 'service-request.updated', payload);
    this.realtime.toSession(session.token, 'service-request.updated', payload);
    return payload;
  }
}
