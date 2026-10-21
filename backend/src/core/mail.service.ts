import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface MailInput {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: MailAttachment[];
}

/** Gửi email qua SMTP. Nếu chưa cấu hình SMTP_HOST thì chỉ ghi log (chế độ dev). */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly configured: boolean;
  private readonly from: string;

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    this.configured = !!host;
    this.from = config.get<string>('MAIL_FROM') ?? 'no-reply@restaurant.local';
    this.transporter = host
      ? nodemailer.createTransport({
          host,
          port: Number(config.get('SMTP_PORT') ?? 587),
          secure: config.get('SMTP_SECURE') === 'true',
          auth: config.get('SMTP_USER')
            ? { user: config.get<string>('SMTP_USER'), pass: config.get<string>('SMTP_PASS') }
            : undefined,
        })
      : nodemailer.createTransport({ jsonTransport: true });
  }

  async send(input: MailInput): Promise<boolean> {
    try {
      await this.transporter.sendMail({ from: this.from, ...input });
      if (!this.configured) {
        const to = Array.isArray(input.to) ? input.to.join(', ') : input.to;
        this.logger.log(`[DEV - chưa cấu hình SMTP] Email tới ${to}: ${input.subject}`);
      }
      return true;
    } catch (err) {
      this.logger.error(`Gửi email thất bại: ${(err as Error).message}`);
      return false;
    }
  }
}
