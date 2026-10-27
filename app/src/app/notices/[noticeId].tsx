import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from 'react-native';
import { api } from '../../api';
import { isApiError } from '../../api/client';
import { screenErrorMessage } from '../../api/messages';
import { Button, ErrorState, Screen, SkeletonCards, T } from '../../components/ui';
import { splitLinks } from '../../features/notice';
import { openInAppBrowser } from '../../lib/external';
import { formatDateTime } from '../../lib/format';
import { useTheme } from '../../theme';

/** 공지 상세 (PRD 8.6) — 앱 화면. 줄바꿈 유지·URL 자동 링크(인앱 브라우저), 하단 이동 버튼 */
export default function Notice() {
  const { noticeId } = useLocalSearchParams<{ noticeId: string }>();
  const router = useRouter();
  const c = useTheme();
  const q = useQuery({ queryKey: ['notice', noticeId], queryFn: () => api.notice(noticeId) });

  if (q.isPending) {
    return (
      <Screen>
        <Stack.Screen options={{ title: '공지' }} />
        <SkeletonCards count={2} height={80} />
      </Screen>
    );
  }
  if (q.isError) {
    const withdrawn = isApiError(q.error) && q.error.code === 'NOTICE_WITHDRAWN';
    return (
      <>
        <Stack.Screen options={{ title: '공지' }} />
        <ErrorState
          message={withdrawn ? '내려간 공지예요' : screenErrorMessage(q.error)}
          onRetry={
            withdrawn || (isApiError(q.error) && q.error.status === 404)
              ? undefined
              : () => void q.refetch()
          }
        />
      </>
    );
  }
  const n = q.data;
  const link = n.link;
  const action =
    link.type === 'race'
      ? { label: '대회 보기', go: () => router.push(`/races/${link.raceId}`) }
      : link.type === 'race_list'
        ? { label: '대회 찾아보기', go: () => router.navigate('/races') }
        : null;
  return (
    <>
      <Stack.Screen options={{ title: '공지' }} />
      <Screen
        footer={
          action ? (
            <Button testID="notice-action" label={action.label} onPress={action.go} />
          ) : undefined
        }
      >
        <T variant="h2" testID="notice-title">
          {n.title}
        </T>
        <T variant="caption" muted>
          {formatDateTime(n.publishedAt)}
        </T>
        <Text testID="notice-body" style={{ color: c.text, fontSize: 15, lineHeight: 22 }}>
          {splitLinks(n.body).map((part, i) =>
            part.url ? (
              <Text
                key={i}
                accessibilityRole="link"
                style={{ color: c.primary, textDecorationLine: 'underline' }}
                onPress={() => void openInAppBrowser(part.url!)}
              >
                {part.text}
              </Text>
            ) : (
              part.text
            ),
          )}
        </Text>
      </Screen>
    </>
  );
}
