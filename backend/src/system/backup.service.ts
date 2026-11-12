import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Thứ tự bảng theo phụ thuộc khóa ngoại (bảng cha trước).
 * Khi thêm model mới vào schema.prisma nhớ thêm vào đây.
 */
const MODEL_ORDER = [
  'Role',
  'Branch',
  'User',
  'UserSession',
  'Zone',
  'DiningTable',
  'MenuCategory',
  'MenuItem',
  'Combo',
  'ComboItem',
  'PriceRule',
  'Holiday',
  'Promotion',
  'Reservation',
  'TableSession',
  'CartItem',
  'Order',
  'OrderItem',
  'ServiceRequest',
  'Bill',
  'BillLine',
  'Payment',
  'DishReview',
  'Feedback',
  'FeedbackResponse',
  'Notification',
  'NotificationTemplate',
  'DeviceToken',
  'LoyaltyTransaction',
  'Shift',
  'ShiftAssignment',
  'Attendance',
  'ShiftReport',
  'Incident',
  'Device',
  'AuditLog',
  'ErrorLog',
  'Setting',
  'ReportSchedule',
] as const;

/** Các cột Json có thể null (Prisma yêu cầu bỏ qua thay vì truyền null) */
const NULLABLE_JSON: Record<string, string[]> = {
  MenuCategory: ['translations'],
  MenuItem: ['translations'],
  Combo: ['translations'],
  Notification: ['data'],
  AuditLog: ['data'],
};

/** Bảng có quan hệ tự tham chiếu: chèn dòng "cha" trước */
const SELF_REF: Record<string, string> = { DiningTable: 'mergedIntoId', Bill: 'parentBillId' };

const delegateName = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

/**
 * FR-ADM-14: sao lưu & phục hồi dữ liệu dạng JSON qua Prisma (không cần cài pg_dump).
 * Production nên dùng thêm pg_dump / snapshot của nhà cung cấp DB.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly dir = join(process.cwd(), 'backups');

  constructor(private readonly prisma: PrismaService) {}

  async list() {
    await mkdir(this.dir, { recursive: true });
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.json'));
    const details = await Promise.all(
      files.map(async (f) => {
        const s = await stat(join(this.dir, f));
        return { filename: f, size: s.size, createdAt: s.mtime };
      }),
    );
    return details.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async create() {
    await mkdir(this.dir, { recursive: true });
    const data: Record<string, unknown[]> = {};
    const db = this.prisma as unknown as Record<string, { findMany: () => Promise<unknown[]> }>;
    for (const model of MODEL_ORDER) data[model] = await db[delegateName(model)].findMany();
    const filename = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    await writeFile(join(this.dir, filename), JSON.stringify({ version: 1, createdAt: new Date(), data }));
    const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
    this.logger.log(`Đã tạo bản sao lưu ${filename}`);
    return { filename, counts };
  }

  filePath(filename: string) {
    const safe = basename(filename);
    if (!safe.endsWith('.json')) throw new BadRequestException('Tên file không hợp lệ');
    return join(this.dir, safe);
  }

  /** Phục hồi: xóa toàn bộ dữ liệu hiện tại rồi nạp lại từ file (trong 1 transaction) */
  async restore(filename: string) {
    let parsed: { data: Record<string, Record<string, unknown>[]> };
    try {
      parsed = JSON.parse(await readFile(this.filePath(filename), 'utf8'));
    } catch {
      throw new NotFoundException('Không đọc được file sao lưu');
    }
    const tables = MODEL_ORDER.map((m) => `"${m}"`).join(', ');
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
        const db = tx as unknown as Record<string, { createMany: (args: { data: unknown[] }) => Promise<unknown> }>;
        for (const model of MODEL_ORDER) {
          let rows = parsed.data[model] ?? [];
          const jsonCols = NULLABLE_JSON[model] ?? [];
          rows = rows.map((r) => {
            const copy = { ...r };
            for (const c of jsonCols) if (copy[c] === null) delete copy[c];
            return copy;
          });
          const selfRef = SELF_REF[model];
          if (selfRef) rows.sort((a, b) => Number(a[selfRef] != null) - Number(b[selfRef] != null));
          for (let i = 0; i < rows.length; i += 500) {
            await db[delegateName(model)].createMany({ data: rows.slice(i, i + 500) });
          }
        }
        // Đồng bộ lại sequence của các cột id tự tăng (bỏ qua bảng id dạng chuỗi / không có cột id)
        const serialTables = await tx.$queryRaw<{ table_name: string }[]>`
          SELECT table_name FROM information_schema.columns
          WHERE table_schema = current_schema() AND column_name = 'id' AND data_type = 'integer'`;
        const serial = new Set(serialTables.map((t) => t.table_name));
        for (const model of MODEL_ORDER.filter((m) => serial.has(m))) {
          await tx.$executeRawUnsafe(
            `SELECT setval(pg_get_serial_sequence('"${model}"', 'id'), COALESCE((SELECT MAX(id) FROM "${model}"), 0) + 1, false)`,
          );
        }
      },
      { timeout: 300_000, maxWait: 10_000 },
    );
    this.logger.warn(`Đã phục hồi dữ liệu từ ${filename}`);
    return { ok: true, filename };
  }
}
