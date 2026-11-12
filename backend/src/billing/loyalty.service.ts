import { Injectable } from '@nestjs/common';
import { Bill } from '@prisma/client';
import { SettingsService } from '../core/settings.service';
import { PrismaService } from '../prisma/prisma.service';

/** FR-27: tích điểm khi thanh toán, trừ điểm đã đổi */
@Injectable()
export class LoyaltyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async settle(bill: Bill) {
    if (!bill.customerId) return { earned: 0, redeemed: 0 };
    const loyalty = await this.settings.get('loyalty');
    if (!loyalty.enabled) return { earned: 0, redeemed: 0 };
    const customer = await this.prisma.user.findUnique({ where: { id: bill.customerId } });
    if (!customer) return { earned: 0, redeemed: 0 };

    const redeemed = Math.min(bill.pointsRedeemed, customer.loyaltyPoints);
    const earned = Math.floor(bill.total / loyalty.amountPerPoint);
    await this.prisma.$transaction([
      ...(redeemed > 0
        ? [
            this.prisma.loyaltyTransaction.create({
              data: { userId: customer.id, billId: bill.id, type: 'REDEEM', points: -redeemed, note: `Đổi điểm hóa đơn ${bill.code}` },
            }),
          ]
        : []),
      ...(earned > 0
        ? [
            this.prisma.loyaltyTransaction.create({
              data: { userId: customer.id, billId: bill.id, type: 'EARN', points: earned, note: `Tích điểm hóa đơn ${bill.code}` },
            }),
          ]
        : []),
      this.prisma.user.update({
        where: { id: customer.id },
        data: { loyaltyPoints: { increment: earned - redeemed } },
      }),
      this.prisma.bill.update({ where: { id: bill.id }, data: { pointsEarned: earned } }),
    ]);
    return { earned, redeemed };
  }
}
