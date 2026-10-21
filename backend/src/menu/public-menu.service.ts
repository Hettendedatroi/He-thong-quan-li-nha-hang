import { Injectable, NotFoundException } from '@nestjs/common';
import { MenuItem, PriceRule, Promotion } from '@prisma/client';
import { addDays } from '../common/utils/time';
import { SettingsService } from '../core/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { PromotionsService } from '../promotions/promotions.service';
import { localize } from './localize';
import { PricingService } from './pricing.service';

interface ItemStats {
  orderCount: number;
  likeCount: number;
  dislikeCount: number;
  avgRating: number | null;
  ratingCount: number;
}

const EMPTY_STATS: ItemStats = { orderCount: 0, likeCount: 0, dislikeCount: 0, avgRating: null, ratingCount: 0 };

/** Menu số cho khách (FR-07, FR-08, FR-09) */
@Injectable()
export class PublicMenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly promotions: PromotionsService,
    private readonly settings: SettingsService,
  ) {}

  /** FR-08, US-1 AC2: menu theo danh mục, có ảnh, mô tả, giá, tình trạng còn hàng */
  async menu(lang?: string, branchId?: number) {
    const now = new Date();
    const [restaurant, categories, holiday, promos, stats, combos] = await Promise.all([
      this.restaurantInfo(branchId),
      this.prisma.menuCategory.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: {
          items: {
            where: { isDeleted: false, isVisible: true },
            include: { priceRules: true },
            orderBy: { name: 'asc' },
          },
        },
      }),
      this.pricing.isHoliday(now),
      this.promotions.activeAutoPromotions(branchId ?? null, now),
      this.itemStats(),
      this.combos(lang),
    ]);

    return {
      generatedAt: now,
      restaurant,
      categories: categories.map(({ items, ...c }) => ({
        ...localize(c, lang),
        items: items.map((item) => this.presentItem(item, lang, holiday, promos, stats.get(item.id), now)),
      })),
      combos,
    };
  }

  /** US-17 AC3: tên, địa chỉ, giờ mở cửa của nhà hàng hiển thị trên trang thực đơn */
  private async restaurantInfo(branchId?: number) {
    const [info, branch] = await Promise.all([
      this.settings.get('restaurant'),
      branchId
        ? this.prisma.branch.findUnique({ where: { id: branchId } })
        : this.prisma.branch.findFirst({ where: { isActive: true }, orderBy: { id: 'asc' } }),
    ]);
    return {
      name: info.name,
      hotline: info.hotline,
      logoUrl: info.logoUrl || null,
      description: info.description || null,
      branchId: branch?.id ?? null,
      branchName: branch?.name ?? null,
      address: branch?.address ?? null,
      phone: branch?.phone ?? null,
      openTime: branch?.openTime ?? null,
      closeTime: branch?.closeTime ?? null,
    };
  }

  /** FR-09: món bán chạy, món mới, món được đánh giá cao */
  async highlights(lang?: string, limit = 8, branchId?: number) {
    const now = new Date();
    const [items, holiday, promos, stats] = await Promise.all([
      this.prisma.menuItem.findMany({
        where: { isDeleted: false, isVisible: true, category: { isActive: true } },
        include: { priceRules: true },
      }),
      this.pricing.isHoliday(now),
      this.promotions.activeAutoPromotions(branchId ?? null, now),
      this.itemStats(),
    ]);
    const present = items.map((i) => this.presentItem(i, lang, holiday, promos, stats.get(i.id), now));
    const popularity = (x: (typeof present)[number]) => x.stats.orderCount + x.stats.likeCount * 2 - x.stats.dislikeCount;
    return {
      popular: [...present].sort((a, b) => popularity(b) - popularity(a)).slice(0, limit),
      newest: [...present].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit),
      topRated: present
        .filter((x) => x.stats.ratingCount > 0)
        .sort((a, b) => (b.stats.avgRating ?? 0) - (a.stats.avgRating ?? 0) || b.stats.ratingCount - a.stats.ratingCount)
        .slice(0, limit),
    };
  }

  /** Chi tiết món + đánh giá của khách khác (FR-09) */
  async item(id: number, lang?: string) {
    const now = new Date();
    const item = await this.prisma.menuItem.findUnique({
      where: { id },
      include: { priceRules: true, category: true },
    });
    if (!item || item.isDeleted || !item.isVisible) throw new NotFoundException('Không tìm thấy món');
    const [holiday, promos, stats, reviews] = await Promise.all([
      this.pricing.isHoliday(now),
      this.promotions.activeAutoPromotions(null, now),
      this.itemStats([id]),
      this.prisma.dishReview.findMany({
        where: { menuItemId: id, isHidden: false },
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: {
          customer: { select: { fullName: true, avatarUrl: true } },
          responses: { where: { isPublic: true }, select: { message: true, createdAt: true } },
        },
      }),
    ]);
    return {
      ...this.presentItem(item, lang, holiday, promos, stats.get(id), now),
      category: localize(item.category, lang),
      reviews: reviews.map(({ customer, customerId: _c, sessionId: _s, orderItemId: _o, isHidden: _h, ...r }) => ({
        ...r,
        author: r.isAnonymous || !customer ? 'Khách ẩn danh' : customer.fullName,
        avatarUrl: r.isAnonymous ? null : (customer?.avatarUrl ?? null),
      })),
    };
  }

  async combos(lang?: string) {
    const combos = await this.prisma.combo.findMany({
      where: { isActive: true },
      include: { items: { include: { menuItem: { select: { id: true, name: true, isAvailable: true, translations: true, description: true } } } } },
    });
    return combos.map((c) => ({
      ...localize(c, lang),
      isAvailable: c.items.every((i) => i.menuItem.isAvailable),
      items: c.items.map((i) => ({ quantity: i.quantity, menuItem: localize(i.menuItem, lang) })),
    }));
  }

  private presentItem(
    item: MenuItem & { priceRules: PriceRule[] },
    lang: string | undefined,
    holiday: boolean,
    promos: Promotion[],
    stats: ItemStats | undefined,
    now: Date,
  ) {
    const price = this.pricing.effectivePrice(item, now, holiday);
    const best = this.promotions.bestItemDiscount(promos, {
      menuItemId: item.id,
      categoryId: item.categoryId,
      unitPrice: price,
      quantity: 1,
    });
    const { name, description } = localize(item, lang);
    return {
      id: item.id,
      categoryId: item.categoryId,
      name,
      description,
      imageUrl: item.imageUrl,
      prepTimeMinutes: item.prepTimeMinutes,
      tags: item.tags,
      createdAt: item.createdAt,
      basePrice: item.price,
      price,
      promoPrice: best.discount > 0 ? price - best.discount : null,
      promotionId: best.promotionId,
      inStock: item.isAvailable,
      isNew: now.getTime() - item.createdAt.getTime() < 14 * 86_400_000,
      stats: stats ?? EMPTY_STATS,
    };
  }

  /** Số lượt gọi (30 ngày gần nhất) + like/dislike + điểm trung bình */
  private async itemStats(ids?: number[]): Promise<Map<number, ItemStats>> {
    const since = addDays(new Date(), -30);
    const [orders, reviews] = await Promise.all([
      this.prisma.orderItem.groupBy({
        by: ['menuItemId'],
        where: {
          menuItemId: ids ? { in: ids } : { not: null },
          status: { not: 'CANCELLED' },
          createdAt: { gte: since },
        },
        _sum: { quantity: true },
      }),
      this.prisma.$queryRaw<{ menuItemId: number; likes: number; dislikes: number; avg: number | null; ratings: number }[]>`
        SELECT "menuItemId",
               COUNT(*) FILTER (WHERE reaction = 'LIKE')::int    AS likes,
               COUNT(*) FILTER (WHERE reaction = 'DISLIKE')::int AS dislikes,
               AVG(rating)::float8                                AS avg,
               COUNT(rating)::int                                 AS ratings
        FROM "DishReview"
        WHERE "isHidden" = false
        GROUP BY "menuItemId"`,
    ]);
    const map = new Map<number, ItemStats>();
    for (const o of orders) {
      if (o.menuItemId == null) continue;
      map.set(o.menuItemId, { ...EMPTY_STATS, orderCount: o._sum.quantity ?? 0 });
    }
    for (const r of reviews) {
      const cur = map.get(r.menuItemId) ?? { ...EMPTY_STATS };
      map.set(r.menuItemId, {
        ...cur,
        likeCount: r.likes,
        dislikeCount: r.dislikes,
        avgRating: r.avg != null ? Math.round(r.avg * 10) / 10 : null,
        ratingCount: r.ratings,
      });
    }
    return map;
  }
}
