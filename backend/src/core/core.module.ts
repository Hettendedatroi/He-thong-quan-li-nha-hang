import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { CryptoService } from './crypto.service';
import { MailService } from './mail.service';
import { SettingsService } from './settings.service';
import { StorageService } from './storage.service';

/** Các service dùng chung toàn hệ thống. */
@Global()
@Module({
  providers: [AuditService, SettingsService, CryptoService, MailService, StorageService],
  exports: [AuditService, SettingsService, CryptoService, MailService, StorageService],
})
export class CoreModule {}
