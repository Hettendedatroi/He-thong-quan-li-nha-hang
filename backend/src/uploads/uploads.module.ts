import { Module } from '@nestjs/common';
import { TablesModule } from '../tables/tables.module';
import { UploadsController } from './uploads.controller';

@Module({
  imports: [TablesModule],
  controllers: [UploadsController],
})
export class UploadsModule {}
