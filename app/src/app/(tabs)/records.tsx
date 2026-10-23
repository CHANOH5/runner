import type { RunRecord } from '@berun/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { api } from '../../api';
import { screenErrorMessage } from '../../api/messages';
import { PredictionCard, repredictParams } from '../../components/PredictionCard';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LinkText,
  Row,
  Section,
  SkeletonCards,
  T,
} from '../../components/ui';
import { formatDate, formatDistance, formatDuration, formatPace } from '../../lib/format';
import { useTheme } from '../../theme';

function RecordRow({ r, onPress }: { r: RunRecord; onPress: () => void }) {
  return (
    <Card onPress={onPress} testID={`record-${r.id}`}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={6}>
          <T variant="bodyStrong">{formatDistance(r.distanceM, r.category)}</T>
          <T variant="bodyStrong">{formatDuration(r.durationSec)}</T>
          <T variant="caption" muted>
            {formatPace(r.paceSecPerKm)}
          </T>
        </Row>
        <Row gap={4}>
          <Badge
            label={r.kind === 'race' ? '대회' : '훈련'}
            tone={r.kind === 'race' ? 'primary' : 'gray'}
          />
          {!r.usableForPrediction ? <Badge label="예측 미사용" /> : null}
        </Row>
      </Row>
      <T variant="caption" muted numberOfLines={1}>
        {formatDate(r.runDate)}
        {r.title ? ` · ${r.title}` : ''}
      </T>
    </Card>
  );
}

function RecentPredictions() {
  const router = useRouter();
  const q = useQuery({ queryKey: ['predictions', 'recent'], queryFn: () => api.predictions(4) });
  if (q.isPending) return <SkeletonCards count={1} />;
  if (q.isError || q.data.items.length === 0) return null;
  const items = q.data.items.slice(0, 3);
  return (
    <Section
      title="최근 예측"
      right={
        q.data.items.length > 3 ? (
          <LinkText label="전체 보기" onPress={() => router.push('/predictions')} />
        ) : undefined
      }
    >
      {items.map((p) => (
        <PredictionCard
          key={p.id}
          p={p}
          onPress={() => router.push(`/predictions/${p.id}`)}
          onRepredict={() =>
            router.push({ pathname: '/records/predict', params: repredictParams(p) })
          }
        />
      ))}
    </Section>
  );
}

/** S-030 기록 홈 (PRD 6.14) */
export default function Records() {
  const router = useRouter();
  const c = useTheme();
  const q = useInfiniteQuery({
    queryKey: ['records', 'list'],
    queryFn: ({ pageParam }) => api.records(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const records = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        testID="records-list"
        data={records}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 96 }}
        refreshControl={
          <RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />
        }
        onEndReached={() => {
          if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
        }}
        ListHeaderComponent={
          <View style={{ gap: 16, marginBottom: 6 }}>
            <Button
              testID="go-predict"
              label="기록 예측하기"
              onPress={() => router.push('/records/predict')}
            />
            <RecentPredictions />
            <T variant="h2">내 기록</T>
            {q.isPending ? <SkeletonCards count={3} height={64} /> : null}
            {q.isError ? (
              <ErrorState
                compact
                message={screenErrorMessage(q.error)}
                onRetry={() => void q.refetch()}
              />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          q.isSuccess ? (
            <EmptyState
              message="아직 기록이 없어요. 최근에 뛴 대회나 훈련 기록을 넣어보세요"
              action={
                <Button small label="기록 추가" onPress={() => router.push('/records/edit')} />
              }
            />
          ) : undefined
        }
        renderItem={({ item }) => (
          <RecordRow
            r={item}
            onPress={() => router.push({ pathname: '/records/edit', params: { id: item.id } })}
          />
        )}
      />
      <Pressable
        testID="record-add-fab"
        accessibilityRole="button"
        accessibilityLabel="기록 추가"
        onPress={() => router.push('/records/edit')}
        style={{
          position: 'absolute',
          right: 20,
          bottom: 24,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: c.primary,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: '#fff', fontSize: 28, lineHeight: 30 }}>+</Text>
      </Pressable>
    </View>
  );
}
