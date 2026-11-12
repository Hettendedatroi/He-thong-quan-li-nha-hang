import { randomBytes, randomInt } from 'crypto';

// Bỏ các ký tự dễ nhầm (0/O, 1/I)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(length = 8): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Ví dụ: prefixedCode('RS') => "RS-7KQ2MZ" */
export function prefixedCode(prefix: string, length = 6): string {
  return `${prefix}-${randomCode(length)}`;
}

/** Token bí mật dạng URL-safe (dùng cho QR bàn, phiên bàn, refresh token) */
export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}
