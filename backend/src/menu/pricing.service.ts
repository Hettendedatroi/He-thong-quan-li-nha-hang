import { Injectable } from '@nestjs/common';
import { DayType, MenuItem, PriceRule } from '@prisma/client';
import { isTimeInRange, localParts } from '../common/utils/time';
import { PrismaService } from '../prisma/prisma.service';

/** FR-MGR-10: giá theo ngày thường / cuối tuần / ngày lễ */
@Injectable()
export class PricingService {
  private holidayCache = new Map<string, boolean>();

  constructor(private readonly prisma: PrismaService) {}

  async isHoliday(at = new Date()): Promise<boolean> {
    const { ymd } = localParts(at);
    const cached = this.holidayCache.get(ymd);
    if (cached !== undefined) return cached;
    const found = await this.prisma.holiday.findUnique({ where: { date: new Date(`${ymd}T00:00:00.000Z`) } });
    if (this.holidayCache.size > 100) this.holidayCache.clear();
    this.holidayCache.set(ymd, !!found);
    return !!found;
  }

  clearCache() {
    this.holidayCache.clear();
  }

  dayType(at: Date, holiday: boolean): DayType {
    if (holiday) return 'HOLIDAY';
    const { dayOfWeek } = localParts(at);
    return dayOfWeek === 0 || dayOfWeek === 6 ? 'WEEKEND' : 'WEEKDAY';
  }

  /** Giá áp dụng tại thời điểm `at`; ưu tiên rule có khung giờ cụ thể. Không có rule => giá gốc */
  effectivePrice(item: Pick<MenuItem, 'price'> & { priceRules?: PriceRule[] }, at: Date, holiday: boolean): number {
    if (!item.priceRules?.length) return item.price;
    const type = this.dayType(at, holiday);
    const { hhmm } = localParts(at);
    const matches = item.priceRules
      .filter((r) => r.isActive && r.dayType === type && isTimeInRange(hhmm, r.startTime, r.endTime))
      .sort((a, b) => Number(!!b.startTime) - Number(!!a.startTime));
    return matches[0]?.price ?? item.price;
  }
}
