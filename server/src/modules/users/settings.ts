import type { PrivacySettings, ProfilePatch } from '@berun/shared';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import {
  devices,
  notificationSettings,
  privacySettings,
  termsVersions,
  userConsents,
  userProfiles,
  users,
} from '../../db/schema/index.js';
import { AppError, validationFailed } from '../../lib/errors.js';
import { kstDate, toKstIso, toKstIsoOrNull } from '../../lib/time.js';
import { isForbiddenNickname } from '../auth/forbidden-words.js';
import { nicknameTaken } from '../auth/service.js';
import { buildMe, NICKNAME_COOLDOWN_MS } from './me.js';
import { currentTerms, PHASE1_TERMS_KINDS } from './terms.js';

/**
 * PATCH /me/profile (tech/06 6.3, PRD 4.3): 닉네임 7일 1회·금칙어·대소문자 무시 중복, 지역·성별·러닝 시작 연도.
 * 출생연도는 스키마(strict)에서 거절된다.
 */
export async function updateProfile(db: Db, userId: string, req: ProfilePatch, now = new Date()) {
  const [row] = await db
    .select({ profile: userProfiles, birthYear: users.birthYear })
    .from(userProfiles)
    .innerJoin(users, eq(users.id, userProfiles.userId))
    .where(eq(userProfiles.userId, userId));
  if (!row) throw new AppError('NOT_FOUND', 'profile not found');

  if (req.runningSince != null) {
    const thisYear = Number(kstDate(now).slice(0, 4));
    if (req.runningSince < row.birthYear + 5 || req.runningSince > thisYear) {
      throw validationFailed([{ path: 'runningSince', code: 'out_of_range' }]);
    }
  }

  const nicknameChanged = req.nickname !== undefined && req.nickname !== row.profile.nickname;
  if (nicknameChanged) {
    const changed = row.profile.nicknameChangedAt;
    if (changed && changed.getTime() + NICKNAME_COOLDOWN_MS > now.getTime()) {
      throw new AppError('NICKNAME_CHANGE_COOLDOWN', 'nickname changed recently', {
        details: { availableAt: toKstIso(new Date(changed.getTime() + NICKNAME_COOLDOWN_MS)) },
      });
    }
    if (isForbiddenNickname(req.nickname!)) {
      throw new AppError('NICKNAME_FORBIDDEN', 'nickname contains a forbidden word');
    }
    if (await nicknameTaken(db, req.nickname!, userId)) {
      throw new AppError('NICKNAME_TAKEN', 'nickname is already taken');
    }
  }

  try {
    await db
      .update(userProfiles)
      .set({
        ...(nicknameChanged && { nickname: req.nickname, nicknameChangedAt: now }),
        ...(req.regionCode !== undefined && { regionCode: req.regionCode }),
        ...(req.gender !== undefined && { gender: req.gender }),
        ...(req.runningSince !== undefined && { runningSince: req.runningSince }),
      })
      .where(eq(userProfiles.userId, userId));
  } catch (err) {
    const e = (err as { cause?: { code?: string; constraint_name?: string } }).cause;
    if (e?.code === '23505' && e.constraint_name === 'user_profiles_nickname_lower_key') {
      throw new AppError('NICKNAME_TAKEN', 'nickname is already taken');
    }
    throw err;
  }
  return buildMe(db, userId, now);
}

// ---- 공개 범위 (P-PRI-03) ----

async function ensurePrivacy(db: Db, userId: string) {
  await db.insert(privacySettings).values({ userId }).onConflictDoNothing();
  const [row] = await db.select().from(privacySettings).where(eq(privacySettings.userId, userId));
  return row!;
}

const toPrivacy = (r: typeof privacySettings.$inferSelect): PrivacySettings => ({
  ageVisibility: r.ageVisibility as PrivacySettings['ageVisibility'],
  genderVisibility: r.genderVisibility as PrivacySettings['genderVisibility'],
  regionVisibility: r.regionVisibility as PrivacySettings['regionVisibility'],
  recordsVisibility: r.recordsVisibility as PrivacySettings['recordsVisibility'],
  listedInParticipants: r.listedInParticipants,
});

export async function getPrivacy(db: Db, userId: string) {
  return toPrivacy(await ensurePrivacy(db, userId));
}

export async function updatePrivacy(db: Db, userId: string, patch: Partial<PrivacySettings>) {
  await ensurePrivacy(db, userId);
  if (Object.keys(patch).length) {
    await db.update(privacySettings).set(patch).where(eq(privacySettings.userId, userId));
  }
  return getPrivacy(db, userId);
}

// ---- 알림 설정 (PRD 4.14) ----

async function lastMarketingConsent(db: Db, userId: string) {
  const [row] = await db
    .select({ action: userConsents.action, at: userConsents.createdAt })
    .from(userConsents)
    .innerJoin(termsVersions, eq(termsVersions.id, userConsents.termsVersionId))
    .where(and(eq(userConsents.userId, userId), eq(termsVersions.kind, 'marketing')))
    .orderBy(desc(userConsents.createdAt))
    .limit(1);
  return row ?? null;
}

async function ensureNotificationSettings(db: Db, userId: string) {
  await db.insert(notificationSettings).values({ userId }).onConflictDoNothing();
  const [row] = await db
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.userId, userId));
  return row!;
}

export async function getNotificationSettings(db: Db, userId: string) {
  const row = await ensureNotificationSettings(db, userId);
  const last = await lastMarketingConsent(db, userId);
  return {
    registrationAlerts: row.registrationAlerts,
    ddayAlerts: row.ddayAlerts,
    marketing: row.marketing,
    marketingChangedAt: toKstIsoOrNull(last?.at ?? null),
  };
}

/**
 * PATCH /me/notification-settings — 즉시 저장. 마케팅을 바꾸면 user_consents에 agree/withdraw 행을 추가한다
 * (동의 이력 append-only, PRD 4.14). 선택 동의(마케팅) 철회도 이 경로다.
 */
export async function updateNotificationSettings(
  db: Db,
  userId: string,
  patch: {
    registrationAlerts?: boolean | undefined;
    ddayAlerts?: boolean | undefined;
    marketing?: boolean | undefined;
  },
  now = new Date(),
) {
  const row = await ensureNotificationSettings(db, userId);
  const marketingChanged = patch.marketing !== undefined && patch.marketing !== row.marketing;
  const marketingTerms = marketingChanged
    ? (await currentTerms(db, now)).find((t) => t.kind === 'marketing')
    : undefined;
  if (marketingChanged && !marketingTerms) {
    throw new AppError('INTERNAL', 'marketing terms version is not configured');
  }
  await db.transaction(async (tx) => {
    await tx
      .update(notificationSettings)
      .set({
        ...(patch.registrationAlerts !== undefined && {
          registrationAlerts: patch.registrationAlerts,
        }),
        ...(patch.ddayAlerts !== undefined && { ddayAlerts: patch.ddayAlerts }),
        ...(patch.marketing !== undefined && { marketing: patch.marketing }),
      })
      .where(eq(notificationSettings.userId, userId));
    if (marketingChanged) {
      await tx.insert(userConsents).values({
        userId,
        termsVersionId: marketingTerms!.id,
        action: patch.marketing ? 'agree' : 'withdraw',
        createdAt: now,
      });
    }
  });
  return getNotificationSettings(db, userId);
}

// ---- 동의 상태 (S-065) ----

/** kind별 마지막 동의·철회 행 기준. 문서 링크는 현재 시행 버전 */
export async function getConsents(db: Db, userId: string, now = new Date()) {
  const current = await currentTerms(db, now);
  const rows = await db
    .select({
      kind: termsVersions.kind,
      action: userConsents.action,
      at: userConsents.createdAt,
      url: termsVersions.contentUrl,
    })
    .from(userConsents)
    .innerJoin(termsVersions, eq(termsVersions.id, userConsents.termsVersionId))
    .where(
      and(eq(userConsents.userId, userId), inArray(termsVersions.kind, [...PHASE1_TERMS_KINDS])),
    )
    .orderBy(desc(userConsents.createdAt));
  return PHASE1_TERMS_KINDS.flatMap((kind) => {
    const last = rows.find((r) => r.kind === kind);
    const url = current.find((t) => t.kind === kind)?.contentUrl ?? last?.url;
    if (!url) return [];
    const agreed = last?.action === 'agree';
    return [{ kind, agreed, agreedAt: agreed ? toKstIso(last.at) : null, contentUrl: url }];
  });
}

// ---- 기기 (tech/06 6.3) ----

/**
 * PUT /me/device — X-Device-Id = devices.id. 푸시 토큰·앱 버전·플랫폼 등록/갱신.
 * 같은 푸시 토큰이 다른 기기 행에 있으면 그쪽에서 지운다. 권한 거부면 pushToken null.
 * (pushPermission은 저장할 컬럼이 없어 받기만 한다 — 토큰 유무로 충분)
 */
export async function upsertDevice(
  db: Db,
  userId: string,
  deviceId: string,
  req: { pushToken: string | null; appVersion: string; platform: string },
  now = new Date(),
) {
  await db.transaction(async (tx) => {
    if (req.pushToken) {
      await tx
        .update(devices)
        .set({ pushToken: null })
        .where(and(eq(devices.pushToken, req.pushToken), ne(devices.id, deviceId)));
    }
    await tx
      .insert(devices)
      .values({
        id: deviceId,
        userId,
        platform: req.platform,
        pushToken: req.pushToken,
        appVersion: req.appVersion,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: devices.id,
        set: {
          userId,
          platform: req.platform,
          pushToken: req.pushToken,
          appVersion: req.appVersion,
          lastSeenAt: now,
        },
      });
  });
}

/**
 * DELETE /me/device — 이 기기의 푸시 토큰만 해제한다 (알림 끄기·기기 변경).
 * 기기 행을 지우면 그 기기의 로그인 세션도 함께 지워지므로(FK) 행은 남긴다.
 */
export async function clearDevicePush(db: Db, userId: string, deviceId: string) {
  await db
    .update(devices)
    .set({ pushToken: null })
    .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)));
}
