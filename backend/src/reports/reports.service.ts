import { Injectable } from '@nestjs/common';
import { OrderItemStatus, Prisma } from '@prisma/client';
import { addDays, addMinutes, APP_TIMEZONE, startOfLocalDay } from '../common/utils/time';
import { PrismaService } from '../prisma/prisma.service';

/** Tham số thời gian cho SQL thuần: chuyển Date (UTC) -> timestamp không múi giờ (như Prisma lưu) */
const ts = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
/** Cột timestamp (UTC) -> giờ địa phương để nhóm theo ngày / tuần / tháng */
const local = (col: Prisma.Sql) => Prisma.sql`(${col} AT TIME ZONE 'UTC' AT TIME ZONE ${APP_TIMEZONE})`;
const andBranch = (col: Prisma.Sql, branchId?: number) =>
  branchId ? Prisma.sql`AND ${col} = ${branchId}` : Prisma.empty;

const PERIOD_FORMAT = { day: 'YYYY-MM-DD', week: 'IYYY-"W"IW', month: 'YYYY-MM', year: 'YYYY' } as const;
type PeriodUnit = keyof typeof PERIOD_FORMAT;

const round = (n: number | null | undefined, digits = 1) =>
  n == null ? null : Math.round(n * 10 ** digits) / 10 ** digits;

/** Báo cáo thống kê (FR-MGR-01..05, FR-WAT-03, FR-WAT-15). Doanh thu tính theo dòng tiền thực thu (Payment). */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------ FR-MGR-01: doanh thu
  async revenue(from: Date, to: Date, branchId: number | undefined, groupBy: PeriodUnit | 'shift' = 'day', compare = true) {
    const series =
      groupBy === 'shift' ? await this.revenueByShift(from, to, branchId) : await this.revenueByPeriod(from, to, branchId, groupBy);
    const summary = await this.revenueSummary(from, to, branchId);
    let previous: (Awaited<ReturnType<ReportsService['revenueSummary']>> & { from: Date; to: Date }) | null = null;
    let growthPercent: number | null = null;
    if (compare) {
      const prevFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));
      previous = { ...(await this.revenueSummary(prevFrom, from, branchId)), from: prevFrom, to: from };
      growthPercent = previous.revenue ? round(((summary.revenue - previous.revenue) / previous.revenue) * 100) : null;
    }
    return { from, to, groupBy, branchId: branchId ?? null, summary, previous, growthPercent, series };
  }

  revenueByPeriod(from: Date, to: Date, branchId: number | undefined, unit: PeriodUnit) {
    return this.prisma.$queryRaw<{ period: string; revenue: number; bills: number }[]>`
      SELECT to_char(date_trunc(${unit}, ${local(Prisma.sql`p."createdAt"`)}), ${PERIOD_FORMAT[unit]}) AS period,
             COALESCE(SUM(p.amount), 0)::float8 AS revenue,
             COUNT(DISTINCT COALESCE(b."parentBillId", b.id))::int AS bills
      FROM "Payment" p
      JOIN "Bill" b ON b.id = p."billId"
      WHERE p.status IN ('SUCCESS', 'REFUNDED') AND b.status IN ('PAID', 'REFUNDED')
        AND p."createdAt" >= ${ts(from)} AND p."createdAt" < ${ts(to)}
        ${andBranch(Prisma.sql`b."branchId"`, branchId)}
      GROUP BY 1
      ORDER BY 1`;
  }

  revenueByShift(from: Date, to: Date, branchId?: number) {
    return this.prisma.$queryRaw<
      { shiftId: number; name: string; startAt: Date; endAt: Date; branchId: number; revenue: number; bills: number }[]
    >`
      SELECT s.id AS "shiftId", s.name, s."startAt", s."endAt", s."branchId",
             COALESCE(x.revenue, 0)::float8 AS revenue,
             COALESCE(x.bills, 0)::int AS bills
      FROM "Shift" s
      LEFT JOIN LATERAL (
        SELECT SUM(p.amount) AS revenue, COUNT(DISTINCT COALESCE(b."parentBillId", b.id)) AS bills
        FROM "Payment" p
        JOIN "Bill" b ON b.id = p."billId"
        WHERE b."branchId" = s."branchId"
          AND p.status IN ('SUCCESS', 'REFUNDED') AND b.status IN ('PAID', 'REFUNDED')
          AND p."createdAt" >= s."startAt" AND p."createdAt" < s."endAt"
      ) x ON TRUE
      WHERE s."startAt" >= ${ts(from)} AND s."startAt" < ${ts(to)}
        ${andBranch(Prisma.sql`s."branchId"`, branchId)}
      ORDER BY s."startAt"`;
  }

  async revenueSummary(from: Date, to: Date, branchId?: number) {
    const [row] = await this.prisma.$queryRaw<{ revenue: number; refunds: number; bills: number }[]>`
      SELECT COALESCE(SUM(p.amount), 0)::float8 AS revenue,
             COALESCE(SUM(p.amount) FILTER (WHERE p.amount < 0), 0)::float8 AS refunds,
             COUNT(DISTINCT COALESCE(b."parentBillId", b.id))::int AS bills
      FROM "Payment" p
      JOIN "Bill" b ON b.id = p."billId"
      WHERE p.status IN ('SUCCESS', 'REFUNDED') AND b.status IN ('PAID', 'REFUNDED')
        AND p."createdAt" >= ${ts(from)} AND p."createdAt" < ${ts(to)}
        ${andBranch(Prisma.sql`b."branchId"`, branchId)}`;
    const byMethod = await this.prisma.$queryRaw<{ method: string; amount: number }[]>`
      SELECT p.method::text AS method, COALESCE(SUM(p.amount), 0)::float8 AS amount
      FROM "Payment" p
      JOIN "Bill" b ON b.id = p."billId"
      WHERE p.status IN ('SUCCESS', 'REFUNDED') AND b.status IN ('PAID', 'REFUNDED')
        AND p."createdAt" >= ${ts(from)} AND p."createdAt" < ${ts(to)}
        ${andBranch(Prisma.sql`b."branchId"`, branchId)}
      GROUP BY p.method`;
    return {
      revenue: row.revenue,
      refunds: row.refunds,
      bills: row.bills,
      avgBill: row.bills ? Math.round(row.revenue / row.bills) : 0,
      byMethod,
    };
  }

  // ------------------------------------------------------------ FR-MGR-02: khách, vòng quay bàn, thời gian phục vụ
  async operations(from: Date, to: Date, branchId?: number, groupBy: 'day' | 'shift' = 'day') {
    const tableCount = await this.prisma.diningTable.count({
      where: { isActive: true, ...(branchId ? { branchId } : {}) },
    });
    if (groupBy === 'shift') {
      const rows = await this.prisma.$queryRaw<
        { shiftId: number; name: string; startAt: Date; endAt: Date; sessions: number; guests: number; avgDiningMinutes: number | null; avgServiceMinutes: number | null }[]
      >`
        SELECT s.id AS "shiftId", s.name, s."startAt", s."endAt",
               COUNT(ts.id)::int AS sessions,
               COALESCE(SUM(ts."guestCount"), 0)::int AS guests,
               AVG(EXTRACT(EPOCH FROM (ts."closedAt" - ts."openedAt")) / 60)::float8 AS "avgDiningMinutes",
               (SELECT AVG(EXTRACT(EPOCH FROM (oi."servedAt" - oi."createdAt")) / 60)
                  FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
                 WHERE o."branchId" = s."branchId" AND oi."servedAt" IS NOT NULL
                   AND oi."createdAt" >= s."startAt" AND oi."createdAt" < s."endAt")::float8 AS "avgServiceMinutes"
        FROM "Shift" s
        LEFT JOIN "TableSession" ts ON ts."branchId" = s."branchId"
          AND ts."openedAt" >= s."startAt" AND ts."openedAt" < s."endAt"
        WHERE s."startAt" >= ${ts(from)} AND s."startAt" < ${ts(to)}
          ${andBranch(Prisma.sql`s."branchId"`, branchId)}
        GROUP BY s.id
        ORDER BY s."startAt"`;
      return {
        from,
        to,
        groupBy,
        tableCount,
        series: rows.map((r) => ({
          ...r,
          avgDiningMinutes: round(r.avgDiningMinutes),
          avgServiceMinutes: round(r.avgServiceMinutes),
          tableTurnover: tableCount ? round(r.sessions / tableCount, 2) : null,
        })),
      };
    }

    const [sessions, service] = await Promise.all([
      this.prisma.$queryRaw<{ period: string; sessions: number; guests: number; avgDiningMinutes: number | null }[]>`
        SELECT to_char(date_trunc('day', ${local(Prisma.sql`ts."openedAt"`)}), 'YYYY-MM-DD') AS period,
               COUNT(*)::int AS sessions,
               COALESCE(SUM(ts."guestCount"), 0)::int AS guests,
               AVG(EXTRACT(EPOCH FROM (ts."closedAt" - ts."openedAt")) / 60)::float8 AS "avgDiningMinutes"
        FROM "TableSession" ts
        WHERE ts."openedAt" >= ${ts(from)} AND ts."openedAt" < ${ts(to)}
          ${andBranch(Prisma.sql`ts."branchId"`, branchId)}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ period: string; avgServiceMinutes: number | null; avgKitchenMinutes: number | null }[]>`
        SELECT to_char(date_trunc('day', ${local(Prisma.sql`oi."createdAt"`)}), 'YYYY-MM-DD') AS period,
               AVG(EXTRACT(EPOCH FROM (oi."servedAt" - oi."createdAt")) / 60)::float8 AS "avgServiceMinutes",
               AVG(EXTRACT(EPOCH FROM (oi."readyAt" - oi."createdAt")) / 60)::float8 AS "avgKitchenMinutes"
        FROM "OrderItem" oi
        JOIN "Order" o ON o.id = oi."orderId"
        WHERE oi."servedAt" IS NOT NULL
          AND oi."createdAt" >= ${ts(from)} AND oi."createdAt" < ${ts(to)}
          ${andBranch(Prisma.sql`o."branchId"`, branchId)}
        GROUP BY 1 ORDER BY 1`,
    ]);
    const serviceMap = new Map(service.map((s) => [s.period, s]));
    const series = sessions.map((s) => ({
      ...s,
      avgDiningMinutes: round(s.avgDiningMinutes),
      avgServiceMinutes: round(serviceMap.get(s.period)?.avgServiceMinutes),
      avgKitchenMinutes: round(serviceMap.get(s.period)?.avgKitchenMinutes),
      tableTurnover: tableCount ? round(s.sessions / tableCount, 2) : null,
    }));
    const totals = series.reduce((a, s) => ({ sessions: a.sessions + s.sessions, guests: a.guests + s.guests }), {
      sessions: 0,
      guests: 0,
    });
    return { from, to, groupBy, tableCount, totals, series };
  }

  // ------------------------------------------------------------ FR-MGR-03: thống kê món
  async dishes(from: Date, to: Date, branchId?: number, limit = 10) {
    const [ordered, reviews, cancelled] = await Promise.all([
      // US-19 AC3: top món theo số lượng bán trong các hóa đơn đã thanh toán (lọc theo ngày thanh toán)
      this.prisma.$queryRaw<{ menuItemId: number; name: string; quantity: number; revenue: number }[]>`
        SELECT oi."menuItemId", mi.name,
               SUM(oi.quantity)::int AS quantity,
               SUM(oi."unitPrice" * oi.quantity - oi."discountAmount")::float8 AS revenue
        FROM "OrderItem" oi
        JOIN "Order" o ON o.id = oi."orderId"
        JOIN "MenuItem" mi ON mi.id = oi."menuItemId"
        WHERE oi.status <> 'CANCELLED'
          AND EXISTS (
            SELECT 1 FROM "Bill" b
            WHERE b."sessionId" = o."sessionId" AND b."parentBillId" IS NULL
              AND b.status IN ('PAID', 'REFUNDED')
              AND b."paidAt" >= ${ts(from)} AND b."paidAt" < ${ts(to)}
          )
          ${andBranch(Prisma.sql`o."branchId"`, branchId)}
        GROUP BY oi."menuItemId", mi.name
        ORDER BY quantity DESC`,
      this.prisma.$queryRaw<
        { menuItemId: number; name: string; reviews: number; likes: number; dislikes: number; positive: number; negative: number; avgRating: number | null }[]
      >`
        SELECT dr."menuItemId", mi.name,
               COUNT(*)::int AS reviews,
               COUNT(*) FILTER (WHERE dr.reaction = 'LIKE')::int AS likes,
               COUNT(*) FILTER (WHERE dr.reaction = 'DISLIKE')::int AS dislikes,
               COUNT(*) FILTER (WHERE dr.rating >= 4 OR dr.reaction = 'LIKE')::int AS positive,
               COUNT(*) FILTER (WHERE dr.rating <= 2 OR dr.reaction = 'DISLIKE')::int AS negative,
               AVG(dr.rating)::float8 AS "avgRating"
        FROM "DishReview" dr
        JOIN "MenuItem" mi ON mi.id = dr."menuItemId"
        LEFT JOIN "TableSession" ts ON ts.id = dr."sessionId"
        WHERE dr."createdAt" >= ${ts(from)} AND dr."createdAt" < ${ts(to)}
          ${andBranch(Prisma.sql`ts."branchId"`, branchId)}
        GROUP BY dr."menuItemId", mi.name`,
      this.prisma.$queryRaw<{ menuItemId: number | null; name: string; cancelledQuantity: number; times: number; reasons: string[] }[]>`
        SELECT oi."menuItemId", oi.name,
               SUM(oi.quantity)::int AS "cancelledQuantity",
               COUNT(*)::int AS times,
               (ARRAY_AGG(DISTINCT oi."cancelReason") FILTER (WHERE oi."cancelReason" IS NOT NULL))[1:5] AS reasons
        FROM "OrderItem" oi
        JOIN "Order" o ON o.id = oi."orderId"
        WHERE oi.status = 'CANCELLED'
          AND o."createdAt" >= ${ts(from)} AND o."createdAt" < ${ts(to)}
          ${andBranch(Prisma.sql`o."branchId"`, branchId)}
        GROUP BY oi."menuItemId", oi.name
        ORDER BY "cancelledQuantity" DESC
        LIMIT ${limit}`,
    ]);
    const orderMap = new Map(ordered.map((o) => [o.menuItemId, o]));
    const reviewList = reviews.map((r) => ({
      ...r,
      avgRating: round(r.avgRating),
      orderCount: orderMap.get(r.menuItemId)?.quantity ?? 0,
    }));
    return {
      from,
      to,
      topOrdered: ordered.slice(0, limit),
      mostLiked: [...reviewList].sort((a, b) => b.likes - a.likes || b.orderCount - a.orderCount).slice(0, limit),
      mostReviewed: [...reviewList].sort((a, b) => b.reviews - a.reviews).slice(0, limit),
      mostPositive: [...reviewList].sort((a, b) => b.positive - a.positive).slice(0, limit),
      mostNegative: [...reviewList].filter((r) => r.negative > 0).sort((a, b) => b.negative - a.negative).slice(0, limit),
      mostCancelled: cancelled,
    };
  }

  // ------------------------------------------------------------ FR-MGR-04: hiệu suất nhân viên
  async staffPerformance(from: Date, to: Date, branchId?: number) {
    const F = ts(from);
    const T = ts(to);
    const rows = await this.prisma.$queryRaw<
      {
        id: number;
        fullName: string;
        role: string;
        ordersCreated: number;
        billsClosed: number;
        requestsHandled: number;
        avgResponseSeconds: number | null;
        itemsPrepared: number;
        avgPrepMinutes: number | null;
        avgFeedbackRating: number | null;
      }[]
    >`
      SELECT u.id, u."fullName", r.code AS role,
        (SELECT COUNT(*) FROM "Order" o WHERE o."createdById" = u.id AND o."createdAt" >= ${F} AND o."createdAt" < ${T})::int AS "ordersCreated",
        (SELECT COUNT(*) FROM "Bill" b WHERE b."createdById" = u.id AND b."parentBillId" IS NULL
            AND b.status IN ('PAID', 'REFUNDED') AND b."paidAt" >= ${F} AND b."paidAt" < ${T})::int AS "billsClosed",
        (SELECT COUNT(*) FROM "ServiceRequest" sr WHERE sr."handledById" = u.id
            AND sr."createdAt" >= ${F} AND sr."createdAt" < ${T})::int AS "requestsHandled",
        (SELECT AVG(EXTRACT(EPOCH FROM (sr."acknowledgedAt" - sr."createdAt"))) FROM "ServiceRequest" sr
            WHERE sr."handledById" = u.id AND sr."acknowledgedAt" IS NOT NULL
              AND sr."createdAt" >= ${F} AND sr."createdAt" < ${T})::float8 AS "avgResponseSeconds",
        (SELECT COUNT(*) FROM "OrderItem" oi WHERE oi."preparedById" = u.id
            AND oi."readyAt" >= ${F} AND oi."readyAt" < ${T})::int AS "itemsPrepared",
        (SELECT AVG(EXTRACT(EPOCH FROM (oi."readyAt" - oi."startedAt")) / 60) FROM "OrderItem" oi
            WHERE oi."preparedById" = u.id AND oi."startedAt" IS NOT NULL
              AND oi."readyAt" >= ${F} AND oi."readyAt" < ${T})::float8 AS "avgPrepMinutes",
        (SELECT AVG(f.rating) FROM "Feedback" f WHERE f."staffId" = u.id
            AND f."createdAt" >= ${F} AND f."createdAt" < ${T})::float8 AS "avgFeedbackRating"
      FROM "User" u
      JOIN "Role" r ON r.id = u."roleId"
      WHERE r.code NOT IN ('CUSTOMER', 'ADMIN') AND u.status = 'ACTIVE'
        ${andBranch(Prisma.sql`u."branchId"`, branchId)}
      ORDER BY "ordersCreated" DESC, "itemsPrepared" DESC`;
    return {
      from,
      to,
      staff: rows.map((r) => ({
        ...r,
        avgResponseSeconds: round(r.avgResponseSeconds, 0),
        avgPrepMinutes: round(r.avgPrepMinutes),
        avgFeedbackRating: round(r.avgFeedbackRating),
      })),
    };
  }

  // ------------------------------------------------------------ FR-MGR-05: đặt bàn
  async reservations(from: Date, to: Date, branchId?: number) {
    const where: Prisma.ReservationWhereInput = { startAt: { gte: from, lt: to }, ...(branchId ? { branchId } : {}) };
    const [byStatus, series] = await Promise.all([
      this.prisma.reservation.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.$queryRaw<{ period: string; total: number; success: number; cancelled: number; noShow: number }[]>`
        SELECT to_char(date_trunc('day', ${local(Prisma.sql`r."startAt"`)}), 'YYYY-MM-DD') AS period,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE r.status IN ('CHECKED_IN', 'COMPLETED'))::int AS success,
               COUNT(*) FILTER (WHERE r.status IN ('CANCELLED', 'REJECTED'))::int AS cancelled,
               COUNT(*) FILTER (WHERE r.status = 'NO_SHOW')::int AS "noShow"
        FROM "Reservation" r
        WHERE r."startAt" >= ${ts(from)} AND r."startAt" < ${ts(to)}
          ${andBranch(Prisma.sql`r."branchId"`, branchId)}
        GROUP BY 1 ORDER BY 1`,
    ]);
    const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
    const total = byStatus.reduce((s, b) => s + b._count._all, 0);
    const success = count('CHECKED_IN') + count('COMPLETED');
    const cancelled = count('CANCELLED') + count('REJECTED');
    const noShow = count('NO_SHOW');
    // Chỉ tính tỉ lệ trên các đơn đã có kết quả (bỏ đơn đang chờ / sắp tới)
    const finished = success + cancelled + noShow;
    const pct = (n: number) => (finished ? round((n / finished) * 100) : null);
    return {
      from,
      to,
      total,
      byStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])),
      successRate: pct(success),
      cancellationRate: pct(cancelled),
      noShowRate: pct(noShow),
      series,
    };
  }

  // ------------------------------------------------------------ FR-WAT-03: món gọi nhiều theo ca / ngày
  async popularDishes(branchId: number, period: 'shift' | 'day' = 'day', limit = 10) {
    const now = new Date();
    let from = startOfLocalDay(now);
    let to = addDays(from, 1);
    let shiftName: string | null = null;
    if (period === 'shift') {
      const shift = await this.prisma.shift.findFirst({
        where: { branchId, startAt: { lte: now }, endAt: { gt: now } },
        orderBy: { startAt: 'desc' },
      });
      if (shift) {
        from = shift.startAt;
        to = shift.endAt;
        shiftName = shift.name;
      } else {
        from = addMinutes(now, -8 * 60);
        to = now;
      }
    }
    const rows = await this.prisma.orderItem.groupBy({
      by: ['menuItemId', 'name'],
      where: { status: { not: 'CANCELLED' }, menuItemId: { not: null }, createdAt: { gte: from, lt: to }, order: { branchId } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: limit,
    });
    return {
      period,
      shiftName,
      from,
      to,
      items: rows.map((r) => ({ menuItemId: r.menuItemId, name: r.name, quantity: r._sum.quantity ?? 0 })),
    };
  }

  // ------------------------------------------------------------ FR-WAT-15: giám sát ca
  async shiftMonitor(branchId: number) {
    const now = new Date();
    const dayStart = startOfLocalDay(now);
    const active: OrderItemStatus[] = ['PENDING', 'RECEIVED', 'PREPARING', 'READY'];
    const [tableCount, openSessions, pendingOrders, itemsByStatus, openRequests, pendingItems, servedToday, revenueToday, upcomingReservations, currentShift] =
      await Promise.all([
        this.prisma.diningTable.count({ where: { branchId, isActive: true } }),
        this.prisma.tableSession.findMany({ where: { branchId, status: 'OPEN' }, select: { guestCount: true } }),
        this.prisma.order.count({ where: { branchId, status: { in: ['PENDING_CONFIRM', 'SENT_TO_KITCHEN'] } } }),
        this.prisma.orderItem.groupBy({
          by: ['status'],
          where: { status: { in: active }, order: { branchId } },
          _sum: { quantity: true },
        }),
        this.prisma.serviceRequest.count({ where: { branchId, status: 'OPEN' } }),
        this.prisma.orderItem.findMany({
          where: { status: { in: ['PENDING', 'RECEIVED', 'PREPARING'] }, order: { branchId } },
          select: { createdAt: true },
        }),
        this.prisma.orderItem.findMany({
          where: { servedAt: { gte: dayStart }, order: { branchId } },
          select: { createdAt: true, servedAt: true },
        }),
        this.revenueSummary(dayStart, addDays(dayStart, 1), branchId),
        this.prisma.reservation.count({
          where: { branchId, status: 'CONFIRMED', startAt: { gte: now, lt: addDays(dayStart, 1) } },
        }),
        this.prisma.shift.findFirst({ where: { branchId, startAt: { lte: now }, endAt: { gt: now } } }),
      ]);
    const avg = (xs: number[]) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
    return {
      branchId,
      at: now,
      currentShift,
      tables: { total: tableCount, inService: openSessions.length, guests: openSessions.reduce((s, x) => s + x.guestCount, 0) },
      pendingOrders,
      itemsByStatus: Object.fromEntries(itemsByStatus.map((i) => [i.status, i._sum.quantity ?? 0])),
      openServiceRequests: openRequests,
      avgCurrentWaitMinutes: avg(pendingItems.map((i) => (now.getTime() - i.createdAt.getTime()) / 60_000)),
      avgServiceMinutesToday: avg(servedToday.map((i) => (i.servedAt!.getTime() - i.createdAt.getTime()) / 60_000)),
      revenueToday: revenueToday.revenue,
      billsToday: revenueToday.bills,
      upcomingReservationsToday: upcomingReservations,
    };
  }
}
