import { Module } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module';
import { AttendanceController, ShiftOpsController, StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [ReportsModule],
  controllers: [StaffController, AttendanceController, ShiftOpsController],
  providers: [StaffService],
})
export class StaffModule {}
