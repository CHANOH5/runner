import type { RaceSummary } from '@berun/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { api } from '../../api';
import { screenErrorMessage } from '../../api/messages';
import { RaceCard } from '../../components/RaceCard';
import {
  Badge,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Row,
  Segmented,
  SkeletonCards,
  T,
} from '../../components/ui';
import { withMonthHeaders } from '../../features/raceList';
import { filterChips, filtersToQuery, useRaceFilters } from '../../features/raceFilters';
import { addDaysKst, formatDate, formatMonthHeader, todayKst } from '../../lib/format';
import { useTheme } from '../../theme';

function SearchBar() {
  const router = useRouter();
  const c = useTheme();
  const { filters } = useRaceFilters();
  const count = filterChips(filters).length;
  return (
    <Row style={{ paddingHorizontal: 16, paddingTop: 8 }}>
      <Pressable
        testID="races-search"
        accessibilityRole="search"
        onPress={() => router.push('/races/search')}
        style={{
          flex: 1,
          backgroundColor: c.surface,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 11,
        }}
      >
        <Text style={{ color: c.subtext }}>대회명·장소·주최 검색</Text>
      </Pressable>
      <Button
        small
        kind="secondary"
        testID="races-filter"
        label={count ? `필터 ${count}` : '필터'}
        onPress={() => router.push('/races/filter')}
      />
    </Row>
  );
}

function FilterChipsRow() {
  const { filters, setFilters } = useRaceFilters();
  const chips = filterChips(filters);
  if (chips.length === 0) return null;
  return (
    <Row wrap style={{ paddingHorizontal: 16 }}>
      {chips.map((chip) => (
        <Chip
          key={chip.key}
          label={`${chip.label} ×`}
          selected
          onPress={() => setFilters(chip.remove(filters))}
        />
      ))}
      <Chip label="초기화" onPress={() => setFilters({ ...filters, ...resetAll })} />
    </Row>
  );
}

const resetAll = {
  region: [],
  period: null,
  category: [],
  registrationState: [],
  fee: [],
  includeEnded: false,
  hideCancelled: false,
};

function RaceList() {
  const router = useRouter();
  const { filters, setFilters } = useRaceFilters();
  const query = filtersToQuery(filters, todayKst());
  const q = useInfiniteQuery({
    queryKey: ['races', 'list', query],
    queryFn: ({ pageParam }) => api.races({ ...query, cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = useMemo(
    () => withMonthHeaders(q.data?.pages.flatMap((p) => p.items) ?? []),
    [q.data],
  );
  const hasFilters = filterChips(filters).length > 0;

  if (q.isPending)
    return (
      <View style={{ padding: 16 }}>
        <SkeletonCards count={5} />
      </View>
    );
  if (q.isError)
    return <ErrorState message={screenErrorMessage(q.error)} onRetry={() => void q.refetch()} />;
  return (
    <FlatList
      testID="race-list"
      data={items}
      keyExtractor={(i) => i.key}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      refreshControl={
        <RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />
      }
      onEndReached={() => {
        if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
      }}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={
        hasFilters ? (
          <EmptyState
            message="조건에 맞는 대회가 없어요"
            action={
              <Button
                small
                kind="secondary"
                label="필터 초기화"
                onPress={() => setFilters({ ...filters, ...resetAll })}
              />
            }
          />
        ) : (
          <EmptyState message="등록된 대회가 없어요" />
        )
      }
      renderItem={({ item }) =>
        item.kind === 'header' ? (
          <T variant="h2" style={{ marginTop: 6 }}>
            {item.label}
          </T>
        ) : (
          <RaceCard race={item.race} onPress={() => router.push(`/races/${item.race.id}`)} />
        )
      }
    />
  );
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

function monthShift(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 캘린더 보기 (PRD 4.5). 달력 API(/races/calendar)가 아직 없어 그 달 목록으로 날짜별 개수를 센다 */
function RaceCalendar() {
  const router = useRouter();
  const c = useTheme();
  const today = todayKst();
  const { filters } = useRaceFilters();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const minMonth = monthShift(today.slice(0, 7), -1);
  const maxMonth = monthShift(today.slice(0, 7), 12);

  const from = `${month}-01`;
  const to = addDaysKst(`${monthShift(month, 1)}-01`, -1);
  const base = { ...filtersToQuery(filters, today), from, to, includeEnded: true };
  const q = useQuery({
    queryKey: ['races', 'calendar', base],
    queryFn: async () => {
      const all: RaceSummary[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const page = await api.races({ ...base, cursor, limit: 50 });
        all.push(...page.items);
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      return all;
    },
  });
  const byDate = useMemo(() => {
    const map = new Map<string, RaceSummary[]>();
    for (const r of q.data ?? []) map.set(r.raceDate, [...(map.get(r.raceDate) ?? []), r]);
    return map;
  }, [q.data]);

  const [y, m] = month.split('-').map(Number) as [number, number];
  const firstWd = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = Number(to.slice(8, 10));
  const cells: (string | null)[] = [
    ...Array.from({ length: firstWd }, () => null),
    ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ];
  const dayRaces = byDate.get(selected) ?? [];

  return (
    <FlatList
      data={dayRaces}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      ListHeaderComponent={
        <View style={{ gap: 10, marginBottom: 6 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Button
              small
              kind="ghost"
              label="‹"
              disabled={month <= minMonth}
              onPress={() => setMonth(monthShift(month, -1))}
            />
            <T variant="h2">{formatMonthHeader(from)}</T>
            <Button
              small
              kind="ghost"
              label="›"
              disabled={month >= maxMonth}
              onPress={() => setMonth(monthShift(month, 1))}
            />
          </Row>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {WEEK.map((w) => (
              <View
                key={w}
                style={{ width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 4 }}
              >
                <T variant="small" muted>
                  {w}
                </T>
              </View>
            ))}
            {cells.map((date, i) => {
              const count = date ? (byDate.get(date)?.length ?? 0) : 0;
              const on = date === selected;
              return (
                <Pressable
                  key={date ?? `e-${i}`}
                  disabled={!date}
                  onPress={() => date && setSelected(date)}
                  style={{ width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 6 }}
                >
                  {date ? (
                    <View
                      style={{
                        alignItems: 'center',
                        gap: 2,
                        borderRadius: 8,
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        backgroundColor: on ? c.primarySoft : 'transparent',
                      }}
                    >
                      <T variant="caption" color={date === today ? c.primary : undefined}>
                        {Number(date.slice(8))}
                      </T>
                      <T variant="small" color={c.primary}>
                        {count ? (count > 9 ? '●9+' : `●${count}`) : ' '}
                      </T>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          <T variant="bodyStrong">{formatDate(selected)}</T>
          {q.isPending ? <SkeletonCards count={2} /> : null}
          {q.isError ? (
            <ErrorState
              compact
              message={screenErrorMessage(q.error)}
              onRetry={() => void q.refetch()}
            />
          ) : null}
        </View>
      }
      ListEmptyComponent={q.isSuccess ? <EmptyState message="이 날은 대회가 없어요" /> : undefined}
      renderItem={({ item }) => (
        <RaceCard race={item} onPress={() => router.push(`/races/${item.id}`)} />
      )}
    />
  );
}

/** S-020 대회 캘린더/리스트 (PRD 6.9) */
export default function Races() {
  const c = useTheme();
  const { view, setView, load, loaded } = useRaceFilters();
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, gap: 10 }}>
      <SearchBar />
      <Row style={{ paddingHorizontal: 16, justifyContent: 'space-between' }}>
        <Badge label="도로 대회" />
        <View style={{ width: 180 }}>
          <Segmented
            testID="races-view"
            options={[
              { value: 'list', label: '리스트' },
              { value: 'calendar', label: '캘린더' },
            ]}
            value={view}
            onChange={setView}
          />
        </View>
      </Row>
      <FilterChipsRow />
      {!loaded ? null : view === 'list' ? <RaceList /> : <RaceCalendar />}
    </View>
  );
}
