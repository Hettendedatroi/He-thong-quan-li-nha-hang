import { Module } from '@nestjs/common';
import { PromotionsModule } from '../promotions/promotions.module';
import { TablesModule } from '../tables/tables.module';
import { BillsController, PublicBillsController } from './bills.controller';
import { BillsService } from './bills.service';
import { LoyaltyService } from './loyalty.service';

@Module({
  imports: [TablesModule, PromotionsModule],
  controllers: [BillsController, PublicBillsController],
  providers: [BillsService, LoyaltyService],
})
export class BillingModule {}
