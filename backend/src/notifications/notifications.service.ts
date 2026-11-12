import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationChannel, Prisma } from '@prisma/client';
import { MailService } from '../core/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { DEFAULT_TEMPLATES, renderTemplate } from './default-templates';

export interface NotifyInput {
  /** Mã mẫu, vd RESERVATION_CONFIRMED */
  code: string;
  vars?: Record<string, string | number | null | undefined>;
  userId?: number | null;
  email?: string | null;
  phone?: string | null;
  reservationId?: number;
  reservationCode?: string;
  sessionToken?: string;
  language?: string;
  data?: Record<string, unknown>;
  channels?: NotificationChannel[];
}

/**
 * Gửi thông báo đa kênh: in-app (lưu DB + socket), push, email, SMS (FR-21..FR-24).
 * Push/SMS hiện là stub ghi log - tích hợp FCM / nhà cung cấp SMS tại đây khi có tài khoản.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly mail: MailService,
  ) {}

  async notify(input: NotifyInput): Promise<void> {
    try {
      const channels = input.channels ?? ['IN_APP', 'PUSH', 'EMAIL', 'SMS'];
      const lang = input.language ?? 'vi';
      const vars = input.vars ?? {};
      const inApp = await this.render(input.code, 'IN_APP', lang, vars);
      const payload = { type: input.code, title: inApp.title, body: inApp.body, data: input.data ?? null };

      if (input.userId && channels.includes('IN_APP')) {
        const n = await this.prisma.notification.create({
          data: {
            userId: input.userId,
            reservationId: input.reservationId,
            type: input.code,
            title: inApp.title,
            body: inApp.body,
            data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
          },
        });
        this.realtime.toUser(input.userId, 'notification', n);
      }
      if (input.reservationCode) this.realtime.toReservation(input.reservationCode, 'notification', payload);
      if (input.sessionToken) this.realtime.toSession(input.sessionToken, 'notification', payload);

      if (input.userId && channels.includes('PUSH')) {
        const push = await this.render(input.code, 'PUSH', lang, vars);
        await this.sendPush(input.userId, push.title, push.body, input.data);
      }
      if (input.email && channels.includes('EMAIL')) {
        const mail = await this.render(input.code, 'EMAIL', lang, vars);
        await this.mail.send({ to: input.email, subject: mail.title, text: mail.body });
      }
      if (input.phone && channels.includes('SMS')) {
        const sms = await this.render(input.code, 'SMS', lang, vars);
        this.logger.log(`[SMS stub] ${input.phone}: ${sms.body}`);
      }
    } catch (err) {
      this.logger.error(`Gửi thông báo ${input.code} thất bại: ${(err as Error).message}`);
    }
  }

  /** FR-24: gửi khuyến mãi tới khách hàng đã bật nhận khuyến mãi */
  async sendPromotion(title: string, body: string, data?: Record<string, unknown>) {
    const customers = await this.prisma.user.findMany({
      where: { role: { code: 'CUSTOMER' }, promoOptIn: true, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!customers.length) return { sent: 0 };
    await this.prisma.notification.createMany({
      data: customers.map((c) => ({
        userId: c.id,
        type: 'PROMOTION',
        title,
        body,
        data: (data ?? undefined) as Prisma.InputJsonValue | undefined,
      })),
    });
    for (const c of customers) {
      this.realtime.toUser(c.id, 'notification', { type: 'PROMOTION', title, body, data });
      await this.sendPush(c.id, title, body, data);
    }
    return { sent: customers.length };
  }

  /**
   * US-9 AC2: thông báo cho nhân viên phục vụ của chi nhánh (đơn mới, yêu cầu phục vụ, món sẵn sàng).
   * Lưu vào DB để màn hình phục vụ hiện danh sách mới nhất trước + bộ đếm chưa đọc, và đẩy realtime.
   */
  async notifyBranchStaff(
    branchId: number,
    code: string,
    vars: NotifyInput['vars'],
    data: Record<string, unknown>,
    permission = 'service_request.handle',
  ) {
    try {
      const staff = await this.prisma.user.findMany({
        where: {
          branchId,
          status: 'ACTIVE',
          role: { OR: [{ permissions: { has: permission } }, { permissions: { has: '*' } }] },
        },
        select: { id: true },
      });
      if (!staff.length) return;
      const { title, body } = await this.render(code, 'IN_APP', 'vi', vars);
      await this.prisma.notification.createMany({
        data: staff.map((s) => ({ userId: s.id, type: code, title, body, data: data as Prisma.InputJsonValue })),
      });
      for (const s of staff) this.realtime.toUser(s.id, 'notification', { type: code, title, body, data });
    } catch (err) {
      this.logger.error(`Gửi thông báo nhân viên ${code} thất bại: ${(err as Error).message}`);
    }
  }

  listForUser(userId: number, unreadOnly = false, take = 50) {
    return this.prisma.notification.findMany({
      where: { userId, ...(unreadOnly ? { isRead: false } : {}) },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /** US-9 AC2: bộ đếm thông báo chưa đọc */
  async unreadCount(userId: number) {
    return { count: await this.prisma.notification.count({ where: { userId, isRead: false } }) };
  }

  async markRead(userId: number, id: number) {
    const n = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!n) throw new NotFoundException('Không tìm thấy thông báo');
    return this.prisma.notification.update({ where: { id }, data: { isRead: true } });
  }

  async markAllRead(userId: number) {
    const r = await this.prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
    return { updated: r.count };
  }

  registerDeviceToken(userId: number, token: string, platform: string) {
    return this.prisma.deviceToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
  }

  async removeDeviceToken(userId: number, token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { userId, token } });
    return { ok: true };
  }

  private async render(code: string, channel: NotificationChannel, language: string, vars: NotifyInput['vars'] = {}) {
    const tpl =
      (await this.prisma.notificationTemplate.findFirst({ where: { code, channel, language, isActive: true } })) ??
      (await this.prisma.notificationTemplate.findFirst({
        where: { code, channel: 'IN_APP', language, isActive: true },
      })) ??
      DEFAULT_TEMPLATES[code] ?? { title: code, body: '' };
    return { title: renderTemplate(tpl.title, vars), body: renderTemplate(tpl.body, vars) };
  }

  private async sendPush(userId: number, title: string, body: string, data?: Record<string, unknown>) {
    const tokens = await this.prisma.deviceToken.findMany({ where: { userId } });
    if (!tokens.length) return;
    // TODO(tích hợp): gọi Firebase Cloud Messaging với danh sách token
    this.logger.debug(`[PUSH stub] user=${userId} tokens=${tokens.length}: ${title} ${data ? JSON.stringify(data) : ''}`);
    void body;
  }
}
