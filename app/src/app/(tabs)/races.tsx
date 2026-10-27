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
import {
  calendarCell,
  calendarDayQuery,
  calendarFilters,
  calendarMonthRange,
  lastDayOfMonth,
  monthShift,
} from '../../features/calendar';
import { withMonthHeaders } from '../../features/raceList';
import { filterChips, filtersToQuery, useRaceFilters } from '../../features/raceFilters';
import { formatDate, formatMonthHeader, todayKst } from '../../lib/format';
import { useTheme } from '../../theme';
import { analytics } from '../../lib/analyticsClient';

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

/** 캘린더 보기 (PRD v1.12 4.5): 지난 날짜도 점·개수와 그날 목록을 보인다 (회색) */
function RaceCalendar() {
  const router = useRouter();
  const c = useTheme();
  const today = todayKst();
  const { filters } = useRaceFilters();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const range = calendarMonthRange(today);
  const base = calendarFilters(filters, today);

  const cal = useQuery({
    queryKey: ['races', 'calendar', month, base],
    queryFn: () => api.raceCalendar(month, base),
  });
  const day = useInfiniteQuery({
    queryKey: ['races', 'calendar-day', selected, base],
    queryFn: ({ pageParam }) =>
      api.races({ ...calendarDayQuery(filters, today, selected), cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const counts = useMemo(
    () => new Map((cal.data?.days ?? []).map((d) => [d.date, d.count])),
    [cal.data],
  );
  const dayRaces = day.data?.pages.flatMap((p) => p.items) ?? [];

  const [y, m] = month.split('-').map(Number) as [number, number];
  const firstWd = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = Number(lastDayOfMonth(month).slice(8, 10));
  const cells: (string | null)[] = [
    ...Array.from({ length: firstWd }, () => null),
    ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ];

  return (
    <FlatList
      testID="race-calendar"
      data={dayRaces}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      onEndReached={() => {
        if (day.hasNextPage && !day.isFetchingNextPage) void day.fetchNextPage();
      }}
      ListHeaderComponent={
        <View style={{ gap: 10, marginBottom: 6 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Button
              small
              kind="ghost"
              label="‹"
              disabled={month <= range.min}
              onPress={() => setMonth(monthShift(month, -1))}
            />
            <T variant="h2">{formatMonthHeader(`${month}-01`)}</T>
            <Button
              small
              kind="ghost"
              label="›"
              disabled={month >= range.max}
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
              const cell = date ? calendarCell(date, counts.get(date) ?? 0, today) : null;
              const on = date === selected;
              return (
                <Pressable
                  key={date ?? `e-${i}`}
                  testID={date ? `cal-${date}` : undefined}
                  accessibilityLabel={
                    date && cell?.label ? `${date} 대회 ${cell.label}개` : (date ?? undefined)
                  }
                  disabled={!date}
                  onPress={() => date && setSelected(date)}
                  style={{ width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 6 }}
                >
                  {date && cell ? (
                    <View
                      style={{
                        alignItems: 'center',
                        gap: 2,
                        borderRadius: 8,
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        backgroundColor: on ? c.primarySoft : 'transparent',
                        opacity: cell.past ? 0.45 : 1,
                      }}
                    >
                      <T variant="caption" color={cell.isToday ? c.primary : undefined}>
                        {Number(date.slice(8))}
                      </T>
                      <T variant="small" color={cell.past ? c.subtext : c.primary}>
                        {cell.label ? `●${cell.label}` : ' '}
                      </T>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          {cal.isError ? (
            <ErrorState
              compact
              message={screenErrorMessage(cal.error)}
              onRetry={() => void cal.refetch()}
            />
          ) : null}
          <T variant="bodyStrong">{formatDate(selected)}</T>
          {day.isPending ? <SkeletonCards count={2} /> : null}
          {day.isError ? (
            <ErrorState
              compact
              message={screenErrorMessage(day.error)}
              onRetry={() => void day.refetch()}
            />
          ) : null}
        </View>
      }
      ListEmptyComponent={
        day.isSuccess ? <EmptyState message="이 날은 대회가 없어요" /> : undefined
      }
      renderItem={({ item }) => (
        <RaceCard race={item} onPress={() => router.push(`/races/${item.id}`)} />
      )}
    />
  );
}

/** S-020 대회 캘린더/리스트 (PRD 6.9) */
export default function Races() {
  const c = useTheme();
  const { view, setView, load, loaded, filters } = useRaceFilters();
  useEffect(() => {
    void load();
  }, [load]);
  const filterCount = filterChips(filters).length;
  useEffect(() => {
    if (loaded) analytics.track('race_list_viewed', { view, filter_count: filterCount });
  }, [loaded, view, filterCount]);
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
