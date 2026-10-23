import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, totpCode, verifyTotp } from './totp.js';

// RFC 6238 부록 B 테스트 벡터 (SHA-1, 비밀키 "12345678901234567890")
const SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP (RFC 6238)', () => {
  it('RFC 테스트 벡터 (8자리 값의 끝 6자리)', () => {
    const cases: [number, string][] = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
    ];
    for (const [sec, code] of cases) expect(totpCode(SECRET, new Date(sec * 1000))).toBe(code);
  });

  it('±30초 허용, 그 밖은 거절', () => {
    const at = new Date(1234567890 * 1000);
    expect(verifyTotp(SECRET, '005924', at)).toBe(true);
    expect(verifyTotp(SECRET, '005924', new Date(at.getTime() + 30_000))).toBe(true);
    expect(verifyTotp(SECRET, '005924', new Date(at.getTime() + 90_000))).toBe(false);
    expect(verifyTotp(SECRET, '000000', at)).toBe(false);
  });

  it('base32 왕복', () => {
    const buf = Buffer.from([0, 1, 2, 250, 255, 7]);
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
  });
});
