import type { TokenPair } from '@berun/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { importPKCS8, SignJWT, type CryptoKey } from 'jose';
import { uuidv7 } from 'uuidv7';
import type { Db } from '../../db/client.js';
import { authSessions, devices, users } from '../../db/schema/index.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { toKstIso } from '../../lib/time.js';

/** access token 수명 (tech/06 2.1) */
export const ACCESS_TOKEN_TTL_SEC = 15 * 60;
export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** access token 발급 (JWT, ES256, claims: sub, sid, iat, exp) */
export function signAccessToken(
  privateKey: CryptoKey,
  claims: { userId: string; sessionId: string },
  options: { expiresIn?: string | number } = {},
): Promise<string> {
  return new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: 'ES256' })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? ACCESS_TOKEN_TTL)
    .sign(privateKey);
}

/** 요청 헤더에서 읽은 기기 정보 (X-Device-Id, X-Platform) */
export type DeviceInfo = { deviceId: string | null; platform: string | null };

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | Tx;

export type TokenIssuer = {
  /** 새 로그인 세션 (기기당 1개: 같은 기기의 이전 세션은 폐기) */
  createSession(db: DbOrTx, userId: string, device: DeviceInfo, now?: Date): Promise<TokenPair>;
  /** refresh token 회전 + 재사용 감지 (tech/06 2.1) */
  rotate(db: Db, refreshToken: string, now?: Date): Promise<TokenPair>;
  /** 현재 세션 폐기 + 그 기기의 푸시 토큰 해제 */
  revoke(db: Db, sessionId: string, userId: string, now?: Date): Promise<void>;
};

export async function createTokenIssuer(privateKeyPem: string | undefined): Promise<TokenIssuer> {
  const key = privateKeyPem ? await importPKCS8(privateKeyPem, 'ES256') : null;

  async function pair(userId: string, sessionId: string, refreshToken: string, now: Date) {
    if (!key) throw new AppError('INTERNAL', 'JWT_PRIVATE_KEY is not configured');
    const accessToken = await signAccessToken(key, { userId, sessionId });
    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt: toKstIso(new Date(now.getTime() + ACCESS_TOKEN_TTL_SEC * 1000)),
    };
  }

  async function insertSession(
    db: DbOrTx,
    v: { userId: string; deviceId: string | null; familyId: string },
    now: Date,
  ) {
    const refreshToken = randomToken();
    const [row] = await db
      .insert(authSessions)
      .values({
        userId: v.userId,
        deviceId: v.deviceId,
        familyId: v.familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
      })
      .returning({ id: authSessions.id });
    return { sessionId: row!.id, refreshToken };
  }

  return {
    async createSession(db, userId, device, now = new Date()) {
      if (!key) throw new AppError('INTERNAL', 'JWT_PRIVATE_KEY is not configured');
      if (device.deviceId) {
        // 기기 행: id = X-Device-Id. 다른 사용자가 쓰던 기기면 소유자를 바꾸고 푸시 토큰을 비운다
        const [existing] = await db.select().from(devices).where(eq(devices.id, device.deviceId));
        if (!existing) {
          await db.insert(devices).values({
            id: device.deviceId,
            userId,
            platform: device.platform ?? 'unknown',
            lastSeenAt: now,
          });
        } else {
          await db
            .update(devices)
            .set({
              userId,
              lastSeenAt: now,
              ...(device.platform && { platform: device.platform }),
              ...(existing.userId !== userId && { pushToken: null }),
            })
            .where(eq(devices.id, device.deviceId));
        }
        await db
          .update(authSessions)
          .set({ revokedAt: now })
          .where(and(eq(authSessions.deviceId, device.deviceId), isNull(authSessions.revokedAt)));
      }
      const { sessionId, refreshToken } = await insertSession(
        db,
        { userId, deviceId: device.deviceId, familyId: uuidv7() },
        now,
      );
      return pair(userId, sessionId, refreshToken, now);
    },

    async rotate(db, refreshToken, now = new Date()) {
      // 실패 사유를 정한 뒤 트랜잭션 밖에서 던진다 (가족 폐기는 커밋되어야 하므로)
      const outcome = await db.transaction(async (tx) => {
        const [session] = await tx
          .select()
          .from(authSessions)
          .where(eq(authSessions.tokenHash, sha256(refreshToken)))
          .for('update');
        if (!session || session.revokedAt || session.expiresAt <= now) {
          return { error: 'REFRESH_INVALID' as const };
        }
        if (session.rotatedAt) {
          // 이미 회전된 토큰이 다시 옴 = 탈취로 본다 → 같은 family 전체 폐기
          await tx
            .update(authSessions)
            .set({ revokedAt: now })
            .where(
              and(eq(authSessions.familyId, session.familyId), isNull(authSessions.revokedAt)),
            );
          return { error: 'REFRESH_REUSED' as const };
        }
        const [user] = await tx
          .select({ status: users.status })
          .from(users)
          .where(eq(users.id, session.userId));
        // 휴면 계정은 refresh로 이어 쓰지 않고 소셜 로그인(휴면 해제 안내 흐름)으로 보낸다 (PRD 4.1).
        // 휴면은 1년 미접속이라 refresh token(30일)이 살아 있는 경우는 사실상 없다 — 안전장치
        if (!user || user.status === 'suspended' || user.status === 'dormant') {
          await tx
            .update(authSessions)
            .set({ revokedAt: now })
            .where(eq(authSessions.familyId, session.familyId));
          return {
            error:
              user?.status === 'suspended'
                ? ('ACCOUNT_SUSPENDED' as const)
                : ('REFRESH_INVALID' as const),
          };
        }
        await tx
          .update(authSessions)
          .set({ rotatedAt: now })
          .where(eq(authSessions.id, session.id));
        // 앱을 열 때마다 refresh가 돌므로 이것을 "접속"으로 본다 → 휴면 판정·안내 초기화 (P-RET-03)
        await tx
          .update(users)
          .set({ lastLoginAt: now, dormancyNotifiedAt: null })
          .where(eq(users.id, session.userId));
        const next = await insertSession(
          tx,
          { userId: session.userId, deviceId: session.deviceId, familyId: session.familyId },
          now,
        );
        return { error: undefined, userId: session.userId, ...next };
      });
      if (outcome.error !== undefined) throw new AppError(outcome.error, 'refresh failed');
      return pair(outcome.userId, outcome.sessionId, outcome.refreshToken, now);
    },

    async revoke(db, sessionId, userId, now = new Date()) {
      const [session] = await db
        .update(authSessions)
        .set({ revokedAt: now })
        .where(and(eq(authSessions.id, sessionId), eq(authSessions.userId, userId)))
        .returning({ deviceId: authSessions.deviceId });
      if (session?.deviceId) {
        await db
          .update(devices)
          .set({ pushToken: null })
          .where(and(eq(devices.id, session.deviceId), eq(devices.userId, userId)));
      }
    },
  };
}
