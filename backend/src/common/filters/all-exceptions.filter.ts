import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../types/auth-user';

/**
 * Chuẩn hóa response lỗi + ghi lỗi 5xx vào bảng ErrorLog (FR-ADM-13).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  constructor(private readonly prisma: PrismaService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') return;
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { user?: AuthUser }>();
    const res = ctx.getResponse<Response>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: unknown = 'Lỗi hệ thống, vui lòng thử lại sau';
    let extra: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else {
        const { message: m, statusCode: _s, error: _e, ...rest } = body as Record<string, unknown>;
        message = m ?? exception.message;
        extra = rest;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        const target = exception.meta?.target;
        message = `Dữ liệu bị trùng${target ? `: ${Array.isArray(target) ? target.join(', ') : String(target)}` : ''}`;
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        message = 'Không tìm thấy dữ liệu';
      } else if (exception.code === 'P2003') {
        status = HttpStatus.BAD_REQUEST;
        message = 'Dữ liệu liên kết không hợp lệ hoặc đang được sử dụng';
      }
    }

    if (status >= 500) {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(`${req.method} ${req.url} - ${err.message}`, err.stack);
      this.prisma.errorLog
        .create({
          data: {
            message: err.message.slice(0, 2000),
            stack: err.stack?.slice(0, 8000),
            method: req.method,
            path: req.originalUrl ?? req.url,
            statusCode: status,
            userId: req.user?.id ?? null,
          },
        })
        .catch(() => undefined);
    }

    res.status(status).json({
      statusCode: status,
      message,
      ...extra,
      path: req.originalUrl ?? req.url,
      timestamp: new Date().toISOString(),
    });
  }
}
