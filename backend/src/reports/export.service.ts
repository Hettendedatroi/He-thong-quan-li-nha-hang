import { Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { existsSync } from 'fs';
import PDFDocument from 'pdfkit';
import { formatLocalDateTime, localParts } from '../common/utils/time';
import { PrismaService } from '../prisma/prisma.service';
import { ExportFormat, ReportType } from './dto/reports.dto';
import { ReportsService } from './reports.service';

interface Column {
  key: string;
  header: string;
  width: number;
}

interface Dataset {
  title: string;
  subtitle: string;
  columns: Column[];
  rows: Record<string, string | number | null>[];
}

export interface ExportFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

const FONT_CANDIDATES = [
  'C:\\Windows\\Fonts\\arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
];

const STATUS_VI: Record<string, string> = {
  PENDING: 'Chờ xác nhận',
  CONFIRMED: 'Đã xác nhận',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã hủy',
  CHECKED_IN: 'Đã đến',
  COMPLETED: 'Hoàn tất',
  NO_SHOW: 'Không đến',
  NEW: 'Mới',
  FLAGGED: 'Gắn cờ',
  RESOLVED: 'Đã xử lý',
};

/** FR-MGR-14, FR-MGR-15: xuất báo cáo Excel / PDF theo khoảng ngày & chi nhánh */
@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
  ) {}

  async build(type: ReportType, format: ExportFormat, from: Date, to: Date, branchId?: number): Promise<ExportFile> {
    const dataset = await this.dataset(type, from, to, branchId);
    const stamp = `${localParts(from).ymd}_${localParts(new Date(to.getTime() - 1)).ymd}`;
    const filename = `bao-cao-${type}_${stamp}${branchId ? `_cn${branchId}` : ''}.${format}`;
    if (format === 'xlsx') {
      return {
        buffer: await this.toExcel(dataset),
        filename,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }
    return { buffer: await this.toPdf(dataset), filename, contentType: 'application/pdf' };
  }

  private async dataset(type: ReportType, from: Date, to: Date, branchId?: number): Promise<Dataset> {
    const branch = branchId ? await this.prisma.branch.findUnique({ where: { id: branchId } }) : null;
    const subtitle = `Từ ${localParts(from).ymd} đến ${localParts(new Date(to.getTime() - 1)).ymd} - ${branch ? branch.name : 'Tất cả chi nhánh'}`;

    switch (type) {
      case 'revenue': {
        const r = await this.reports.revenue(from, to, branchId, 'day', false);
        return {
          title: 'BÁO CÁO DOANH THU',
          subtitle,
          columns: [
            { key: 'period', header: 'Ngày', width: 16 },
            { key: 'bills', header: 'Số hóa đơn', width: 14 },
            { key: 'revenue', header: 'Doanh thu (VND)', width: 20 },
          ],
          rows: [
            ...r.series.map((s) => ({ period: s.period, bills: s.bills, revenue: s.revenue })),
            { period: 'TỔNG', bills: r.summary.bills, revenue: r.summary.revenue },
          ],
        };
      }
      case 'dishes': {
        const d = await this.reports.dishes(from, to, branchId, 100);
        const reviewMap = new Map(d.mostReviewed.map((x) => [x.menuItemId, x]));
        const cancelMap = new Map(d.mostCancelled.map((x) => [x.menuItemId, x]));
        return {
          title: 'THỐNG KÊ MÓN ĂN',
          subtitle,
          columns: [
            { key: 'name', header: 'Món', width: 30 },
            { key: 'quantity', header: 'SL bán', width: 10 },
            { key: 'revenue', header: 'Doanh thu', width: 16 },
            { key: 'likes', header: 'Thích', width: 8 },
            { key: 'dislikes', header: 'Không thích', width: 12 },
            { key: 'avgRating', header: 'Điểm TB', width: 10 },
            { key: 'cancelled', header: 'SL hủy', width: 10 },
          ],
          rows: d.topOrdered.map((o) => ({
            name: o.name,
            quantity: o.quantity,
            revenue: o.revenue,
            likes: reviewMap.get(o.menuItemId)?.likes ?? 0,
            dislikes: reviewMap.get(o.menuItemId)?.dislikes ?? 0,
            avgRating: reviewMap.get(o.menuItemId)?.avgRating ?? null,
            cancelled: cancelMap.get(o.menuItemId)?.cancelledQuantity ?? 0,
          })),
        };
      }
      case 'reservations': {
        const list = await this.prisma.reservation.findMany({
          where: { startAt: { gte: from, lt: to }, ...(branchId ? { branchId } : {}) },
          include: { table: { select: { code: true } }, branch: { select: { name: true } } },
          orderBy: { startAt: 'asc' },
        });
        return {
          title: 'DANH SÁCH ĐẶT BÀN',
          subtitle,
          columns: [
            { key: 'code', header: 'Mã', width: 12 },
            { key: 'time', header: 'Thời gian', width: 18 },
            { key: 'name', header: 'Khách hàng', width: 22 },
            { key: 'phone', header: 'SĐT', width: 14 },
            { key: 'party', header: 'Số khách', width: 10 },
            { key: 'table', header: 'Bàn', width: 8 },
            { key: 'status', header: 'Trạng thái', width: 14 },
            { key: 'deposit', header: 'Cọc', width: 12 },
          ],
          rows: list.map((r) => ({
            code: r.code,
            time: formatLocalDateTime(r.startAt),
            name: r.customerName,
            phone: r.customerPhone,
            party: r.partySize,
            table: r.table?.code ?? '',
            status: STATUS_VI[r.status] ?? r.status,
            deposit: r.depositAmount || null,
          })),
        };
      }
      case 'feedback': {
        const list = await this.prisma.feedback.findMany({
          where: { createdAt: { gte: from, lt: to }, ...(branchId ? { branchId } : {}) },
          include: {
            bill: { select: { code: true } },
            customer: { select: { fullName: true } },
            staff: { select: { fullName: true } },
          },
          orderBy: { createdAt: 'desc' },
        });
        return {
          title: 'DANH SÁCH ĐÁNH GIÁ CỦA KHÁCH',
          subtitle,
          columns: [
            { key: 'time', header: 'Thời gian', width: 18 },
            { key: 'bill', header: 'Hóa đơn', width: 16 },
            { key: 'rating', header: 'Điểm', width: 7 },
            { key: 'food', header: 'Món', width: 7 },
            { key: 'service', header: 'Phục vụ', width: 9 },
            { key: 'customer', header: 'Khách', width: 18 },
            { key: 'staff', header: 'Nhân viên', width: 18 },
            { key: 'status', header: 'Trạng thái', width: 12 },
            { key: 'comment', header: 'Nhận xét', width: 45 },
          ],
          rows: list.map((f) => ({
            time: formatLocalDateTime(f.createdAt),
            bill: f.bill.code,
            rating: f.rating,
            food: f.foodRating,
            service: f.serviceRating,
            customer: f.isAnonymous ? 'Ẩn danh' : (f.customer?.fullName ?? 'Khách vãng lai'),
            staff: f.staff?.fullName ?? '',
            status: STATUS_VI[f.status] ?? f.status,
            comment: f.comment ?? '',
          })),
        };
      }
    }
  }

  private async toExcel(ds: Dataset): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Restaurant Management System';
    const ws = wb.addWorksheet('Báo cáo');
    ws.addRow([ds.title]).font = { bold: true, size: 14 };
    ws.addRow([ds.subtitle]).font = { italic: true };
    ws.addRow([]);
    const header = ws.addRow(ds.columns.map((c) => c.header));
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };
      cell.border = { bottom: { style: 'thin' } };
    });
    for (const row of ds.rows) ws.addRow(ds.columns.map((c) => row[c.key] ?? ''));
    ds.columns.forEach((c, i) => {
      ws.getColumn(i + 1).width = c.width;
    });
    const data = await wb.xlsx.writeBuffer();
    return Buffer.from(data as ArrayBuffer);
  }

  private toPdf(ds: Dataset): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const fontPath = [process.env.PDF_FONT_PATH, ...FONT_CANDIDATES].find((p) => p && existsSync(p));
      if (fontPath) doc.font(fontPath);
      else this.logger.warn('Không tìm thấy font Unicode, PDF có thể lỗi dấu tiếng Việt. Đặt PDF_FONT_PATH trong .env');

      doc.fontSize(16).text(ds.title, { align: 'center' });
      doc.fontSize(10).text(ds.subtitle, { align: 'center' });
      doc.moveDown();

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const totalWidth = ds.columns.reduce((s, c) => s + c.width, 0);
      const widths = ds.columns.map((c) => (c.width / totalWidth) * pageWidth);
      const left = doc.page.margins.left;

      const drawRow = (values: string[], bold = false) => {
        const heights = values.map((v, i) => doc.heightOfString(v, { width: widths[i] - 4 }));
        const h = Math.max(...heights, 12) + 4;
        if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
        const y = doc.y;
        let x = left;
        doc.fontSize(9);
        values.forEach((v, i) => {
          doc.text(v, x + 2, y + 2, { width: widths[i] - 4 });
          x += widths[i];
        });
        doc
          .moveTo(left, y + h)
          .lineTo(left + pageWidth, y + h)
          .lineWidth(bold ? 1 : 0.3)
          .stroke();
        doc.x = left;
        doc.y = y + h;
      };

      drawRow(ds.columns.map((c) => c.header), true);
      for (const row of ds.rows) {
        drawRow(
          ds.columns.map((c) => {
            const v = row[c.key];
            return typeof v === 'number' ? v.toLocaleString('vi-VN') : (v ?? '');
          }),
        );
      }
      doc.moveDown().fontSize(8).text(`Xuất lúc ${formatLocalDateTime(new Date())}`, left, doc.y, { align: 'right' });
      doc.end();
    });
  }
}
