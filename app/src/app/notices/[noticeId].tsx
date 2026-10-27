import { Stack, useLocalSearchParams } from 'expo-router';
import { Screen, T } from '../../components/ui';

/**
 * 공지 상세 (PRD 8.6) — 서버 GET /notices/{id}가 아직 없어 알림에 담긴 제목·본문을 그대로 보여준다.
 * API가 생기면 본문 링크·하단 이동 버튼(link)과 410 NOTICE_WITHDRAWN 처리를 붙인다 (handoff).
 */
export default function Notice() {
  const { title, body } = useLocalSearchParams<{
    noticeId: string;
    title?: string;
    body?: string;
  }>();
  return (
    <>
      <Stack.Screen options={{ title: '공지' }} />
      <Screen>
        <T variant="h2">{title ?? '공지'}</T>
        <T>{body ?? '공지를 불러오지 못했어요'}</T>
      </Screen>
    </>
  );
}
