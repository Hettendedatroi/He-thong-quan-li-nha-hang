import { Module } from '@nestjs/common';
import { TablesModule } from '../tables/tables.module';
import {
  MockPaymentController,
  PublicReservationsController,
  ReservationsController,
} from './reservations.controller';
import { ReservationsScheduler } from './reservations.scheduler';
import { ReservationsService } from './reservations.service';

@Module({
  imports: [TablesModule],
  controllers: [PublicReservationsController, MockPaymentController, ReservationsController],
  providers: [ReservationsService, ReservationsScheduler],
  exports: [ReservationsService],
})
export class ReservationsModule {}
