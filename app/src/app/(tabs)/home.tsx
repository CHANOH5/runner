import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../api';
import { RaceCard } from '../../components/RaceCard';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  LinkText,
  Row,
  Screen,
  Section,
  Skeleton,
  T,
} from '../../components/ui';
import { recommendedView } from '../../features/home';
import { ENTRY_STATUS_LABEL, ENTRY_STATUS_TONE, showNotRegisteredHint } from '../../features/race';
import {
  CATEGORY_LABELS,
  daysUntil,
  formatDate,
  formatDDay,
  formatDuration,
  formatMonthDay,
  formatPace,
  formatShortDateTime,
} from '../../lib/format';
import { useTheme } from '../../theme';

function SectionError({ onRetry }: { onRetry: () => void }) {
  return <ErrorState compact message="불러오지 못했어요" onRetry={onRetry} />;
}

function Bell() {
  const router = useRouter();
  const c = useTheme();
  const unread = useQuery({ queryKey: ['home', 'unread'], queryFn: api.unreadCount });
  const count = unread.data?.count ?? 0;
  return (
    <Pressable
      testID="home-bell"
      accessibilityRole="button"
      accessibilityLabel={`알림${count ? ` ${count}개` : ''}`}
      onPress={() => router.push('/notifications')}
      hitSlop={10}
    >
      <Text style={{ fontSize: 22, color: c.text }}>🔔</Text>
      {count > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: -4,
            right: -10,
            backgroundColor: c.red,
            borderRadius: 9,
            minWidth: 18,
            paddingHorizontal: 4,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
            {count > 99 ? '99+' : count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** ② 내 다음 대회 (PRD 6.7) */
function NextRace() {
  const router = useRouter();
  const c = useTheme();
  const q = useQuery({ queryKey: ['home', 'next-race'], queryFn: api.nextRace });
  if (q.isPending) return <Skeleton height={150} />;
  if (q.isError) return <SectionError onRetry={() => void q.refetch()} />;
  const { next, moreCount, hasAnyRecord } = q.data;
  return (
    <>
      {next ? (
        <Card testID="next-race">
          <Row style={{ justifyContent: 'space-between' }}>
            <T variant="caption" muted>
              내 다음 대회
            </T>
            <Badge
              label={ENTRY_STATUS_LABEL[next.registration.entryStatus]}
              tone={ENTRY_STATUS_TONE[next.registration.entryStatus]}
            />
          </Row>
          <Pressable onPress={() => router.push(`/races/${next.race.id}`)}>
            <T variant="h2" numberOfLines={2}>
              {next.race.name}
            </T>
          </Pressable>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <View style={{ gap: 2 }}>
              <T variant="caption" muted>
                {CATEGORY_LABELS[next.eventCategory]} · {next.registration.eventName}
              </T>
              <T variant="caption" muted>
                {formatDate(next.race.raceDate)}
              </T>
            </View>
            <T variant="display" color={c.primary}>
              {formatDDay(next.race.dDay) ?? ''}
            </T>
          </Row>
          {next.registration.goalTimeSec !== null ? (
            <T variant="bodyStrong">
              목표 {formatDuration(next.registration.goalTimeSec)}
              {next.registration.goalPaceSecPerKm !== null
                ? ` · ${formatPace(next.registration.goalPaceSecPerKm)}`
                : ''}
            </T>
          ) : (
            <LinkText
              label="목표 기록 정하기"
              onPress={() =>
                router.push({
                  pathname: '/races/[raceId]/register',
                  params: { raceId: next.race.id },
                })
              }
            />
          )}
          {showNotRegisteredHint(next.race, next.registration.entryStatus) ? (
            <LinkText
              color={c.yellow}
              label={`아직 접수 전이에요${
                next.race.registrationClosesAt
                  ? ` · 마감 ${formatMonthDay(next.race.registrationClosesAt)}`
                  : ''
              }`}
              onPress={() => router.push(`/races/${next.race.id}`)}
            />
          ) : null}
          <Button
            small
            kind="secondary"
            testID="next-race-strategy"
            label="페이스 전략 보기"
            onPress={() => router.push(`/registrations/${next.registration.id}/strategy`)}
          />
          {moreCount > 0 ? (
            <LinkText
              label={`외 ${moreCount}개 대회`}
              onPress={() => router.push({ pathname: '/my/races', params: { tab: 'upcoming' } })}
            />
          ) : null}
        </Card>
      ) : (
        <Card>
          <T muted>아직 참가 예정인 대회가 없어요</T>
          <Button small label="대회 찾아보기" onPress={() => router.push('/races')} />
        </Card>
      )}
      {!hasAnyRecord ? (
        <Card tone="outline" testID="record-prompt">
          <T>기록을 넣으면 예상 기록을 알려드려요</T>
          <Button
            small
            kind="secondary"
            label="기록 추가"
            onPress={() => router.push('/records/edit')}
          />
        </Card>
      ) : null}
    </>
  );
}

/** ③ 접수 임박 (PRD 6.7) — 비어 있으면 섹션 숨김 */
function Deadlines() {
  const router = useRouter();
  const c = useTheme();
  const q = useQuery({ queryKey: ['home', 'deadlines'], queryFn: api.deadlines });
  if (q.isPending) return <Skeleton height={80} />;
  if (q.isError) return <SectionError onRetry={() => void q.refetch()} />;
  if (q.data.items.length === 0) return null;
  return (
    <Section title="접수 임박">
      {q.data.items.map((item) => {
        const d = Math.max(0, daysUntil(item.at));
        const label =
          item.type === 'opens'
            ? `오픈 D-${d} · ${item.timeKnown ? formatShortDateTime(item.at) : formatShortDateTime(item.at).slice(0, 5)}`
            : `마감 D-${d}`;
        return (
          <Card
            key={`${item.race.id}-${item.type}`}
            onPress={() => router.push(`/races/${item.race.id}`)}
          >
            <Row style={{ justifyContent: 'space-between' }}>
              <T variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                {item.race.name}
              </T>
              <T variant="caption" color={item.type === 'closes' ? c.red : c.blue}>
                {label}
              </T>
            </Row>
          </Card>
        );
      })}
    </Section>
  );
}

/** ④ 추천 대회 (PRD 6.7) — 가로 스크롤, 비어 있으면 숨김 */
function Recommended() {
  const router = useRouter();
  const q = useQuery({ queryKey: ['home', 'recommended'], queryFn: api.recommended });
  if (q.isPending) return <Skeleton height={140} />;
  if (q.isError) return <SectionError onRetry={() => void q.refetch()} />;
  if (q.data.items.length === 0) return null;
  const view = recommendedView(q.data);
  return (
    <Section title={view.title}>
      {view.note ? (
        <T variant="caption" muted testID="recommended-note">
          {view.note}
        </T>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Row gap={10} style={{ alignItems: 'stretch' }}>
          {view.items.map((race) => (
            <View key={race.id} style={{ width: 260 }}>
              <RaceCard race={race} onPress={() => router.push(`/races/${race.id}`)} />
            </View>
          ))}
        </Row>
      </ScrollView>
    </Section>
  );
}

/** S-010 홈 (PRD 6.7) — 섹션별 독립 로딩 */
export default function Home() {
  const qc = useQueryClient();
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <Row style={{ justifyContent: 'space-between', paddingHorizontal: 16, height: 52 }}>
        <T variant="title" color={c.primary}>
          BeRun
        </T>
        <Bell />
      </Row>
      <Screen
        refreshing={false}
        onRefresh={() => void qc.invalidateQueries({ queryKey: ['home'] })}
      >
        <NextRace />
        <Deadlines />
        <Recommended />
      </Screen>
    </View>
  );
}
