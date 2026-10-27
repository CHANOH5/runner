import { DecryptCommand, KMSClient } from '@aws-sdk/client-kms';
import { createTokenCipher, type TokenCipher } from './crypto.js';

/**
 * 저장 암호화 키 출처 (tech/03 4장, tech/07).
 * - env: TOKEN_ENC_KEY (base64 32바이트) — 로컬·테스트
 * - kms: KMS로 암호화된 데이터 키(TOKEN_ENC_KEY_KMS_CIPHERTEXT) — 운영. 시작할 때 KMS Decrypt를 한 번 불러
 *   평문 키를 메모리에만 두고, 이후 암호화·복호화는 로컬 AES-256-GCM이다 (봉투 암호화). 요청마다 KMS를 부르지 않는다.
 */
export type TokenKeySource =
  | { kind: 'env'; keyBase64: string }
  | { kind: 'kms'; ciphertextBase64: string; keyId: string | undefined };

/** KMS 데이터 키를 만들 때와 같은 암호화 컨텍스트. 다르면 Decrypt가 실패한다 */
export const TOKEN_KEY_ENCRYPTION_CONTEXT = { app: 'berun', purpose: 'token-enc' } as const;

/** KMS Decrypt만 추상화 — 테스트는 가짜를 넣는다 (실제 AWS 호출 없음) */
export type KmsDecrypt = (input: {
  ciphertext: Buffer;
  keyId: string | undefined;
  context: Record<string, string>;
}) => Promise<Buffer>;

export function awsKmsDecrypt(client = new KMSClient({})): KmsDecrypt {
  return async ({ ciphertext, keyId, context }) => {
    const res = await client.send(
      new DecryptCommand({
        CiphertextBlob: ciphertext,
        EncryptionContext: context,
        ...(keyId && { KeyId: keyId }),
      }),
    );
    if (!res.Plaintext) throw new Error('KMS Decrypt returned no plaintext');
    return Buffer.from(res.Plaintext);
  };
}

/** 키 출처 → 암호기. 출처가 없으면 null (관리자 로그인·Apple 토큰 저장이 500) */
export async function loadTokenCipher(
  source: TokenKeySource | null,
  kms: () => KmsDecrypt = () => awsKmsDecrypt(),
): Promise<TokenCipher | null> {
  if (!source) return null;
  if (source.kind === 'env') return createTokenCipher(source.keyBase64);
  const key = await kms()({
    ciphertext: Buffer.from(source.ciphertextBase64, 'base64'),
    keyId: source.keyId,
    context: { ...TOKEN_KEY_ENCRYPTION_CONTEXT },
  });
  if (key.length !== 32) {
    key.fill(0);
    throw new Error('KMS data key must be AES_256 (32 bytes)');
  }
  return createTokenCipher(key);
}
