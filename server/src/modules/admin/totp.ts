import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** TOTP (RFC 6238, SHA-1, 30초, 6자리) — 관리자 2단계 인증 (PRD 8.2) */
const STEP_SEC = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160비트 랜덤 비밀키 (base32) */
export const generateTotpSecret = () => base32Encode(randomBytes(20));

export function totpCode(secretBase32: string, at: Date): string {
  const counter = Math.floor(at.getTime() / 1000 / STEP_SEC);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const bin = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(bin).padStart(DIGITS, '0');
}

/** 앞뒤 한 칸(±30초)까지 허용 — 기기 시계 오차 */
export function verifyTotp(secretBase32: string, code: string, at: Date): boolean {
  const given = Buffer.from(code);
  for (const drift of [0, -1, 1]) {
    const expected = Buffer.from(
      totpCode(secretBase32, new Date(at.getTime() + drift * STEP_SEC * 1000)),
    );
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

/** 인증 앱 등록용 URI */
export function totpUri(email: string, secretBase32: string): string {
  const label = encodeURIComponent(`BeRun Admin:${email}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent('BeRun Admin')}&algorithm=SHA1&digits=6&period=30`;
}
