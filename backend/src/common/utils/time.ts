import { BadRequestException } from '@nestjs/common';

export const APP_TIMEZONE = process.env.APP_TIMEZONE ?? 'Asia/Ho_Chi_Minh';
export const APP_UTC_OFFSET = process.env.APP_UTC_OFFSET ?? '+07:00';

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Tách ngày / giờ / thứ theo múi giờ nhà hàng (mặc định Asia/Ho_Chi_Minh). */
export function localParts(date: Date, timeZone = APP_TIMEZONE) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const hour = p.hour === '24' ? '00' : p.hour;
  return {
    ymd: `${p.year}-${p.month}-${p.day}`,
    hhmm: `${hour}:${p.minute}`,
    dayOfWeek: WEEKDAYS[p.weekday] ?? 0,
  };
}

/** Ví dụ: "19:30 20/10/2026" theo giờ nhà hàng */
export function formatLocalDateTime(date: Date): string {
  const { ymd, hhmm } = localParts(date);
  const [y, m, d] = ymd.split('-');
  return `${hhmm} ${d}/${m}/${y}`;
}

/** Kiểm tra "HH:mm" có nằm trong [start, end) không; hỗ trợ khung giờ qua đêm. */
export function isTimeInRange(hhmm: string, start?: string | null, end?: string | null): boolean {
  if (!start || !end) return true;
  if (start <= end) return hhmm >= start && hhmm < end;
  return hhmm >= start || hhmm < end;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Đầu ngày (00:00 giờ địa phương) của ngày chứa `date`, trả về dạng UTC Date. */
export function startOfLocalDay(date = new Date()): Date {
  return new Date(`${localParts(date).ymd}T00:00:00${APP_UTC_OFFSET}`);
}

function parseBoundary(value: string, endOfDay: boolean): Date {
  // "YYYY-MM-DD" => hiểu theo giờ địa phương; to = hết ngày đó
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(`${value}T00:00:00${APP_UTC_OFFSET}`);
    return endOfDay ? addDays(d, 1) : d;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`Ngày không hợp lệ: ${value}`);
  return d;
}

/** Khoảng thời gian [from, to) cho báo cáo; mặc định `defaultDays` ngày gần nhất. */
export function parseDateRange(from?: string, to?: string, defaultDays = 30): { from: Date; to: Date } {
  const end = to ? parseBoundary(to, true) : addDays(startOfLocalDay(), 1);
  const start = from ? parseBoundary(from, false) : addDays(end, -defaultDays);
  if (start >= end) throw new BadRequestException('Khoảng thời gian không hợp lệ (from phải trước to)');
  return { from: start, to: end };
}
