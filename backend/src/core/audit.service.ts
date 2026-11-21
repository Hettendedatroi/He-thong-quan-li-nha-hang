import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  userId?: number | null;
  action: string;
  entity: string;
  entityId?: string | number | null;
  data?: unknown;
  ip?: string | null;
}

/**
 * Ghi nhật ký thao tác quan trọng: đổi/hủy món, đổi giá, đổi quyền, hoàn tiền...
 * (FR-ADM-04, NFR-06). Lỗi ghi log không làm hỏng nghiệp vụ chính.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId != null ? String(entry.entityId) : null,
          data: entry.data === undefined ? undefined : (JSON.parse(JSON.stringify(entry.data)) as Prisma.InputJsonValue),
          ipAddress: entry.ip ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`Không ghi được audit log ${entry.action}: ${(err as Error).message}`);
    }
  }
}
