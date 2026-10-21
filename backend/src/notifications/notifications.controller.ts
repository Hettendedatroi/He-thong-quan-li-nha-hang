import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '../common/constants/permissions';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/types/auth-user';
import { AuditService } from '../core/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_TEMPLATES } from './default-templates';
import {
  ListNotificationsQueryDto,
  RegisterDeviceTokenDto,
  SendPromotionDto,
  UpsertTemplateDto,
} from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications - Khách hàng')
@ApiBearerAuth()
@Controller('me')
export class MyNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** FR-21..FR-24: danh sách thông báo của tôi */
  @Get('notifications')
  list(@CurrentUser() user: AuthUser, @Query() q: ListNotificationsQueryDto) {
    return this.notifications.listForUser(user.id, q.unreadOnly);
  }

  /** US-9 AC2: số thông báo chưa đọc (huy hiệu trên màn hình phục vụ) */
  @Get('notifications/unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user.id);
  }

  @Patch('notifications/:id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.notifications.markRead(user.id, id);
  }

  @Post('notifications/read-all')
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }

  /** Đăng ký token push (FCM / Web Push) của thiết bị */
  @Post('device-tokens')
  registerToken(@CurrentUser() user: AuthUser, @Body() dto: RegisterDeviceTokenDto) {
    return this.notifications.registerDeviceToken(user.id, dto.token, dto.platform);
  }

  @Delete('device-tokens/:token')
  removeToken(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    return this.notifications.removeDeviceToken(user.id, token);
  }
}

@ApiTags('Notifications - Quản lý')
@ApiBearerAuth()
@Controller()
export class NotificationsAdminController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** FR-24: gửi thông báo khuyến mãi tới khách đã đồng ý nhận */
  @Post('notifications/promotions')
  @RequirePermissions(PERMISSIONS.NOTIFICATION_SEND)
  async sendPromotion(@CurrentUser() user: AuthUser, @Body() dto: SendPromotionDto) {
    const result = await this.notifications.sendPromotion(dto.title, dto.body, {
      promotionCode: dto.promotionCode ?? null,
    });
    await this.audit.log({ userId: user.id, action: 'notification.promotion', entity: 'Notification', data: dto });
    return result;
  }

  /** FR-ADM-09: danh sách mẫu thông báo (kèm mẫu mặc định trong code) */
  @Get('admin/notification-templates')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  async listTemplates() {
    const custom = await this.prisma.notificationTemplate.findMany({ orderBy: [{ code: 'asc' }, { channel: 'asc' }] });
    return { custom, defaults: DEFAULT_TEMPLATES };
  }

  @Put('admin/notification-templates')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  async upsertTemplate(@CurrentUser() user: AuthUser, @Body() dto: UpsertTemplateDto) {
    const language = dto.language ?? 'vi';
    const tpl = await this.prisma.notificationTemplate.upsert({
      where: { code_channel_language: { code: dto.code, channel: dto.channel, language } },
      create: { ...dto, language },
      update: { title: dto.title, body: dto.body, isActive: dto.isActive ?? true },
    });
    await this.audit.log({ userId: user.id, action: 'notification_template.upsert', entity: 'NotificationTemplate', entityId: tpl.id, data: dto });
    return tpl;
  }

  @Delete('admin/notification-templates/:id')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  async deleteTemplate(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.prisma.notificationTemplate.delete({ where: { id } });
    await this.audit.log({ userId: user.id, action: 'notification_template.delete', entity: 'NotificationTemplate', entityId: id });
    return { ok: true };
  }
}
