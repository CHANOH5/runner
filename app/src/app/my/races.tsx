import type { MyRaceItem } from '@berun/shared';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { api } from '../../api';
import { screenErrorMessage } from '../../api/messages';
import { EntryStatusSheet } from '../../components/EntryStatusSheet';
import { RaceCard } from '../../components/RaceCard';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LinkText,
  Row,
  Segmented,
  SkeletonCards,
  T,
} from '../../components/ui';
import { ENTRY_STATUS_LABEL, ENTRY_STATUS_TONE } from '../../features/race';
import { daysUntil, formatDuration } from '../../lib/format';
import { toast } from '../../stores/toast';
import { useTheme } from '../../theme';

type Tab = 'interested' | 'upcoming' | 'past';
/** [되돌리기] 토스트 표시 시간 (PRD v1.11 6.19) */
const UNDO_MS = 5000;
const EMPTY: Record<Tab, string> = {
  interested: '관심 대회가 없어요',
  upcoming: '참가 예정 대회가 없어요',
  past: '지난 대회가 없어요',
};

/** S-061 내 대회 (PRD 6.19) — 관심 / 참가 예정 / 지난 대회 */
export default function MyRaces() {
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const router = useRouter();
  const c = useTheme();
  const [tab, setTab] = useState<Tab>(params.tab ?? 'interested');
  const [sheet, setSheet] = useState<MyRaceItem | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['my-races', 'list', tab],
    queryFn: ({ pageParam }) => api.myRaces(tab, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const qc = useQueryClient();
  // 관심 탭에서 하트로 끈 대회는 바로 뺀다 (다시 읽기 전에도). [되돌리기]면 다시 넣는다 (PRD v1.11 6.19)
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const items = (q.data?.pages.flatMap((p) => p.items) ?? []).filter(
    (i) => tab !== 'interested' || !removed.has(i.id),
  );

  const onInterestOff = (item: MyRaceItem) => {
    if (tab !== 'interested') return;
    setRemoved((prev) => new Set(prev).add(item.id));
    toast('관심 대회에서 뺐어요', {
      duration: UNDO_MS,
      action: {
        label: '되돌리기',
        onPress: () => {
          api
            .interestOn(item.id)
            .then(() => {
              setRemoved((prev) => {
                const next = new Set(prev);
                next.delete(item.id);
                return next;
              });
              for (const key of [['my-races'], ['me'], ['home'], ['races'], ['race', item.id]]) {
                void qc.invalidateQueries({ queryKey: key });
              }
            })
            .catch(() => toast('저장하지 못했어요'));
        },
      },
    });
  };

  const open = (item: MyRaceItem) => {
    if (item.unavailable) return toast('더 이상 볼 수 없는 대회예요');
    router.push(`/races/${item.id}`);
  };

  const extra = (item: MyRaceItem) => {
    const reg = item.registration;
    if (tab === 'past') return reg ? <Badge label="참가" tone="primary" /> : null;
    if (tab !== 'upcoming' || !reg) return null;
    const closesIn = item.registrationClosesAt ? daysUntil(item.registrationClosesAt) : null;
    return (
      <View style={{ gap: 6 }}>
        <T variant="caption">
          {reg.eventName}
          {reg.goalTimeSec !== null ? ` · 목표 ${formatDuration(reg.goalTimeSec)}` : ''}
        </T>
        <Row>
          <Badge
            label={ENTRY_STATUS_LABEL[reg.entryStatus]}
            tone={ENTRY_STATUS_TONE[reg.entryStatus]}
            onPress={() => setSheet(item)}
            testID={`entry-badge-${item.id}`}
          />
          {reg.entryStatus === 'not_registered' &&
          closesIn !== null &&
          closesIn >= 0 &&
          closesIn <= 3 ? (
            <T variant="caption" color={c.red}>
              마감 D-{closesIn}
            </T>
          ) : null}
          <View style={{ flex: 1 }} />
          <LinkText
            label="수정"
            onPress={() =>
              router.push({ pathname: '/races/[raceId]/register', params: { raceId: item.id } })
            }
          />
        </Row>
      </View>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: '내 대회' }} />
      <View style={{ padding: 16, paddingBottom: 0, backgroundColor: c.bg }}>
        <Segmented<Tab>
          testID="my-races-tab"
          options={[
            { value: 'interested', label: '관심' },
            { value: 'upcoming', label: '참가 예정' },
            { value: 'past', label: '지난 대회' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>
      {q.isPending ? (
        <View style={{ padding: 16 }}>
          <SkeletonCards count={4} />
        </View>
      ) : q.isError ? (
        <ErrorState message={screenErrorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          style={{ backgroundColor: c.bg }}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={
            <RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />
          }
          onEndReached={() => q.hasNextPage && void q.fetchNextPage()}
          ListEmptyComponent={
            <EmptyState
              message={EMPTY[tab]}
              action={
                tab !== 'past' ? (
                  <Button small label="대회 찾아보기" onPress={() => router.navigate('/races')} />
                ) : undefined
              }
            />
          }
          renderItem={({ item }) => (
            <RaceCard
              race={item}
              muted={item.registration?.entryStatus === 'missed' || item.unavailable}
              onPress={() => open(item)}
              extra={extra(item)}
              onInterestOff={() => onInterestOff(item)}
            />
          )}
        />
      )}
      <EntryStatusSheet
        source="my_races"
        target={
          sheet?.registration
            ? {
                raceId: sheet.id,
                registrationId: sheet.registration.id,
                entryStatus: sheet.registration.entryStatus,
                lottery: sheet.registrationMethod === 'lottery',
              }
            : null
        }
        onClose={() => setSheet(null)}
      />
    </>
  );
}
