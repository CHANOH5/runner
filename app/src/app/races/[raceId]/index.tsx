import type { RaceDetail, RaceEvent } from '@berun/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { api } from '../../../api';
import { isApiError } from '../../../api/client';
import { saveErrorMessage } from '../../../api/messages';
import {
  EntryStatusSheet,
  invalidateRegistrationQueries,
} from '../../../components/EntryStatusSheet';
import { MapView } from '../../../components/map/MapView';
import { HeartButton } from '../../../components/RaceCard';
import {
  Badge,
  Button,
  Card,
  Divider,
  ErrorState,
  LinkText,
  Notice,
  RadioRow,
  Row,
  Screen,
  Section,
  Sheet,
  SkeletonCards,
  T,
} from '../../../components/ui';
import { useInterest } from '../../../components/useInterest';
import {
  ENTRY_STATUS_LABEL,
  ENTRY_STATUS_TONE,
  planBlockReason,
  raceBadges,
  showNotRegisteredHint,
} from '../../../features/race';
import {
  loadPromptRecord,
  savePromptDismissed,
  savePromptSettled,
  shouldAskReturnPrompt,
} from '../../../features/returnPrompt';
import { openInAppBrowser, useExternalLinkReturn } from '../../../lib/external';
import {
  daysUntil,
  formatCountdown,
  formatDate,
  formatDateTime,
  formatDDay,
  formatDotDate,
  formatDuration,
  formatHoursMinutes,
  formatKm,
  formatMonthDayTime,
  formatTime,
  formatWon,
  REGION_LABELS,
} from '../../../lib/format';
import { availableMapApps, MAP_APP_LABEL, openMapApp, type MapApp } from '../../../lib/mapLinks';
import { toast } from '../../../stores/toast';
import { useTheme } from '../../../theme';
import { goBack } from '../../../lib/nav';
import { analytics } from '../../../lib/analyticsClient';

const TBD = '미정 · 공식 홈페이지 확인';

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <Row style={{ alignItems: 'flex-start' }}>
      <T variant="caption" muted style={{ width: 56 }}>
        {label}
      </T>
      <T variant="caption" style={{ flex: 1 }}>
        {value}
      </T>
    </Row>
  );
}

function periodText(opensAt: string | null, closesAt: string | null, timeKnown = true) {
  if (!opensAt && !closesAt) return TBD;
  const open = opensAt
    ? timeKnown
      ? formatDateTime(opensAt)
      : `${formatDateTime(opensAt).slice(0, 16)} 오픈 · 시각 미정`
    : '미정';
  if (!timeKnown && opensAt && !closesAt) return open;
  return `${open} ~ ${closesAt ? formatDateTime(closesAt) : '미정'}`;
}

function EventRow({ ev, race }: { ev: RaceEvent; race: RaceDetail }) {
  const differs =
    (ev.registrationOpensAt || ev.registrationClosesAt) &&
    (ev.registrationOpensAt !== race.registrationOpensAt ||
      ev.registrationClosesAt !== race.registrationClosesAt);
  return (
    <View style={{ gap: 3, paddingVertical: 8 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="bodyStrong">{ev.name}</T>
        <T variant="caption" muted>
          {formatKm(ev.distanceM)}
        </T>
      </Row>
      <T variant="caption" muted>
        참가비 {ev.feeKrw !== null ? formatWon(ev.feeKrw) : TBD} · 출발{' '}
        {ev.startAt ? formatTime(ev.startAt) : TBD}
      </T>
      <T variant="caption" muted>
        제한 {ev.timeLimitMin !== null ? formatHoursMinutes(ev.timeLimitMin * 60) : TBD}
        {ev.capacity !== null ? ` · 정원 ${ev.capacity.toLocaleString('ko-KR')}명` : ''}
      </T>
      {differs ? (
        <T variant="caption" muted>
          접수 {periodText(ev.registrationOpensAt, ev.registrationClosesAt)}
        </T>
      ) : null}
    </View>
  );
}

/** 대회장 위치 (PRD 4.7 표): 좌표 있음 → 미니 지도(자리 표시) / 주소만 → 안내 박스 / 둘 다 없음 → 숨김 */
function VenueSection({ race, onDirections }: { race: RaceDetail; onDirections: () => void }) {
  const c = useTheme();
  const { venue } = race;
  const text = [venue.name, venue.address].filter(Boolean).join(' · ');
  const copy = async () => {
    await Clipboard.setStringAsync(venue.address ?? venue.name ?? '');
    toast('주소를 복사했어요');
  };
  if (venue.lat !== null && venue.lng !== null) {
    return (
      <View style={{ gap: 8 }}>
        <MapView lat={venue.lat} lng={venue.lng} label={venue.name} />
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="caption" style={{ flex: 1 }}>
            {text}
          </T>
          <Button
            small
            kind="secondary"
            label="길찾기"
            testID="directions"
            onPress={onDirections}
          />
        </Row>
      </View>
    );
  }
  if (!venue.name && !venue.address) return null;
  return (
    <View style={{ backgroundColor: c.surface, borderRadius: 12, padding: 14, gap: 8 }}>
      <T variant="caption" muted>
        📍 지도 위치가 아직 등록되지 않았어요
      </T>
      <T variant="caption">{text}</T>
      <Row>
        <Button small kind="secondary" label="주소 복사" onPress={() => void copy()} />
        <Button small kind="secondary" label="지도 앱에서 검색" onPress={onDirections} />
      </Row>
    </View>
  );
}

/** S-022 대회 상세 (PRD 4.7, 6.11) */
export default function RaceDetailScreen() {
  const { raceId } = useLocalSearchParams<{ raceId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const c = useTheme();
  const q = useQuery({ queryKey: ['race', raceId], queryFn: () => api.race(raceId) });
  const [statusSheet, setStatusSheet] = useState(false);
  const [returnPrompt, setReturnPrompt] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [mapApps, setMapApps] = useState<MapApp[] | null>(null);

  // race_viewed: 화면을 열 때 한 번 (PRD 2.3)
  const viewed = useRef(false);
  useEffect(() => {
    if (!q.data || viewed.current) return;
    viewed.current = true;
    analytics.track('race_viewed', {
      race_id: q.data.id,
      registration_status: q.data.my.registration?.entryStatus ?? 'none',
      source: 'race_detail',
    });
  }, [q.data]);

  // 공식 링크에서 돌아오면: 최신 상태로 다시 읽고 조건을 확인한다 (PRD 4.10.1)
  const onReturn = useCallback(
    async (stayMs: number) => {
      const now = Date.now();
      const fresh = await qc.fetchQuery({
        queryKey: ['race', raceId],
        queryFn: () => api.race(raceId),
        staleTime: 0,
      });
      const record = await loadPromptRecord(raceId);
      if (
        shouldAskReturnPrompt({
          openedAt: now - stayMs,
          returnedAt: now,
          registrationState: fresh.registrationState,
          entryStatus: fresh.my.registration?.entryStatus ?? null,
          record,
        })
      ) {
        setReturnPrompt(true);
        analytics.track('entry_prompt_shown', {
          race_id: raceId,
          has_registration: !!fresh.my.registration,
        });
      }
    },
    [qc, raceId],
  );
  const openTracked = useExternalLinkReturn((ms) => void onReturn(ms));

  if (q.isPending) {
    return (
      <Screen>
        <Stack.Screen options={{ title: '' }} />
        <SkeletonCards count={4} height={110} />
      </Screen>
    );
  }
  if (q.isError) {
    const gone = isApiError(q.error) && q.error.code === 'RACE_UNAVAILABLE';
    const notFound =
      isApiError(q.error) && (q.error.code === 'NOT_FOUND' || q.error.code === 'FORBIDDEN');
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        {gone || notFound ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <T muted>
              {gone ? '더 이상 볼 수 없는 대회예요' : '삭제되었거나 찾을 수 없는 대회예요'}
            </T>
            <Button small kind="secondary" label="뒤로" onPress={() => goBack()} />
          </View>
        ) : (
          <ErrorState
            message={
              isApiError(q.error) && q.error.code === 'NETWORK'
                ? '인터넷 연결을 확인해주세요'
                : '잠시 문제가 생겼어요'
            }
            onRetry={() => void q.refetch()}
          />
        )}
      </>
    );
  }

  const race = q.data;
  const reg = race.my.registration;
  const block = planBlockReason(race);
  const dDay = formatDDay(race.dDay);

  const answerPrompt = async (answer: 'registered' | 'not_yet' | 'dismissed') => {
    analytics.track('entry_prompt_answered', { race_id: raceId, answer });
    if (answer !== 'registered') {
      setReturnPrompt(false);
      await savePromptDismissed(raceId);
      return;
    }
    if (!reg) {
      setReturnPrompt(false);
      await savePromptSettled(raceId);
      router.push({
        pathname: '/races/[raceId]/register',
        params: { raceId, from: 'return_prompt' },
      });
      return;
    }
    setPromptSaving(true);
    try {
      await api.updateRegistration(reg.id, {
        entryStatus: 'registered',
        entryStatusSource: 'return_prompt',
      });
      await savePromptSettled(raceId);
      analytics.track('entry_status_changed', {
        race_id: raceId,
        from: reg.entryStatus,
        to: 'registered',
        source: 'return_prompt',
      });
      toast('접수 완료로 기록했어요');
      setReturnPrompt(false);
      invalidateRegistrationQueries(qc, raceId);
    } catch (e) {
      toast(saveErrorMessage(e));
    } finally {
      setPromptSaving(false);
    }
  };

  const openDirections = async () => setMapApps(await availableMapApps());

  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <Screen
        onRefresh={() => void q.refetch()}
        refreshing={q.isRefetching}
        footer={<BottomBar race={race} block={block} />}
      >
        {race.status === 'cancelled' ? <Notice>이 대회는 취소되었어요.</Notice> : null}
        {race.status === 'postponed' ? (
          <Notice tone="yellow">
            이 대회는 연기되었어요. 새 일정은 공식 홈페이지를 확인하세요.
          </Notice>
        ) : null}

        <View style={{ gap: 8 }}>
          <Row wrap gap={6}>
            {raceBadges(race).map((b) => (
              <Badge key={b.label} label={b.label} tone={b.tone} />
            ))}
            {dDay ? (
              <T variant="caption" color={c.primary} style={{ fontWeight: '700' }}>
                {dDay}
              </T>
            ) : null}
          </Row>
          <T variant="title" testID="race-name">
            {race.name}
          </T>
        </View>

        <Card tone="outline">
          <InfoRow
            label="대회일"
            value={`${formatDate(race.raceDate)}${race.earliestStartAt ? ` · ${formatTime(race.earliestStartAt)} 출발` : ''}`}
          />
          <InfoRow
            label="장소"
            value={
              race.venue.name || race.venue.address
                ? `${[race.venue.name, race.venue.address && `(${race.venue.address})`].filter(Boolean).join(' ')} · ${REGION_LABELS[race.regionCode]}`
                : TBD
            }
          />
          {race.organizer ? <InfoRow label="주최" value={race.organizer} /> : null}
        </Card>

        <VenueSection race={race} onDirections={() => void openDirections()} />

        <Section title="접수">
          {reg ? (
            <Card testID="my-registration">
              <T variant="caption" muted>
                내 참가 예정
              </T>
              <Row style={{ justifyContent: 'space-between' }}>
                <T variant="bodyStrong" style={{ flex: 1 }}>
                  {reg.eventName}
                  {reg.goalTimeSec !== null ? ` · 목표 ${formatDuration(reg.goalTimeSec)}` : ''}
                </T>
                <Badge
                  label={ENTRY_STATUS_LABEL[reg.entryStatus]}
                  tone={ENTRY_STATUS_TONE[reg.entryStatus]}
                />
                {race.dDay !== null ? (
                  <LinkText
                    testID="entry-change"
                    label="변경"
                    onPress={() => setStatusSheet(true)}
                  />
                ) : null}
              </Row>
              {showNotRegisteredHint(race, reg.entryStatus) ? (
                <T variant="caption" color={c.yellow}>
                  아직 접수 전이에요
                  {race.registrationClosesAt
                    ? ` · 마감 ${formatMonthDayTime(race.registrationClosesAt)}`
                    : ''}
                </T>
              ) : null}
            </Card>
          ) : null}
          <T variant="caption">
            {race.registrationMethod === 'first_come'
              ? '선착순 · '
              : race.registrationMethod === 'lottery'
                ? '추첨 · '
                : ''}
            {periodText(
              race.registrationOpensAt,
              race.registrationClosesAt,
              race.registrationOpensTimeKnown,
            )}
          </T>
          {race.registrationState === 'upcoming' &&
          race.registrationOpensAt &&
          daysUntil(race.registrationOpensAt) <= 7 ? (
            <T variant="caption" color={c.blue}>
              오픈까지 {formatCountdown(race.registrationOpensAt)}
            </T>
          ) : null}
        </Section>

        <Section title="종목">
          <Card tone="outline">
            {race.events.length === 0 ? (
              <T variant="caption" muted>
                {TBD}
              </T>
            ) : null}
            {race.events.map((ev, i) => (
              <View key={ev.id}>
                {i > 0 ? <Divider /> : null}
                <EventRow ev={ev} race={race} />
              </View>
            ))}
          </Card>
          {race.courseUrl ? (
            <Button
              small
              kind="secondary"
              label="코스 보기 (공식)"
              onPress={() => void openInAppBrowser(race.courseUrl!)}
            />
          ) : null}
        </Section>

        <Section title="링크">
          <Row>
            {race.officialUrl ? (
              <Button
                testID="official-link"
                kind="secondary"
                label="공식 홈페이지"
                style={{ flex: 1 }}
                onPress={() => {
                  analytics.track('external_link_opened', {
                    race_id: race.id,
                    link_type: 'official',
                    registration_state: race.registrationState,
                  });
                  void openTracked(race.officialUrl!);
                }}
              />
            ) : null}
            {race.registrationUrl ? (
              <Button
                testID="registration-link"
                kind={race.registrationState === 'open' ? 'primary' : 'secondary'}
                label="접수하러 가기"
                style={{ flex: 1 }}
                onPress={() => {
                  analytics.track('external_link_opened', {
                    race_id: race.id,
                    link_type: 'registration',
                    registration_state: race.registrationState,
                  });
                  void openTracked(race.registrationUrl!);
                }}
              />
            ) : null}
          </Row>
        </Section>

        <View style={{ gap: 4 }}>
          <T variant="caption" muted testID="race-source">
            출처: {race.source.name} · 최종 확인 {formatDotDate(race.lastVerifiedAt)}
          </T>
          <T variant="caption" muted>
            대회 정보는 변경될 수 있어요. 정확한 정보는 공식 홈페이지를 확인하세요.
          </T>
        </View>
        <LinkText
          label="정보가 틀렸나요? 제보하기"
          color={c.subtext}
          onPress={() => router.push({ pathname: '/races/[raceId]/report', params: { raceId } })}
        />
      </Screen>

      <EntryStatusSheet
        source="race_detail"
        target={
          statusSheet && reg
            ? {
                raceId,
                registrationId: reg.id,
                entryStatus: reg.entryStatus,
                lottery: race.registrationMethod === 'lottery',
              }
            : null
        }
        onClose={() => setStatusSheet(false)}
      />

      <Sheet
        visible={returnPrompt}
        onClose={() => void answerPrompt('dismissed')}
        title="접수 완료했나요?"
        testID="return-prompt"
      >
        <T>공식 홈페이지에서 접수를 마쳤다면 기록해두세요. 마감 알림을 보내지 않을게요.</T>
        <Button
          testID="return-prompt-done"
          label="접수 완료했어요"
          loading={promptSaving}
          onPress={() => void answerPrompt('registered')}
        />
        <Button kind="ghost" label="아직이에요" onPress={() => void answerPrompt('not_yet')} />
      </Sheet>

      <Sheet visible={mapApps !== null} onClose={() => setMapApps(null)} title="길찾기">
        {(mapApps ?? []).map((app) => (
          <RadioRow
            key={app}
            label={MAP_APP_LABEL[app]}
            selected={false}
            onPress={() => {
              setMapApps(null);
              analytics.track('directions_opened', {
                race_id: race.id,
                app: Platform.OS === 'web' ? 'web' : app,
              });
              void openMapApp(app, race.venue);
            }}
          />
        ))}
      </Sheet>
    </>
  );
}

/** 하단 고정 바: [♡ 관심] + [참가 예정 추가] / [참가 예정 · {종목}] (PRD 4.7) */
function BottomBar({ race, block }: { race: RaceDetail; block: 'cancelled' | 'ended' | null }) {
  const router = useRouter();
  const reg = race.my.registration;
  const { interested, toggle, elements } = useInterest(
    {
      id: race.id,
      my: { interested: race.my.interested, registered: !!reg },
    },
    { source: 'race_detail' },
  );
  const label = reg
    ? block === 'ended'
      ? '참가한 대회'
      : `참가 예정 · ${reg.eventName}`
    : block === 'ended'
      ? '종료된 대회'
      : '참가 예정 추가';
  return (
    <>
      <Row>
        <HeartButton on={interested} onPress={() => void toggle()} testID="detail-heart" />
        <View style={{ flex: 1, gap: 2 }}>
          <Button
            testID="plan-button"
            label={label}
            disabled={block !== null}
            kind={reg ? 'secondary' : 'primary'}
            onPress={() =>
              router.push({ pathname: '/races/[raceId]/register', params: { raceId: race.id } })
            }
          />
          {reg ? (
            <T variant="small" muted style={{ textAlign: 'center' }}>
              {ENTRY_STATUS_LABEL[reg.entryStatus]}
            </T>
          ) : null}
        </View>
      </Row>
      {elements}
    </>
  );
}
