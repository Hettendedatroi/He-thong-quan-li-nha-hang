import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { ReportSchedulesService } from './report-schedules.service';
import { ReportSchedulesController, ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  // ReportSchedulesController đặt trước để route "reports/schedules" không bị nuốt bởi route khác
  controllers: [ReportSchedulesController, ReportsController],
  providers: [ReportsService, ExportService, ReportSchedulesService],
  exports: [ReportsService],
})
export class ReportsModule {}
