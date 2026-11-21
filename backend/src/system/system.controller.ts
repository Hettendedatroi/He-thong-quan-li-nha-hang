import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { PERMISSIONS } from '../common/constants/permissions';
import { CurrentUser, Public, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/types/auth-user';
import { randomToken } from '../common/utils/codes';
import { paged, toSkipTake } from '../common/utils/pagination';
import { parseDateRange } from '../common/utils/time';
import { AuditService } from '../core/audit.service';
import { SETTING_KEYS, SettingKey, SettingsService } from '../core/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { BackupService } from './backup.service';
import { CreateDeviceDto, DeviceHeartbeatDto, ErrorLogQueryDto, UpdateDeviceDto, UpdateSettingDto } from './dto/system.dto';

/** Thiết bị coi là online nếu có tín hiệu trong 2 phút gần nhất */
const ONLINE_WINDOW_MS = 2 * 60_000;

@ApiTags('Public - Hệ thống')
@Public()
@Controller()
export class PublicSystemController {
  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Health check cho giám sát uptime (NFR-04) */
  @Get('health')
  async health() {
    const started = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', db: 'ok', dbLatencyMs: Date.now() - started, uptimeSeconds: Math.round(process.uptime()) };
  }

  /** Thông tin công khai cho giao diện khách: tên nhà hàng, ngôn ngữ, phương thức thanh toán... */
  @Get('public/settings')
  async publicSettings() {
    const all = await this.settings.getAll();
    const { reservationPolicy: p } = all;
    return {
      restaurant: all.restaurant,
      i18n: all.i18n,
      paymentMethods: Object.entries(all.paymentMethods)
        .filter(([, on]) => on)
        .map(([m]) => m),
      reservation: {
        slotMinutes: p.slotMinutes,
        defaultDurationMinutes: p.defaultDurationMinutes,
        minAdvanceMinutes: p.minAdvanceMinutes,
        maxAdvanceDays: p.maxAdvanceDays,
        freeCancelHours: p.freeCancelHours,
        maxHoldMinutes: p.maxHoldMinutes,
        depositRequired: p.depositRequired,
        depositPartySize: p.depositPartySize,
        depositAmount: p.depositAmount,
      },
      loyalty: { enabled: all.loyalty.enabled, amountPerPoint: all.loyalty.amountPerPoint, pointValue: all.loyalty.pointValue },
    };
  }

  /** Thiết bị không giữ kết nối socket (vd máy in) gửi heartbeat qua HTTP (FR-ADM-11) */
  @Post('public/devices/heartbeat')
  async heartbeat(@Body() dto: DeviceHeartbeatDto) {
    const device = await this.prisma.device
      .update({ where: { deviceKey: dto.deviceKey }, data: { lastSeenAt: new Date(), isOnline: true } })
      .catch(() => null);
    if (!device) throw new NotFoundException('Thiết bị chưa được đăng ký');
    return { ok: true };
  }
}

@ApiTags('Admin - Cấu hình hệ thống')
@ApiBearerAuth()
@RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
@Controller('admin/settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** FR-ADM-05, 07, 08, 10: toàn bộ cấu hình */
  @Get()
  all() {
    return this.settings.getAll();
  }

  @Get(':key')
  get(@Param('key') key: string) {
    return this.settings.get(this.checkKey(key));
  }

  /**
   * Cập nhật một nhóm cấu hình. Key: restaurant | reservationPolicy | ordering | billing | paymentMethods | loyalty | i18n
   */
  @Put(':key')
  async update(@CurrentUser() user: AuthUser, @Param('key') key: string, @Body() dto: UpdateSettingDto) {
    const k = this.checkKey(key);
    const before = await this.settings.get(k);
    const after = await this.settings.set(k, dto.value as never);
    await this.audit.log({ userId: user.id, action: 'settings.update', entity: 'Setting', entityId: k, data: { before, after } });
    return after;
  }

  private checkKey(key: string): SettingKey {
    if (!SETTING_KEYS.includes(key as SettingKey)) {
      throw new BadRequestException(`Key không hợp lệ. Hợp lệ: ${SETTING_KEYS.join(', ')}`);
    }
    return key as SettingKey;
  }
}

@ApiTags('Admin - Giám sát hệ thống')
@ApiBearerAuth()
@Controller('admin')
export class SystemAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly backups: BackupService,
    private readonly audit: AuditService,
  ) {}

  /** FR-ADM-11: bảng sức khỏe hệ thống & kết nối thiết bị */
  @Get('system/health')
  @RequirePermissions(PERMISSIONS.SYSTEM_MONITOR)
  async health() {
    const started = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    const dbLatencyMs = Date.now() - started;
    const since = new Date(Date.now() - 24 * 3600_000);
    const [devices, errors24h, openSessions] = await Promise.all([
      this.prisma.device.findMany({ include: { branch: { select: { name: true } } }, orderBy: [{ branchId: 'asc' }, { type: 'asc' }] }),
      this.prisma.errorLog.count({ where: { createdAt: { gte: since } } }),
      this.prisma.tableSession.count({ where: { status: 'OPEN' } }),
    ]);
    const now = Date.now();
    const deviceList = devices.map(({ deviceKey: _k, ...d }) => ({
      ...d,
      online: !!d.lastSeenAt && now - d.lastSeenAt.getTime() < ONLINE_WINDOW_MS && d.isOnline,
    }));
    const mem = process.memoryUsage();
    return {
      server: {
        uptimeSeconds: Math.round(process.uptime()),
        memoryMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        nodeVersion: process.version,
      },
      database: { status: 'ok', latencyMs: dbLatencyMs },
      realtime: { connectedClients: this.realtime.connectedClients() },
      activity: { openTableSessions: openSessions, errorsLast24h: errors24h },
      devices: {
        total: deviceList.length,
        online: deviceList.filter((d) => d.online).length,
        list: deviceList,
      },
    };
  }

  // ------------------------------------------------------------ Thiết bị
  @Get('devices')
  @RequirePermissions(PERMISSIONS.SYSTEM_MONITOR)
  devices() {
    return this.prisma.device.findMany({ orderBy: { id: 'asc' } });
  }

  /** Đăng ký thiết bị; deviceKey trả về dùng để thiết bị kết nối socket / gửi heartbeat */
  @Post('devices')
  @RequirePermissions(PERMISSIONS.SYSTEM_MONITOR)
  async createDevice(@CurrentUser() user: AuthUser, @Body() dto: CreateDeviceDto) {
    const device = await this.prisma.device.create({ data: { ...dto, deviceKey: `dev_${randomToken(18)}` } });
    await this.audit.log({ userId: user.id, action: 'device.create', entity: 'Device', entityId: device.id, data: dto });
    return device;
  }

  @Patch('devices/:id')
  @RequirePermissions(PERMISSIONS.SYSTEM_MONITOR)
  updateDevice(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDeviceDto) {
    return this.prisma.device.update({ where: { id }, data: dto });
  }

  @Delete('devices/:id')
  @RequirePermissions(PERMISSIONS.SYSTEM_MONITOR)
  async deleteDevice(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.prisma.device.delete({ where: { id } });
    await this.audit.log({ userId: user.id, action: 'device.delete', entity: 'Device', entityId: id });
    return { ok: true };
  }

  // ------------------------------------------------------------ Log lỗi (FR-ADM-13)
  @Get('error-logs')
  @RequirePermissions(PERMISSIONS.SYSTEM_MONITOR)
  async errorLogs(@Query() q: ErrorLogQueryDto) {
    const range = q.from || q.to ? parseDateRange(q.from, q.to) : null;
    const where = {
      ...(range ? { createdAt: { gte: range.from, lt: range.to } } : {}),
      ...(q.search ? { message: { contains: q.search, mode: 'insensitive' as const } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.errorLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...toSkipTake(q.page, q.limit) }),
      this.prisma.errorLog.count({ where }),
    ]);
    return paged(items, total, q.page, q.limit);
  }

  // ------------------------------------------------------------ Sao lưu / phục hồi (FR-ADM-14)
  @Get('backups')
  @RequirePermissions(PERMISSIONS.SYSTEM_BACKUP)
  listBackups() {
    return this.backups.list();
  }

  @Post('backups')
  @RequirePermissions(PERMISSIONS.SYSTEM_BACKUP)
  async createBackup(@CurrentUser() user: AuthUser) {
    const result = await this.backups.create();
    await this.audit.log({ userId: user.id, action: 'system.backup', entity: 'System', data: { filename: result.filename } });
    return result;
  }

  @Get('backups/:filename')
  @RequirePermissions(PERMISSIONS.SYSTEM_BACKUP)
  download(@Param('filename') filename: string, @Res({ passthrough: true }) res: Response) {
    const path = this.backups.filePath(filename);
    if (!existsSync(path)) throw new NotFoundException('Không tìm thấy file');
    res.set({ 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${filename}"` });
    return new StreamableFile(createReadStream(path));
  }

  /** CẢNH BÁO: ghi đè toàn bộ dữ liệu hiện tại */
  @Post('backups/:filename/restore')
  @RequirePermissions(PERMISSIONS.SYSTEM_BACKUP)
  async restore(@CurrentUser() user: AuthUser, @Param('filename') filename: string) {
    // Tự sao lưu trạng thái hiện tại trước khi phục hồi
    const safety = await this.backups.create();
    const result = await this.backups.restore(filename);
    await this.audit.log({ userId: null, action: 'system.restore', entity: 'System', data: { filename, by: user.id, safetyBackup: safety.filename } });
    return { ...result, safetyBackup: safety.filename };
  }
}
