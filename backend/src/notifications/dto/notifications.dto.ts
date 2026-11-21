import { NotificationChannel } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ToBoolean } from '../../common/decorators';

export class ListNotificationsQueryDto {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  unreadOnly?: boolean;
}

export class RegisterDeviceTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsIn(['WEB', 'ANDROID', 'IOS'])
  platform: string;
}

export class SendPromotionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  body: string;

  @IsOptional()
  @IsString()
  promotionCode?: string;
}

export class UpsertTemplateDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @IsOptional()
  @IsString()
  language?: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  body: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
