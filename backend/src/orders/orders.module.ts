import { Module } from '@nestjs/common';
import { MenuModule } from '../menu/menu.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { TablesModule } from '../tables/tables.module';
import { CartService } from './cart.service';
import { KitchenService } from './kitchen.service';
import {
  KitchenController,
  OrderItemsController,
  OrdersController,
  PublicOrdersController,
} from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [TablesModule, MenuModule, PromotionsModule],
  controllers: [PublicOrdersController, OrdersController, OrderItemsController, KitchenController],
  providers: [OrdersService, CartService, KitchenService],
  exports: [OrdersService],
})
export class OrdersModule {}
