import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as QRCode from 'qrcode';
import { randomToken } from '../common/utils/codes';
import { AuditService } from '../core/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateBranchDto,
  CreateTableDto,
  CreateZoneDto,
  UpdateBranchDto,
  UpdateTableDto,
  UpdateZoneDto,
} from './dto/branches.dto';

/** FR-ADM-05 (chi nhánh), FR-ADM-06 (sơ đồ bàn: khu vực, bàn, sức chứa) */
@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  // ------------------------------------------------------------ Chi nhánh
  async listBranches(activeOnly = false) {
    const branches = await this.prisma.branch.findMany({
      where: activeOnly ? { isActive: true } : {},
      orderBy: { id: 'asc' },
      include: { _count: { select: { tables: { where: { isActive: true } }, zones: true } } },
    });
    return branches.map(({ _count, ...b }) => ({ ...b, tableCount: _count.tables, zoneCount: _count.zones }));
  }

  async getBranch(id: number) {
    const branch = await this.prisma.branch.findUnique({
      where: { id },
      include: { zones: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
    });
    if (!branch) throw new NotFoundException('Không tìm thấy chi nhánh');
    return branch;
  }

  async createBranch(actorId: number, dto: CreateBranchDto) {
    const branch = await this.prisma.branch.create({ data: dto });
    await this.audit.log({ userId: actorId, action: 'branch.create', entity: 'Branch', entityId: branch.id, data: dto });
    return branch;
  }

  async updateBranch(actorId: number, id: number, dto: UpdateBranchDto) {
    const branch = await this.prisma.branch.update({ where: { id }, data: dto });
    await this.audit.log({ userId: actorId, action: 'branch.update', entity: 'Branch', entityId: id, data: dto });
    return branch;
  }

  // ------------------------------------------------------------ Khu vực
  listZones(branchId?: number) {
    return this.prisma.zone.findMany({
      where: branchId ? { branchId } : {},
      orderBy: [{ branchId: 'asc' }, { sortOrder: 'asc' }],
      include: { _count: { select: { tables: true } } },
    });
  }

  async createZone(actorId: number, dto: CreateZoneDto) {
    const zone = await this.prisma.zone.create({ data: dto });
    await this.audit.log({ userId: actorId, action: 'zone.create', entity: 'Zone', entityId: zone.id, data: dto });
    return zone;
  }

  async updateZone(actorId: number, id: number, dto: UpdateZoneDto) {
    const zone = await this.prisma.zone.update({ where: { id }, data: dto });
    await this.audit.log({ userId: actorId, action: 'zone.update', entity: 'Zone', entityId: id, data: dto });
    return zone;
  }

  async deleteZone(actorId: number, id: number) {
    const count = await this.prisma.diningTable.count({ where: { zoneId: id } });
    if (count) throw new BadRequestException('Khu vực còn bàn, hãy chuyển / xóa bàn trước');
    await this.prisma.zone.delete({ where: { id } });
    await this.audit.log({ userId: actorId, action: 'zone.delete', entity: 'Zone', entityId: id });
    return { ok: true };
  }

  // ------------------------------------------------------------ Bàn
  listTables(branchId?: number) {
    return this.prisma.diningTable.findMany({
      where: branchId ? { branchId } : {},
      include: { zone: true },
      orderBy: [{ branchId: 'asc' }, { code: 'asc' }],
    });
  }

  async createTable(actorId: number, dto: CreateTableDto) {
    const zone = await this.prisma.zone.findUnique({ where: { id: dto.zoneId } });
    if (!zone) throw new NotFoundException('Không tìm thấy khu vực');
    const table = await this.prisma.diningTable.create({
      data: { ...dto, branchId: zone.branchId, qrToken: randomToken(18) },
    });
    await this.audit.log({ userId: actorId, action: 'table.create', entity: 'DiningTable', entityId: table.id, data: dto });
    return table;
  }

  async updateTable(actorId: number, id: number, dto: UpdateTableDto) {
    let branchId: number | undefined;
    if (dto.zoneId) {
      const zone = await this.prisma.zone.findUniqueOrThrow({ where: { id: dto.zoneId } });
      branchId = zone.branchId;
    }
    const table = await this.prisma.diningTable.update({ where: { id }, data: { ...dto, branchId } });
    await this.audit.log({ userId: actorId, action: 'table.update', entity: 'DiningTable', entityId: id, data: dto });
    return table;
  }

  /** Xóa mềm nếu bàn đã có lịch sử (để giữ dữ liệu báo cáo) */
  async deleteTable(actorId: number, id: number) {
    // US-17 AC4: bàn có đơn chưa thanh toán thì không được xóa
    const unpaid = await this.prisma.tableSession.count({
      where: { tableId: id, status: 'OPEN', orders: { some: { status: { not: 'CANCELLED' } } } },
    });
    if (unpaid) throw new ConflictException('Bàn đang có đơn chưa thanh toán, không thể xóa');
    // Phiên mở do khách quét QR nhưng chưa gọi món -> đóng lại
    await this.prisma.tableSession.updateMany({
      where: { tableId: id, status: 'OPEN' },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    const used = await this.prisma.tableSession.count({ where: { tableId: id } });
    if (used) {
      await this.prisma.diningTable.update({ where: { id }, data: { isActive: false } });
    } else {
      await this.prisma.reservation.updateMany({ where: { tableId: id }, data: { tableId: null } });
      await this.prisma.diningTable.delete({ where: { id } });
    }
    await this.audit.log({ userId: actorId, action: 'table.delete', entity: 'DiningTable', entityId: id });
    return { ok: true, softDeleted: used > 0 };
  }

  /** Sinh lại mã QR (khi QR cũ bị lộ / hỏng) */
  async regenerateQr(actorId: number, id: number) {
    const table = await this.prisma.diningTable.update({ where: { id }, data: { qrToken: randomToken(18) } });
    await this.audit.log({ userId: actorId, action: 'table.regenerate_qr', entity: 'DiningTable', entityId: id });
    return this.tableQr(table.id);
  }

  /** FR-07: ảnh QR (data URL) để in dán lên bàn - trỏ tới web khách hàng */
  async tableQr(id: number) {
    const table = await this.prisma.diningTable.findUnique({ where: { id } });
    if (!table) throw new NotFoundException('Không tìm thấy bàn');
    const webUrl = this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:5173';
    const url = `${webUrl.replace(/\/$/, '')}/t/${table.qrToken}`;
    return { tableId: table.id, code: table.code, url, qrToken: table.qrToken, qrDataUrl: await QRCode.toDataURL(url, { width: 400 }) };
  }
}
