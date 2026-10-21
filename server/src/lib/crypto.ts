import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** 저장용 대칭 암호화 (AES-256-GCM). 형식: iv(12) | tag(16) | ciphertext. 운영은 KMS 데이터 키로 바꾼다. */
export type TokenCipher = {
  encrypt: (plain: string) => Buffer;
  decrypt: (data: Buffer) => string;
};

export function createTokenCipher(keyBase64: string): TokenCipher {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('TOKEN_ENC_KEY must be 32 bytes');
  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decrypt(data) {
      const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

/** 32바이트 랜덤 토큰 (base64url) — refresh·signup token */
export const randomToken = () => randomBytes(32).toString('base64url');

export const sha256 = (value: string) => createHash('sha256').update(value).digest();
