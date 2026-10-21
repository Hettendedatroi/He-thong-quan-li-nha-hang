import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '../common/constants/permissions';
import { CurrentUser, Public, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/types/auth-user';
import { requireBranch } from '../common/utils/branch-scope';
import { SetAvailabilityDto } from '../menu/dto/menu.dto';
import { MenuService } from '../menu/menu.service';
import { CartService } from './cart.service';
import {
  CancelOrderItemDto,
  CartItemDto,
  CreateCustomerOrderDto,
  CreateStaffOrderDto,
  KitchenQueueQueryDto,
  KitchenStatusDto,
  ListOrdersQueryDto,
  SetPriorityDto,
  UpdateCartItemDto,
  UpdateOrderItemDto,
} from './dto/orders.dto';
import { KitchenService } from './kitchen.service';
import { OrdersService } from './orders.service';

@ApiTags('Public - Gọi món tại bàn')
@Public()
@Controller('public/sessions/:token')
export class PublicOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly cart: CartService,
  ) {}

  /** FR-10: giỏ hàng của bàn */
  @Get('cart')
  getCart(@Param('token') token: string) {
    return this.cart.get(token);
  }

  @Post('cart/items')
  addToCart(@Param('token') token: string, @Body() dto: CartItemDto) {
    return this.cart.add(token, dto);
  }

  @Patch('cart/items/:id')
  updateCart(@Param('token') token: string, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCartItemDto) {
    return this.cart.update(token, id, dto);
  }

  @Delete('cart/items/:id')
  removeFromCart(@Param('token') token: string, @Param('id', ParseIntPipe) id: number) {
    return this.cart.remove(token, id);
  }

  @Delete('cart')
  clearCart(@Param('token') token: string) {
    return this.cart.clear(token);
  }

  /** FR-11, FR-12: gửi đơn (không truyền items => đặt cả giỏ) */
  @Post('orders')
  createOrder(@Param('token') token: string, @Body() dto: CreateCustomerOrderDto, @CurrentUser() user?: AuthUser) {
    return this.orders.createFromSession(token, dto, user);
  }

  /** FR-14: theo dõi trạng thái đơn */
  @Get('orders')
  listOrders(@Param('token') token: string) {
    return this.orders.listForSession(token);
  }

  /** Khách tự hủy món khi bếp chưa nhận */
  @Post('order-items/:itemId/cancel')
  cancelItem(
    @Param('token') token: string,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: CancelOrderItemDto,
  ) {
    return this.orders.cancelByCustomer(token, itemId, dto.reason);
  }
}

@ApiTags('Phục vụ - Đơn gọi món')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ORDER_VIEW)
  list(@CurrentUser() user: AuthUser, @Query() q: ListOrdersQueryDto) {
    return this.orders.list(user, q);
  }

  /** FR-WAT-06: gọi món hộ khách */
  @Post()
  @RequirePermissions(PERMISSIONS.ORDER_CREATE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateStaffOrderDto) {
    return this.orders.createByStaff(user, dto.sessionId, dto.items, dto.note, dto.priority);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ORDER_VIEW)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.orders.get(user, id);
  }

  /** FR-WAT-10 */
  @Post(':id/send-to-kitchen')
  @RequirePermissions(PERMISSIONS.ORDER_MANAGE)
  sendToKitchen(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.orders.sendToKitchen(user, id);
  }

  @Patch(':id/priority')
  @RequirePermissions(PERMISSIONS.ORDER_MANAGE)
  setPriority(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SetPriorityDto) {
    return this.orders.setPriority(user, id, dto.priority);
  }
}

@ApiTags('Phục vụ - Món trong đơn')
@ApiBearerAuth()
@Controller('order-items')
export class OrderItemsController {
  constructor(private readonly orders: OrdersService) {}

  /** FR-WAT-12: đổi món (số lượng / ghi chú) */
  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ORDER_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrderItemDto) {
    return this.orders.updateItem(user, id, dto);
  }

  /** FR-WAT-12: hủy món */
  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.ORDER_MANAGE)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: CancelOrderItemDto) {
    return this.orders.cancelItem(user, id, dto.reason);
  }

  /** Đánh dấu đã mang món ra bàn */
  @Post(':id/serve')
  @RequirePermissions(PERMISSIONS.ORDER_MANAGE)
  serve(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.orders.markServed(user, id);
  }
}

@ApiTags('Bếp - KDS')
@ApiBearerAuth()
@Controller('kitchen')
export class KitchenController {
  constructor(
    private readonly kitchen: KitchenService,
    private readonly menu: MenuService,
  ) {}

  /** FR-KIT-01, FR-KIT-02 */
  @Get('queue')
  @RequirePermissions(PERMISSIONS.KITCHEN_VIEW)
  queue(@CurrentUser() user: AuthUser, @Query() q: KitchenQueueQueryDto) {
    return this.kitchen.queue(requireBranch(user, q.branchId));
  }

  /** FR-KIT-03 */
  @Patch('items/:id/status')
  @RequirePermissions(PERMISSIONS.KITCHEN_UPDATE)
  updateItem(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: KitchenStatusDto) {
    return this.kitchen.updateItemStatus(user, id, dto.status);
  }

  @Post('orders/:id/status')
  @RequirePermissions(PERMISSIONS.KITCHEN_UPDATE)
  updateOrder(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: KitchenStatusDto) {
    return this.kitchen.updateOrderStatus(user, id, dto.status);
  }

  /** FR-KIT-04: đánh dấu món tạm hết, đồng bộ ngay lên menu khách */
  @Patch('menu-items/:id/availability')
  @RequirePermissions(PERMISSIONS.MENU_STOCK)
  setAvailability(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SetAvailabilityDto) {
    return this.menu.setAvailability(user.id, id, dto.isAvailable);
  }
}
