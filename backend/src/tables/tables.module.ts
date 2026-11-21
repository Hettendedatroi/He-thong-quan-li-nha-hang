import { Module } from '@nestjs/common';
import { TableSessionsService } from './table-sessions.service';
import { PublicTablesController, TableSessionsController, TablesController } from './tables.controller';
import { TablesService } from './tables.service';

@Module({
  controllers: [TablesController, TableSessionsController, PublicTablesController],
  providers: [TablesService, TableSessionsService],
  exports: [TablesService, TableSessionsService],
})
export class TablesModule {}
