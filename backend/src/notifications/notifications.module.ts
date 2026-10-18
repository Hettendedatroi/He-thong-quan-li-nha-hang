import { Global, Module } from '@nestjs/common';
import { MyNotificationsController, NotificationsAdminController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  controllers: [MyNotificationsController, NotificationsAdminController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
