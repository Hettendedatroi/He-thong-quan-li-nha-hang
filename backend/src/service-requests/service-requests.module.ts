import { Module } from '@nestjs/common';
import { TablesModule } from '../tables/tables.module';
import { PublicServiceRequestsController, ServiceRequestsController } from './service-requests.controller';
import { ServiceRequestsService } from './service-requests.service';

@Module({
  imports: [TablesModule],
  controllers: [PublicServiceRequestsController, ServiceRequestsController],
  providers: [ServiceRequestsService],
})
export class ServiceRequestsModule {}
