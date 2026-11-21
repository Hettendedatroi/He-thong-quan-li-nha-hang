import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Promotion } from '@prisma/client';
import { isTimeInRange, localParts } from '../common/utils/time';
import { AuditService } from '../core/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePromotionDto, ListPromotionsQueryDto, UpdatePromotionDto } from './dto/promotions.dto';

export interface DiscountTarget {
  menuItemId?: number | null;
  categoryId?: number | null;
}

export interface VoucherLine extends DiscountTarget {
  /** Thành tiền dòng sau giảm giá món */
  amount: number;
}

/** FR-MGR-09 (combo/happy hour), FR-WAT-13 (voucher) */
@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(q: ListPromotionsQueryDto) {
    const now = new Date();
    return this.prisma.promotion.findMany({
      where: {
        ...(q.branchId ? { OR: [{ branchId: null }, { branchId: q.branchId }] } : {}),
        ...(q.activeOnly ? { isActive: true, startAt: { lte: now }, endAt: { gte: now } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: number) {
    const p = await this.prisma.promotion.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Không tìm thấy khuyến mãi');
    return p;
  }

  async create(actorId: number, dto: CreatePromotionDto) {
    this.validate(dto);
    const promo = await this.prisma.promotion.create({
      data: {
        ...dto,
        code: dto.code?.toUpperCase() ?? null,
        startAt: new Date(dto.startAt),
        endAt: new Date(dto.endAt),
      },
    });
    await this.audit.log({ userId: actorId, action: 'promotion.create', entity: 'Promotion', entityId: promo.id, data: dto });
    return promo;
  }

  async update(actorId: number, id: number, dto: UpdatePromotionDto) {
    const before = await this.get(id);
    this.validate({ ...before, ...dto } as CreatePromotionDto);
    const promo = await this.prisma.promotion.update({
      where: { id },
      data: {
        ...dto,
        code: dto.code === undefined ? undefined : dto.code?.toUpperCase(),
        startAt: dto.startAt ? new Date(dto.startAt) : undefined,
        endAt: dto.endAt ? new Date(dto.endAt) : undefined,
      },
    });
    await this.audit.log({ userId: actorId, action: 'promotion.update', entity: 'Promotion', entityId: id, data: { before, after: dto } });
    return promo;
  }

  async remove(actorId: number, id: number) {
    const used = await this.prisma.bill.count({ where: { promotionId: id } });
    const usedItems = await this.prisma.orderItem.count({ where: { promotionId: id } });
    if (used || usedItems) await this.prisma.promotion.update({ where: { id }, data: { isActive: false } });
    else await this.prisma.promotion.delete({ where: { id } });
    await this.audit.log({ userId: actorId, action: 'promotion.delete', entity: 'Promotion', entityId: id });
    return { ok: true, deactivated: used + usedItems > 0 };
  }

  // ------------------------------------------------------------ Engine tính giảm giá

  isApplicableNow(p: Promotion, at = new Date()): boolean {
    if (!p.isActive || p.startAt > at || p.endAt < at) return false;
    if (p.usageLimit != null && p.usedCount >= p.usageLimit) return false;
    const { dayOfWeek, hhmm } = localParts(at);
    if (p.daysOfWeek.length && !p.daysOfWeek.includes(dayOfWeek)) return false;
    return isTimeInRange(hhmm, p.startTime, p.endTime);
  }

  appliesTo(p: Promotion, target: DiscountTarget): boolean {
    if (p.scope === 'ALL') return true;
    if (p.scope === 'CATEGORY') return target.categoryId != null && p.categoryIds.includes(target.categoryId);
    return target.menuItemId != null && p.menuItemIds.includes(target.menuItemId);
  }

  calcDiscount(p: Promotion, amount: number, quantity = 1): number {
    if (amount <= 0) return 0;
    if (p.type === 'PERCENT') {
      const d = Math.floor((amount * Math.min(p.value, 100)) / 100);
      return p.maxDiscount != null ? Math.min(d, p.maxDiscount) : d;
    }
    return Math.min(p.value * quantity, amount);
  }

  /** Khuyến mãi tự động đang hiệu lực (happy hour...) */
  async activeAutoPromotions(branchId: number | null, at = new Date()) {
    const rows = await this.prisma.promotion.findMany({
      where: {
        code: null,
        isActive: true,
        startAt: { lte: at },
        endAt: { gte: at },
        OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])],
      },
    });
    return rows.filter((p) => this.isApplicableNow(p, at));
  }

  /** Chọn khuyến mãi có lợi nhất cho một dòng món */
  bestItemDiscount(
    promos: Promotion[],
    target: DiscountTarget & { unitPrice: number; quantity: number },
  ): { promotionId: number | null; discount: number } {
    let best = { promotionId: null as number | null, discount: 0 };
    for (const p of promos) {
      if (!this.appliesTo(p, target)) continue;
      const d = this.calcDiscount(p, target.unitPrice * target.quantity, target.quantity);
      if (d > best.discount) best = { promotionId: p.id, discount: d };
    }
    return best;
  }

  /** Kiểm tra & tính giá trị voucher cho hóa đơn */
  async validateVoucher(code: string, branchId: number, lines: VoucherLine[], at = new Date()) {
    const promo = await this.prisma.promotion.findUnique({ where: { code: code.toUpperCase() } });
    if (!promo || (promo.branchId && promo.branchId !== branchId)) {
      throw new BadRequestException('Mã voucher không tồn tại');
    }
    if (!this.isApplicableNow(promo, at)) throw new BadRequestException('Voucher đã hết hạn hoặc chưa đến thời gian áp dụng');
    const base = lines.filter((l) => this.appliesTo(promo, l)).reduce((s, l) => s + l.amount, 0);
    if (base <= 0) throw new BadRequestException('Voucher không áp dụng cho các món trong hóa đơn');
    if (base < promo.minOrderAmount) {
      throw new BadRequestException(`Hóa đơn cần tối thiểu ${promo.minOrderAmount.toLocaleString('vi-VN')}đ để dùng voucher`);
    }
    return { promotion: promo, discount: this.calcDiscount(promo, base) };
  }

  private validate(dto: Partial<CreatePromotionDto>) {
    if (dto.startAt && dto.endAt && new Date(dto.startAt) >= new Date(dto.endAt)) {
      throw new BadRequestException('Thời gian kết thúc phải sau thời gian bắt đầu');
    }
    if (dto.type === 'PERCENT' && dto.value != null && dto.value > 100) {
      throw new BadRequestException('Phần trăm giảm tối đa 100');
    }
    if ((dto.startTime && !dto.endTime) || (!dto.startTime && dto.endTime)) {
      throw new BadRequestException('Cần nhập cả startTime và endTime cho khung giờ');
    }
    if (dto.scope === 'CATEGORY' && !dto.categoryIds?.length) throw new BadRequestException('Chọn ít nhất 1 danh mục');
    if (dto.scope === 'ITEMS' && !dto.menuItemIds?.length) throw new BadRequestException('Chọn ít nhất 1 món');
  }
}
