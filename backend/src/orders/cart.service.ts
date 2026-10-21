import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PricingService } from '../menu/pricing.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TableSessionsService } from '../tables/table-sessions.service';
import { CartItemDto, MAX_ITEM_QUANTITY, UpdateCartItemDto } from './dto/orders.dto';

/** FR-10: giỏ hàng dùng chung cho cả bàn - nhiều điện thoại cùng bàn thấy cùng một giỏ */
@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: TableSessionsService,
    private readonly pricing: PricingService,
    private readonly realtime: RealtimeService,
  ) {}

  async get(token: string) {
    const session = await this.sessions.getByToken(token);
    return this.build(session.id);
  }

  async add(token: string, dto: CartItemDto) {
    const session = await this.sessions.getByToken(token);
    if (!!dto.menuItemId === !!dto.comboId) throw new BadRequestException('Cần menuItemId hoặc comboId');
    if (dto.menuItemId) {
      const m = await this.prisma.menuItem.findUnique({ where: { id: dto.menuItemId } });
      if (!m || m.isDeleted || !m.isVisible) throw new NotFoundException('Món không tồn tại');
      if (!m.isAvailable) throw new BadRequestException(`Món "${m.name}" đang tạm hết`);
    } else {
      const c = await this.prisma.combo.findUnique({ where: { id: dto.comboId } });
      if (!c || !c.isActive) throw new NotFoundException('Combo không tồn tại');
    }
    // Cùng món + cùng ghi chú => cộng dồn số lượng
    const same = await this.prisma.cartItem.findFirst({
      where: { sessionId: session.id, menuItemId: dto.menuItemId ?? null, comboId: dto.comboId ?? null, note: dto.note ?? null },
    });
    if (same) {
      await this.prisma.cartItem.update({
        where: { id: same.id },
        data: { quantity: Math.min(MAX_ITEM_QUANTITY, same.quantity + dto.quantity) },
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          sessionId: session.id,
          menuItemId: dto.menuItemId,
          comboId: dto.comboId,
          quantity: dto.quantity,
          note: dto.note,
        },
      });
    }
    return this.broadcast(session.id, session.token);
  }

  async update(token: string, id: number, dto: UpdateCartItemDto) {
    const session = await this.sessions.getByToken(token);
    const item = await this.prisma.cartItem.findFirst({ where: { id, sessionId: session.id } });
    if (!item) throw new NotFoundException('Không tìm thấy món trong giỏ');
    await this.prisma.cartItem.update({ where: { id }, data: dto });
    return this.broadcast(session.id, session.token);
  }

  async remove(token: string, id: number) {
    const session = await this.sessions.getByToken(token);
    await this.prisma.cartItem.deleteMany({ where: { id, sessionId: session.id } });
    return this.broadcast(session.id, session.token);
  }

  async clear(token: string) {
    const session = await this.sessions.getByToken(token);
    await this.prisma.cartItem.deleteMany({ where: { sessionId: session.id } });
    return this.broadcast(session.id, session.token);
  }

  private async broadcast(sessionId: number, token: string) {
    const cart = await this.build(sessionId);
    this.realtime.toSession(token, 'cart.updated', cart);
    return cart;
  }

  private async build(sessionId: number) {
    const now = new Date();
    const holiday = await this.pricing.isHoliday(now);
    const items = await this.prisma.cartItem.findMany({
      where: { sessionId },
      orderBy: { id: 'asc' },
      include: { menuItem: { include: { priceRules: true } }, combo: true },
    });
    const lines = items.map((i) => {
      const unitPrice = i.menuItem ? this.pricing.effectivePrice(i.menuItem, now, holiday) : (i.combo?.price ?? 0);
      return {
        id: i.id,
        menuItemId: i.menuItemId,
        comboId: i.comboId,
        name: i.menuItem?.name ?? `Combo ${i.combo?.name}`,
        imageUrl: i.menuItem?.imageUrl ?? i.combo?.imageUrl ?? null,
        inStock: i.menuItem ? i.menuItem.isAvailable && !i.menuItem.isDeleted : !!i.combo?.isActive,
        unitPrice,
        quantity: i.quantity,
        note: i.note,
        amount: unitPrice * i.quantity,
      };
    });
    return { items: lines, total: lines.reduce((s, l) => s + l.amount, 0) };
  }
}
