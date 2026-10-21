import { Module } from '@nestjs/common';
import { BackupService } from './backup.service';
import { PublicSystemController, SettingsController, SystemAdminController } from './system.controller';

@Module({
  controllers: [PublicSystemController, SettingsController, SystemAdminController],
  providers: [BackupService],
})
export class SystemModule {}
