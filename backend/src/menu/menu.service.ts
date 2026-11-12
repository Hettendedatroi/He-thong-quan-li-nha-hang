import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../core/audit.service';
import { StorageService } from '../core/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  CreateCategoryDto,
  CreateComboDto,
  CreateHolidayDto,
  CreateMenuItemDto,
  CreatePriceRuleDto,
  ListMenuItemsQueryDto,
  UpdateCategoryDto,
  UpdateComboDto,
  UpdateMenuItemDto,
  UpdatePriceRuleDto,
} from './dto/menu.dto';
import { PricingService } from './pricing.service';

const json = (v: unknown) => (v === undefined ? undefined : (v as Prisma.InputJsonValue));

/** FR-MGR-06..FR-MGR-10, FR-KIT-04 */
@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly storage: StorageService,
    private readonly pricing: PricingService,
  ) {}

  // ------------------------------------------------------------ Danh mục (FR-MGR-07)
  listCategories() {
    return this.prisma.menuCategory.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { items: { where: { isDeleted: false } } } } },
    });
  }

  async createCategory(actorId: number, dto: CreateCategoryDto) {
    const c = await this.prisma.menuCategory.create({ data: { ...dto, translations: json(dto.translations) } });
    await this.audit.log({ userId: actorId, action: 'category.create', entity: 'MenuCategory', entityId: c.id, data: dto });
    this.realtime.broadcast('menu.updated', { categoryId: c.id });
    return c;
  }

  async updateCategory(actorId: number, id: number, dto: UpdateCategoryDto) {
    const c = await this.prisma.menuCategory.update({
      where: { id },
      data: { ...dto, translations: json(dto.translations) },
    });
    await this.audit.log({ userId: actorId, action: 'category.update', entity: 'MenuCategory', entityId: id, data: dto });
    this.realtime.broadcast('menu.updated', { categoryId: id });
    return c;
  }

  async deleteCategory(actorId: number, id: number) {
    const count = await this.prisma.menuItem.count({ where: { categoryId: id, isDeleted: false } });
    if (count) throw new BadRequestException('Danh mục còn món, hãy chuyển hoặc xóa món trước');
    const hasHistory = await this.prisma.menuItem.count({ where: { categoryId: id } });
    if (hasHistory) await this.prisma.menuCategory.update({ where: { id }, data: { isActive: false } });
    else await this.prisma.menuCategory.delete({ where: { id } });
    await this.audit.log({ userId: actorId, action: 'category.delete', entity: 'MenuCategory', entityId: id });
    this.realtime.broadcast('menu.updated', { categoryId: id });
    return { ok: true };
  }

  // ------------------------------------------------------------ Món ăn (FR-MGR-06)
  listItems(q: ListMenuItemsQueryDto) {
    return this.prisma.menuItem.findMany({
      where: {
        isDeleted: false,
        ...(q.categoryId ? { categoryId: q.categoryId } : {}),
        ...(q.isAvailable !== undefined ? { isAvailable: q.isAvailable } : {}),
        ...(q.isVisible !== undefined ? { isVisible: q.isVisible } : {}),
        ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
      },
      include: { category: { select: { id: true, name: true } }, priceRules: true },
      orderBy: [{ categoryId: 'asc' }, { name: 'asc' }],
    });
  }

  async getItem(id: number) {
    const item = await this.prisma.menuItem.findUnique({
      where: { id },
      include: { category: true, priceRules: true },
    });
    if (!item || item.isDeleted) throw new NotFoundException('Không tìm thấy món');
    return item;
  }

  async createItem(actorId: number, dto: CreateMenuItemDto) {
    await this.prisma.menuCategory.findUniqueOrThrow({ where: { id: dto.categoryId } });
    const item = await this.prisma.menuItem.create({ data: { ...dto, translations: json(dto.translations) } });
    await this.audit.log({ userId: actorId, action: 'menu_item.create', entity: 'MenuItem', entityId: item.id, data: dto });
    this.realtime.broadcast('menu.updated', { menuItemId: item.id });
    return item;
  }

  async updateItem(actorId: number, id: number, dto: UpdateMenuItemDto) {
    const before = await this.getItem(id);
    const item = await this.prisma.menuItem.update({
      where: { id },
      data: { ...dto, translations: json(dto.translations) },
    });
    // NFR-06: ghi lại thay đổi giá
    const priceChanged = dto.price !== undefined && dto.price !== before.price;
    await this.audit.log({
      userId: actorId,
      action: priceChanged ? 'menu_item.price_change' : 'menu_item.update',
      entity: 'MenuItem',
      entityId: id,
      data: priceChanged ? { oldPrice: before.price, newPrice: dto.price } : dto,
    });
    this.emitItem(item);
    return item;
  }

  /** Xóa mềm để không mất lịch sử order / báo cáo */
  async deleteItem(actorId: number, id: number) {
    await this.getItem(id);
    const item = await this.prisma.menuItem.update({ where: { id }, data: { isDeleted: true, isVisible: false } });
    await this.audit.log({ userId: actorId, action: 'menu_item.delete', entity: 'MenuItem', entityId: id });
    this.emitItem(item);
    return { ok: true };
  }

  /** FR-MGR-08: ẩn / hiện món, đồng bộ ngay tới bếp và khách */
  async setVisibility(actorId: number, id: number, isVisible: boolean) {
    await this.getItem(id);
    const item = await this.prisma.menuItem.update({ where: { id }, data: { isVisible } });
    await this.audit.log({ userId: actorId, action: 'menu_item.visibility', entity: 'MenuItem', entityId: id, data: { isVisible } });
    this.emitItem(item);
    return item;
  }

  /** FR-KIT-04: bếp đánh dấu tạm hết / còn hàng - đồng bộ 2 chiều với menu */
  async setAvailability(actorId: number, id: number, isAvailable: boolean) {
    await this.getItem(id);
    const item = await this.prisma.menuItem.update({ where: { id }, data: { isAvailable } });
    await this.audit.log({ userId: actorId, action: 'menu_item.availability', entity: 'MenuItem', entityId: id, data: { isAvailable } });
    this.emitItem(item);
    return item;
  }

  async uploadImage(actorId: number, id: number, file: Express.Multer.File | undefined) {
    await this.getItem(id);
    const imageUrl = await this.storage.saveImage(file, 'menu');
    const item = await this.prisma.menuItem.update({ where: { id }, data: { imageUrl } });
    await this.audit.log({ userId: actorId, action: 'menu_item.image', entity: 'MenuItem', entityId: id });
    this.emitItem(item);
    return item;
  }

  // ------------------------------------------------------------ Combo (FR-MGR-09)
  listCombos() {
    return this.prisma.combo.findMany({
      include: { items: { include: { menuItem: { select: { id: true, name: true, isAvailable: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createCombo(actorId: number, dto: CreateComboDto) {
    const { items, translations, ...data } = dto;
    await this.assertItemsExist(items.map((i) => i.menuItemId));
    const combo = await this.prisma.combo.create({
      data: {
        ...data,
        translations: json(translations),
        items: { create: items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity ?? 1 })) },
      },
      include: { items: true },
    });
    await this.audit.log({ userId: actorId, action: 'combo.create', entity: 'Combo', entityId: combo.id, data: dto });
    this.realtime.broadcast('menu.updated', { comboId: combo.id });
    return combo;
  }

  async updateCombo(actorId: number, id: number, dto: UpdateComboDto) {
    const { items, translations, ...data } = dto;
    if (items) await this.assertItemsExist(items.map((i) => i.menuItemId));
    const combo = await this.prisma.$transaction(async (tx) => {
      if (items) {
        await tx.comboItem.deleteMany({ where: { comboId: id } });
        await tx.comboItem.createMany({
          data: items.map((i) => ({ comboId: id, menuItemId: i.menuItemId, quantity: i.quantity ?? 1 })),
        });
      }
      return tx.combo.update({ where: { id }, data: { ...data, translations: json(translations) }, include: { items: true } });
    });
    await this.audit.log({ userId: actorId, action: 'combo.update', entity: 'Combo', entityId: id, data: dto });
    this.realtime.broadcast('menu.updated', { comboId: id });
    return combo;
  }

  async deleteCombo(actorId: number, id: number) {
    const used = await this.prisma.orderItem.count({ where: { comboId: id } });
    if (used) await this.prisma.combo.update({ where: { id }, data: { isActive: false } });
    else await this.prisma.combo.delete({ where: { id } });
    await this.audit.log({ userId: actorId, action: 'combo.delete', entity: 'Combo', entityId: id });
    this.realtime.broadcast('menu.updated', { comboId: id });
    return { ok: true };
  }

  // ------------------------------------------------------------ Giá theo thời gian (FR-MGR-10)
  listPriceRules(menuItemId: number) {
    return this.prisma.priceRule.findMany({ where: { menuItemId }, orderBy: { dayType: 'asc' } });
  }

  async createPriceRule(actorId: number, menuItemId: number, dto: CreatePriceRuleDto) {
    await this.getItem(menuItemId);
    this.assertTimeRange(dto.startTime, dto.endTime);
    const rule = await this.prisma.priceRule.create({ data: { ...dto, menuItemId } });
    await this.audit.log({ userId: actorId, action: 'price_rule.create', entity: 'MenuItem', entityId: menuItemId, data: dto });
    return rule;
  }

  async updatePriceRule(actorId: number, ruleId: number, dto: UpdatePriceRuleDto) {
    const before = await this.prisma.priceRule.findUniqueOrThrow({ where: { id: ruleId } });
    this.assertTimeRange(dto.startTime ?? before.startTime, dto.endTime ?? before.endTime);
    const rule = await this.prisma.priceRule.update({ where: { id: ruleId }, data: dto });
    await this.audit.log({
      userId: actorId,
      action: 'price_rule.update',
      entity: 'MenuItem',
      entityId: before.menuItemId,
      data: { before, after: dto },
    });
    return rule;
  }

  async deletePriceRule(actorId: number, ruleId: number) {
    const rule = await this.prisma.priceRule.delete({ where: { id: ruleId } });
    await this.audit.log({ userId: actorId, action: 'price_rule.delete', entity: 'MenuItem', entityId: rule.menuItemId, data: rule });
    return { ok: true };
  }

  listHolidays() {
    return this.prisma.holiday.findMany({ orderBy: { date: 'asc' } });
  }

  async createHoliday(actorId: number, dto: CreateHolidayDto) {
    const h = await this.prisma.holiday.create({
      data: { name: dto.name, date: new Date(`${dto.date.slice(0, 10)}T00:00:00.000Z`) },
    });
    this.pricing.clearCache();
    await this.audit.log({ userId: actorId, action: 'holiday.create', entity: 'Holiday', entityId: h.id, data: dto });
    return h;
  }

  async deleteHoliday(actorId: number, id: number) {
    await this.prisma.holiday.delete({ where: { id } });
    this.pricing.clearCache();
    await this.audit.log({ userId: actorId, action: 'holiday.delete', entity: 'Holiday', entityId: id });
    return { ok: true };
  }

  // ------------------------------------------------------------ helpers
  private emitItem(item: { id: number; isAvailable: boolean; isVisible: boolean; isDeleted: boolean; price: number; name: string }) {
    // Phát cho mọi client: menu khách, màn hình phục vụ, KDS
    this.realtime.broadcast('menu.item-updated', {
      id: item.id,
      name: item.name,
      price: item.price,
      isAvailable: item.isAvailable,
      isVisible: item.isVisible && !item.isDeleted,
    });
  }

  private async assertItemsExist(ids: number[]) {
    const count = await this.prisma.menuItem.count({ where: { id: { in: ids }, isDeleted: false } });
    if (count !== new Set(ids).size) throw new BadRequestException('Có món trong combo không tồn tại');
  }

  private assertTimeRange(start?: string | null, end?: string | null) {
    if ((start && !end) || (!start && end)) throw new BadRequestException('Cần nhập cả startTime và endTime');
  }
}
