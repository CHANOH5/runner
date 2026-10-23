import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { FlatList } from 'react-native';
import { api } from '../../api';
import { screenErrorMessage } from '../../api/messages';
import { PredictionCard, repredictParams } from '../../components/PredictionCard';
import { EmptyState, ErrorState, SkeletonCards } from '../../components/ui';

const MAX_ITEMS = 50;

/** 예측 목록 (S-030 [전체 보기], 최근 50개) */
export default function Predictions() {
  const router = useRouter();
  const q = useInfiniteQuery({
    queryKey: ['predictions', 'all'],
    queryFn: ({ pageParam }) => api.predictions(20, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last, pages) =>
      pages.flatMap((p) => p.items).length >= MAX_ITEMS
        ? undefined
        : (last.nextCursor ?? undefined),
  });
  const items = (q.data?.pages.flatMap((p) => p.items) ?? []).slice(0, MAX_ITEMS);
  return (
    <>
      <Stack.Screen options={{ title: '최근 예측' }} />
      {q.isPending ? (
        <SkeletonCards count={4} />
      ) : q.isError ? (
        <ErrorState message={screenErrorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id ?? ''}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          onEndReached={() => q.hasNextPage && void q.fetchNextPage()}
          ListEmptyComponent={<EmptyState message="아직 예측한 기록이 없어요" />}
          renderItem={({ item }) => (
            <PredictionCard
              p={item}
              onPress={() => router.push(`/predictions/${item.id}`)}
              onRepredict={() =>
                router.push({ pathname: '/records/predict', params: repredictParams(item) })
              }
            />
          )}
        />
      )}
    </>
  );
}
