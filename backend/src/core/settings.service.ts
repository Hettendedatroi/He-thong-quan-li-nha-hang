import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface RestaurantInfo {
  name: string;
  hotline: string;
  email: string;
  logoUrl: string;
  description: string;
}

/** FR-ADM-07: chính sách đặt bàn */
export interface ReservationPolicy {
  slotMinutes: number;
  defaultDurationMinutes: number;
  /** Giữ bàn tối đa bao lâu sau giờ hẹn trước khi tính no-show */
  maxHoldMinutes: number;
  minAdvanceMinutes: number;
  maxAdvanceDays: number;
  /** Hủy / sửa miễn phí nếu trước giờ hẹn ít nhất N giờ */
  freeCancelHours: number;
  requireManualApproval: boolean;
  manualApprovalPartySize: number;
  depositRequired: boolean;
  depositPartySize: number;
  depositAmount: number;
  reminderMinutesBefore: number;
  /** Hiển thị bàn là "Đã đặt" trên sơ đồ trước giờ hẹn N phút */
  reservedLeadMinutes: number;
}

export interface OrderingSettings {
  /** true: đơn khách gọi qua QR phải được phục vụ xác nhận rồi mới gửi bếp */
  requireStaffConfirmation: boolean;
  /** Khách được tự hủy món khi bếp chưa nhận */
  allowCustomerCancelPending: boolean;
}

export interface BillingSettings {
  vatPercent: number;
  serviceChargePercent: number;
}

/** FR-ADM-08 */
export type PaymentMethodSettings = Record<'CASH' | 'BANK_TRANSFER' | 'E_WALLET' | 'POS_CARD' | 'ONLINE', boolean>;

/** FR-27 */
export interface LoyaltySettings {
  enabled: boolean;
  /** Bao nhiêu VND thì được 1 điểm */
  amountPerPoint: number;
  /** 1 điểm quy đổi được bao nhiêu VND */
  pointValue: number;
  /** Tối đa % giá trị hóa đơn được trừ bằng điểm */
  maxRedeemPercent: number;
}

/** FR-ADM-10 */
export interface I18nSettings {
  defaultLanguage: string;
  supportedLanguages: string[];
}

export interface SettingsMap {
  restaurant: RestaurantInfo;
  reservationPolicy: ReservationPolicy;
  ordering: OrderingSettings;
  billing: BillingSettings;
  paymentMethods: PaymentMethodSettings;
  loyalty: LoyaltySettings;
  i18n: I18nSettings;
}

export type SettingKey = keyof SettingsMap;

export const DEFAULT_SETTINGS: SettingsMap = {
  restaurant: {
    name: 'Nhà hàng Group 4',
    hotline: '1900 0000',
    email: 'contact@restaurant.local',
    logoUrl: '',
    description: '',
  },
  reservationPolicy: {
    slotMinutes: 30,
    defaultDurationMinutes: 120,
    maxHoldMinutes: 15,
    minAdvanceMinutes: 30,
    maxAdvanceDays: 30,
    freeCancelHours: 2,
    requireManualApproval: false,
    manualApprovalPartySize: 10,
    depositRequired: false,
    depositPartySize: 6,
    depositAmount: 200000,
    reminderMinutesBefore: 60,
    reservedLeadMinutes: 60,
  },
  ordering: { requireStaffConfirmation: false, allowCustomerCancelPending: true },
  billing: { vatPercent: 8, serviceChargePercent: 0 },
  paymentMethods: { CASH: true, BANK_TRANSFER: true, E_WALLET: true, POS_CARD: true, ONLINE: true },
  loyalty: { enabled: true, amountPerPoint: 10000, pointValue: 1000, maxRedeemPercent: 50 },
  i18n: { defaultLanguage: 'vi', supportedLanguages: ['vi', 'en'] },
};

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingKey[];

/** Đọc / ghi cấu hình hệ thống (bảng Setting), có cache ngắn hạn. */
@Injectable()
export class SettingsService {
  private cache = new Map<string, { value: unknown; at: number }>();
  private readonly ttlMs = 30_000;

  constructor(private readonly prisma: PrismaService) {}

  async get<K extends SettingKey>(key: K): Promise<SettingsMap[K]> {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.ttlMs) return cached.value as SettingsMap[K];
    const row = await this.prisma.setting.findUnique({ where: { key } });
    const value = { ...DEFAULT_SETTINGS[key], ...((row?.value as object | null) ?? {}) } as SettingsMap[K];
    this.cache.set(key, { value, at: Date.now() });
    return value;
  }

  async getAll(): Promise<SettingsMap> {
    const entries = await Promise.all(SETTING_KEYS.map(async (k) => [k, await this.get(k)] as const));
    return Object.fromEntries(entries) as unknown as SettingsMap;
  }

  async set<K extends SettingKey>(key: K, patch: Partial<SettingsMap[K]>): Promise<SettingsMap[K]> {
    if (!SETTING_KEYS.includes(key)) throw new BadRequestException(`Không có cấu hình "${key}"`);
    const allowed = Object.keys(DEFAULT_SETTINGS[key]);
    const unknown = Object.keys(patch).filter((k) => !allowed.includes(k));
    if (unknown.length) throw new BadRequestException(`Trường không hợp lệ cho "${key}": ${unknown.join(', ')}`);

    const current = await this.get(key);
    const merged = { ...current, ...patch } as SettingsMap[K];
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: merged as unknown as Prisma.InputJsonValue },
      update: { value: merged as unknown as Prisma.InputJsonValue },
    });
    this.cache.delete(key);
    return merged;
  }
}
