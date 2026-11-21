import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { addMinutes } from '../common/utils/time';
import { SettingsService } from '../core/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationsService } from './reservations.service';

/** Tác vụ định kỳ cho đặt bàn */
@Injectable()
export class ReservationsScheduler {
  private readonly logger = new Logger(ReservationsScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly reservations: ReservationsService,
  ) {}

  /** FR-22: nhắc lịch trước giờ hẹn (mặc định 60 phút) */
  @Cron(CronExpression.EVERY_MINUTE)
  async sendReminders() {
    const policy = await this.settings.get('reservationPolicy');
    const now = new Date();
    const due = await this.prisma.reservation.findMany({
      where: {
        status: 'CONFIRMED',
        reminderSentAt: null,
        startAt: { gt: now, lte: addMinutes(now, policy.reminderMinutesBefore) },
      },
      include: { branch: true, table: { include: { zone: true } } },
      take: 100,
    });
    for (const r of due) {
      await this.prisma.reservation.update({ where: { id: r.id }, data: { reminderSentAt: now } });
      await this.reservations.notifyCustomer(r, 'RESERVATION_REMINDER');
    }
    if (due.length) this.logger.log(`Đã gửi ${due.length} nhắc lịch đặt bàn`);
  }

  /** Quá thời gian giữ bàn => NO_SHOW; đơn chờ quá giờ hẹn => tự hủy */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireReservations() {
    const policy = await this.settings.get('reservationPolicy');
    const now = new Date();
    const noShows = await this.prisma.reservation.findMany({
      where: { status: 'CONFIRMED', startAt: { lt: addMinutes(now, -policy.maxHoldMinutes) } },
      select: { id: true },
      take: 100,
    });
    for (const r of noShows) {
      await this.reservations.markNoShow(null, r.id).catch((e) => this.logger.warn(e.message));
    }
    const expired = await this.prisma.reservation.findMany({
      where: { status: 'PENDING', startAt: { lt: now } },
      include: { branch: true, table: { include: { zone: true } } },
      take: 100,
    });
    for (const r of expired) {
      const updated = await this.prisma.reservation.update({
        where: { id: r.id },
        data: { status: 'CANCELLED', cancelledAt: now, cancelReason: 'Hết hạn chờ xác nhận / đặt cọc' },
        include: { branch: true, table: { include: { zone: true } } },
      });
      await this.reservations.notifyCustomer(updated, 'RESERVATION_CANCELLED');
      this.reservations.emitUpdated(updated);
    }
    if (noShows.length || expired.length) {
      this.logger.log(`No-show: ${noShows.length}, hết hạn: ${expired.length}`);
    }
  }
}
