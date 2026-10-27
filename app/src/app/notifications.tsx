import type { AppNotification } from '@berun/shared';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { api } from '../api';
import { screenErrorMessage } from '../api/messages';
import { Button, EmptyState, ErrorState, LinkText, Row, SkeletonCards, T } from '../components/ui';
import { deepLinkToPath, notificationIcon } from '../features/deepLink';
import { formatRelative } from '../lib/format';
import { useTheme } from '../theme';
import { analytics } from '../lib/analyticsClient';

/** S-011 알림 목록 (PRD 6.8) */
export default function Notifications() {
  const router = useRouter();
  const qc = useQueryClient();
  const c = useTheme();
  const q = useInfiniteQuery({
    queryKey: ['notifications'],
    queryFn: ({ pageParam }) => api.notifications(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  const refreshCounts = () => {
    void qc.invalidateQueries({ queryKey: ['notifications'] });
    void qc.invalidateQueries({ queryKey: ['home', 'unread'] });
  };

  const tap = async (n: AppNotification) => {
    analytics.track('notification_opened', {
      kind: n.kind,
      race_id: /^berun:\/\/races\/([\w-]+)/.exec(n.deepLink)?.[1] ?? null,
    });
    if (!n.readAt) {
      await api.markRead({ ids: [n.id] }).catch(() => undefined);
      refreshCounts();
    }
    // 휴면 안내는 읽음 처리만 (PRD 6.8)
    if (n.kind === 'dormancy_notice') return;
    const path = deepLinkToPath(n.deepLink);
    if (!path || path === '/notifications') return;
    if (path.startsWith('/notices/')) {
      router.push({ pathname: '/notices/[noticeId]', params: { noticeId: path.slice(9) } });
      return;
    }
    router.push(path);
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: '알림',
          headerRight: () => (
            <LinkText
              label="모두 읽음"
              onPress={() =>
                void api
                  .markRead({ all: true })
                  .then(refreshCounts)
                  .catch(() => undefined)
              }
            />
          ),
        }}
      />
      {q.isPending ? (
        <View style={{ padding: 16 }}>
          <SkeletonCards count={5} height={64} />
        </View>
      ) : q.isError ? (
        <ErrorState message={screenErrorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          style={{ backgroundColor: c.bg }}
          refreshControl={
            <RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />
          }
          onEndReached={() => q.hasNextPage && void q.fetchNextPage()}
          ListEmptyComponent={
            <EmptyState
              message="아직 받은 알림이 없어요. 관심 대회를 등록하면 접수 소식을 알려드려요"
              action={
                <Button small label="대회 찾아보기" onPress={() => router.navigate('/races')} />
              }
            />
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`notification-${item.id}`}
              onPress={() => void tap(item)}
              style={{
                padding: 16,
                backgroundColor: item.readAt ? c.bg : c.primarySoft,
                borderBottomWidth: 1,
                borderBottomColor: c.border,
              }}
            >
              <Row style={{ alignItems: 'flex-start' }} gap={12}>
                <Text style={{ fontSize: 20 }}>{notificationIcon(item.kind)}</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <T variant="bodyStrong">{item.title}</T>
                  <T variant="caption" muted numberOfLines={2}>
                    {item.body}
                  </T>
                  <T variant="small" muted>
                    {formatRelative(item.createdAt)}
                  </T>
                </View>
              </Row>
            </Pressable>
          )}
        />
      )}
    </>
  );
}
