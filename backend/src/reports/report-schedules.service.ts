import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReportFrequency, ReportSchedule } from '@prisma/client';
import { addDays, APP_UTC_OFFSET, localParts, startOfLocalDay } from '../common/utils/time';
import { AuditService } from '../core/audit.service';
import { MailService } from '../core/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReportScheduleDto, ExportFormat, ReportType, UpdateReportScheduleDto } from './dto/reports.dto';
import { ExportService } from './export.service';

const SEND_HOUR = '07:00';

/** Lần chạy kế tiếp: 07:00 sáng ngày hôm sau / tuần sau / tháng sau (giờ địa phương) */
export function nextRunAt(frequency: ReportFrequency, after = new Date()): Date {
  const { ymd } = localParts(after);
  const base = new Date(`${ymd}T${SEND_HOUR}:00${APP_UTC_OFFSET}`);
  if (frequency === 'DAILY') return addDays(base, 1);
  if (frequency === 'WEEKLY') return addDays(base, 7);
  const next = new Date(base);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

/** FR-MGR-16: lập lịch tự động gửi báo cáo định kỳ qua email */
@Injectable()
export class ReportSchedulesService {
  private readonly logger = new Logger(ReportSchedulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly exporter: ExportService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.reportSchedule.findMany({
      include: { branch: { select: { id: true, name: true } }, createdBy: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(actorId: number, dto: CreateReportScheduleDto) {
    const s = await this.prisma.reportSchedule.create({
      data: { ...dto, createdById: actorId, nextRunAt: nextRunAt(dto.frequency) },
    });
    await this.audit.log({ userId: actorId, action: 'report_schedule.create', entity: 'ReportSchedule', entityId: s.id, data: dto });
    return s;
  }

  async update(actorId: number, id: number, dto: UpdateReportScheduleDto) {
    const s = await this.prisma.reportSchedule.update({
      where: { id },
      data: { ...dto, ...(dto.frequency ? { nextRunAt: nextRunAt(dto.frequency) } : {}) },
    });
    await this.audit.log({ userId: actorId, action: 'report_schedule.update', entity: 'ReportSchedule', entityId: id, data: dto });
    return s;
  }

  async remove(actorId: number, id: number) {
    await this.prisma.reportSchedule.delete({ where: { id } });
    await this.audit.log({ userId: actorId, action: 'report_schedule.delete', entity: 'ReportSchedule', entityId: id });
    return { ok: true };
  }

  async runNow(id: number) {
    const s = await this.prisma.reportSchedule.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Không tìm thấy lịch báo cáo');
    return this.run(s);
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async runDue() {
    const due = await this.prisma.reportSchedule.findMany({ where: { isActive: true, nextRunAt: { lte: new Date() } } });
    for (const s of due) {
      await this.run(s).catch((e) => this.logger.error(`Lịch báo cáo #${s.id} lỗi: ${(e as Error).message}`));
    }
  }

  private async run(s: ReportSchedule) {
    const to = startOfLocalDay();
    const days = s.frequency === 'DAILY' ? 1 : s.frequency === 'WEEKLY' ? 7 : 30;
    const from = addDays(to, -days);
    const file = await this.exporter.build(s.reportType as ReportType, s.format as ExportFormat, from, to, s.branchId ?? undefined);
    const sent = await this.mail.send({
      to: s.recipients,
      subject: `[Báo cáo tự động] ${s.name}`,
      text: `Đính kèm báo cáo "${s.name}" từ ${localParts(from).ymd} đến ${localParts(addDays(to, -1)).ymd}.`,
      attachments: [{ filename: file.filename, content: file.buffer, contentType: file.contentType }],
    });
    await this.prisma.reportSchedule.update({
      where: { id: s.id },
      data: { lastRunAt: new Date(), nextRunAt: nextRunAt(s.frequency) },
    });
    return { ok: sent, filename: file.filename, recipients: s.recipients };
  }
}
