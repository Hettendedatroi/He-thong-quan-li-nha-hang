import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators';
import type { AuthUser } from '../common/types/auth-user';
import { PaginationQueryDto, paged, toSkipTake } from '../common/utils/pagination';
import { SettingsService } from '../core/settings.service';
import { PrismaService } from '../prisma/prisma.service';

/** FR-26: lịch sử đặt bàn / đơn gọi món / đánh giá; FR-27: điểm thưởng */
@ApiTags('Khách hàng - Tài khoản của tôi')
@ApiBearerAuth()
@Controller('me')
export class CustomersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  @Get('reservations')
  async reservations(@CurrentUser() user: AuthUser, @Query() q: PaginationQueryDto) {
    const where = { OR: [{ customerId: user.id }, ...(user.phone ? [{ customerPhone: user.phone }] : [])] };
    const [items, total] = await Promise.all([
      this.prisma.reservation.findMany({
        where,
        include: { branch: { select: { id: true, name: true } }, table: { select: { code: true } } },
        orderBy: { startAt: 'desc' },
        ...toSkipTake(q.page, q.limit),
      }),
      this.prisma.reservation.count({ where }),
    ]);
    return paged(items, total, q.page, q.limit);
  }

  @Get('orders')
  async orders(@CurrentUser() user: AuthUser, @Query() q: PaginationQueryDto) {
    const where = { customerId: user.id };
    const [items, total] = await Promise.all([
      this.prisma.tableSession.findMany({
        where,
        include: {
          branch: { select: { id: true, name: true } },
          table: { select: { code: true } },
          orders: { include: { items: true }, orderBy: { createdAt: 'asc' } },
          bills: {
            where: { parentBillId: null, status: { in: ['PAID', 'REFUNDED'] } },
            select: { id: true, code: true, total: true, paidAt: true, pointsEarned: true, feedback: { select: { rating: true } } },
          },
        },
        orderBy: { openedAt: 'desc' },
        ...toSkipTake(q.page, q.limit),
      }),
      this.prisma.tableSession.count({ where }),
    ]);
    return paged(
      items.map(({ token: _t, ...s }) => s),
      total,
      q.page,
      q.limit,
    );
  }

  @Get('reviews')
  async reviews(@CurrentUser() user: AuthUser) {
    const [dishReviews, feedback] = await Promise.all([
      this.prisma.dishReview.findMany({
        where: { customerId: user.id },
        include: { menuItem: { select: { id: true, name: true, imageUrl: true } }, responses: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.feedback.findMany({
        where: { customerId: user.id },
        include: { bill: { select: { code: true, total: true, paidAt: true } }, responses: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    return { dishReviews, feedback };
  }

  @Get('loyalty')
  async loyalty(@CurrentUser() user: AuthUser) {
    const [me, transactions, policy] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { loyaltyPoints: true } }),
      this.prisma.loyaltyTransaction.findMany({
        where: { userId: user.id },
        include: { bill: { select: { code: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.settings.get('loyalty'),
    ]);
    return {
      points: me.loyaltyPoints,
      pointValue: policy.pointValue,
      redeemableAmount: me.loyaltyPoints * policy.pointValue,
      policy,
      transactions,
    };
  }

  /** Tổng hợp nhanh cho trang "Lịch sử" */
  @Get('history')
  async history(@CurrentUser() user: AuthUser) {
    const [reservations, sessions, reviews] = await Promise.all([
      this.reservations(user, { page: 1, limit: 5 }),
      this.orders(user, { page: 1, limit: 5 }),
      this.reviews(user),
    ]);
    return {
      reservations: reservations.items,
      visits: sessions.items,
      dishReviews: reviews.dishReviews.slice(0, 5),
      feedback: reviews.feedback.slice(0, 5),
    };
  }
}
