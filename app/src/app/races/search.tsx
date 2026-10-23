import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api } from '../../api';
import { screenErrorMessage } from '../../api/messages';
import { RaceCard } from '../../components/RaceCard';
import {
  Chip,
  EmptyState,
  ErrorState,
  Input,
  LinkText,
  Row,
  Screen,
  Section,
  Skeleton,
  T,
} from '../../components/ui';
import { kv } from '../../lib/kv';
import { useTheme } from '../../theme';

const RECENT_KEY = 'user.recentSearches';
const MAX_RECENT = 10;

/** S-021 검색 모드 (PRD 4.6): 300ms 멈추면 검색, 1~30자, 최근 검색어 10개, 지난 대회 구분선 */
export default function RaceSearch() {
  const router = useRouter();
  const c = useTheme();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    void kv.get<string[]>(RECENT_KEY, []).then(setRecent);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const saveRecent = (list: string[]) => {
    setRecent(list);
    void kv.set(RECENT_KEY, list);
  };
  const remember = (q: string) =>
    saveRecent([q, ...recent.filter((x) => x !== q)].slice(0, MAX_RECENT));

  const result = useQuery({
    queryKey: ['races', 'search', query],
    queryFn: () => api.races({ q: query, limit: 50 }),
    enabled: query.length >= 1,
  });
  const items = result.data?.items ?? [];
  const firstEnded = items.findIndex((r) => r.registrationState === 'ended');

  return (
    <>
      <Stack.Screen options={{ title: '대회 검색' }} />
      <View style={{ padding: 16, paddingBottom: 0, gap: 6, backgroundColor: c.bg }}>
        <Input
          testID="search-input"
          autoFocus
          value={text}
          onChangeText={setText}
          maxLength={30}
          placeholder="대회명·장소·주최"
          returnKeyType="search"
          onSubmitEditing={() => text.trim() && remember(text.trim())}
        />
        {result.isFetching ? <Skeleton height={3} /> : <View style={{ height: 3 }} />}
      </View>
      <Screen>
        {query.length === 0 ? (
          recent.length > 0 ? (
            <Section
              title="최근 검색어"
              right={<LinkText label="전체 삭제" onPress={() => saveRecent([])} />}
            >
              <Row wrap>
                {recent.map((r) => (
                  <Row key={r} gap={2}>
                    <Chip label={r} onPress={() => setText(r)} />
                    <LinkText
                      label="×"
                      color={c.subtext}
                      onPress={() => saveRecent(recent.filter((x) => x !== r))}
                    />
                  </Row>
                ))}
              </Row>
            </Section>
          ) : (
            <T muted>대회명·장소명·주최로 찾아보세요</T>
          )
        ) : result.isError ? (
          <ErrorState
            compact
            message={screenErrorMessage(result.error)}
            onRetry={() => void result.refetch()}
          />
        ) : result.isSuccess && items.length === 0 ? (
          <EmptyState
            message={`'${query}'에 해당하는 대회가 없어요. 대회명을 다시 확인해주세요.`}
          />
        ) : (
          items.map((race, i) => (
            <View key={race.id} style={{ gap: 10 }}>
              {i === firstEnded ? (
                <T variant="caption" muted>
                  지난 대회
                </T>
              ) : null}
              <RaceCard
                race={race}
                onPress={() => {
                  remember(query);
                  router.push(`/races/${race.id}`);
                }}
              />
            </View>
          ))
        )}
      </Screen>
    </>
  );
}
