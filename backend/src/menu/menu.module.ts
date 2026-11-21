import { Module } from '@nestjs/common';
import { PromotionsModule } from '../promotions/promotions.module';
import { MenuController, PublicMenuController } from './menu.controller';
import { MenuService } from './menu.service';
import { PricingService } from './pricing.service';
import { PublicMenuService } from './public-menu.service';

@Module({
  imports: [PromotionsModule],
  controllers: [PublicMenuController, MenuController],
  providers: [MenuService, PricingService, PublicMenuService],
  exports: [MenuService, PricingService],
})
export class MenuModule {}
