import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ConfigError, loadConfig } from '../config/env.js';
import { createTokenCipher } from './crypto.js';
import { loadTokenCipher, TOKEN_KEY_ENCRYPTION_CONTEXT, type KmsDecrypt } from './token-key.js';

const BASE = {
  DATABASE_URL: 'postgres://berun:berun@localhost:55432/berun',
  REDIS_URL: 'redis://localhost:56379',
};
const envKey = randomBytes(32).toString('base64');
const kmsBlob = Buffer.from('fake-kms-ciphertext-blob').toString('base64');

describe('저장 암호화 키 설정 (T-029)', () => {
  it('로컬·테스트: TOKEN_ENC_KEY → env, 없으면 null', () => {
    expect(loadConfig({ ...BASE, TOKEN_ENC_KEY: envKey }).tokenKey).toEqual({
      kind: 'env',
      keyBase64: envKey,
    });
    expect(loadConfig(BASE).tokenKey).toBeNull();
  });

  it('KMS 암호문이 있으면 kms (키 id는 선택)', () => {
    expect(
      loadConfig({
        ...BASE,
        TOKEN_ENC_KEY_KMS_CIPHERTEXT: kmsBlob,
        TOKEN_ENC_KMS_KEY_ID: 'alias/x',
      }).tokenKey,
    ).toEqual({ kind: 'kms', ciphertextBase64: kmsBlob, keyId: 'alias/x' });
  });

  it('운영: 평문 키 거부, KMS 암호문 필수. 둘 다 있으면 어디서나 거부', () => {
    const prod = { ...BASE, NODE_ENV: 'production' };
    expect(() => loadConfig({ ...prod, TOKEN_ENC_KEY: envKey })).toThrow(ConfigError);
    expect(() => loadConfig(prod)).toThrow(/TOKEN_ENC_KEY_KMS_CIPHERTEXT/);
    expect(loadConfig({ ...prod, TOKEN_ENC_KEY_KMS_CIPHERTEXT: kmsBlob }).tokenKey?.kind).toBe(
      'kms',
    );
    expect(() =>
      loadConfig({ ...BASE, TOKEN_ENC_KEY: envKey, TOKEN_ENC_KEY_KMS_CIPHERTEXT: kmsBlob }),
    ).toThrow(ConfigError);
  });

  it('에러 메시지에 키 값을 넣지 않는다', () => {
    try {
      loadConfig({ ...BASE, NODE_ENV: 'production', TOKEN_ENC_KEY: envKey });
    } catch (err) {
      expect(String(err)).not.toContain(envKey);
    }
  });
});

describe('loadTokenCipher', () => {
  it('env: 기존 방식 그대로 (같은 키로 만든 암호기와 호환)', async () => {
    const cipher = await loadTokenCipher({ kind: 'env', keyBase64: envKey });
    const sealed = createTokenCipher(envKey).encrypt('apple-refresh-token');
    expect(cipher!.decrypt(sealed)).toBe('apple-refresh-token');
  });

  it('kms: 시작할 때 Decrypt 한 번(암호문·키 id·암호화 컨텍스트 전달), 이후는 로컬 AES-GCM', async () => {
    const dataKey = randomBytes(32);
    const decrypt = vi.fn<KmsDecrypt>(() => Promise.resolve(Buffer.from(dataKey)));
    const cipher = await loadTokenCipher(
      { kind: 'kms', ciphertextBase64: kmsBlob, keyId: 'alias/berun-prod-token' },
      () => decrypt,
    );
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(decrypt).toHaveBeenCalledWith({
      ciphertext: Buffer.from(kmsBlob, 'base64'),
      keyId: 'alias/berun-prod-token',
      context: { ...TOKEN_KEY_ENCRYPTION_CONTEXT },
    });
    // 같은 데이터 키면 env 방식과 같은 형식이다 (키 교체 시 재암호화 없이 옮길 수 있다)
    const sealed = cipher!.encrypt('totp-secret');
    expect(createTokenCipher(dataKey).decrypt(sealed)).toBe('totp-secret');
    cipher!.decrypt(sealed);
    expect(decrypt).toHaveBeenCalledTimes(1);
  });

  it('kms: 32바이트가 아닌 키·KMS 실패는 시작 실패', async () => {
    await expect(
      loadTokenCipher(
        { kind: 'kms', ciphertextBase64: kmsBlob, keyId: undefined },
        () => () => Promise.resolve(randomBytes(16)),
      ),
    ).rejects.toThrow(/32 bytes/);
    await expect(
      loadTokenCipher(
        { kind: 'kms', ciphertextBase64: kmsBlob, keyId: undefined },
        () => () => Promise.reject(new Error('AccessDeniedException')),
      ),
    ).rejects.toThrow('AccessDeniedException');
  });

  it('출처가 없으면 null', async () => {
    expect(await loadTokenCipher(null)).toBeNull();
  });
});

describe('DB 주소 조립 (ECS: RDS 비밀 필드 → DATABASE_URL)', () => {
  const { REDIS_URL } = BASE;
  it('DB_*로 sslmode=require URL을 만들고, 비밀번호의 특수문자를 인코딩한다', () => {
    const url = new URL(
      loadConfig({
        REDIS_URL,
        DB_HOST: 'db.example.internal',
        DB_PORT: '5432',
        DB_NAME: 'berun',
        DB_USER: 'berun',
        DB_PASSWORD: 'p@ss/w:rd#1',
      }).databaseUrl,
    );
    expect(url.hostname).toBe('db.example.internal');
    expect(decodeURIComponent(url.password)).toBe('p@ss/w:rd#1');
    expect(url.searchParams.get('sslmode')).toBe('require');
  });

  it('DATABASE_URL이 있으면 그대로, DB_*가 모자라면 검증 실패', () => {
    expect(loadConfig(BASE).databaseUrl).toBe(BASE.DATABASE_URL);
    expect(() => loadConfig({ REDIS_URL, DB_HOST: 'h', DB_NAME: 'n' })).toThrow(ConfigError);
  });
});
