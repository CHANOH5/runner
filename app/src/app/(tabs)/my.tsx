import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { api } from '../../api';
import { Button, Card, ErrorState, Row, Screen, Skeleton, T } from '../../components/ui';
import { REGION_LABELS, todayKst } from '../../lib/format';
import { useTheme } from '../../theme';

function MenuRow({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const c = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={{
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
        flexDirection: 'row',
        justifyContent: 'space-between',
      }}
    >
      <T>{label}</T>
      <T muted>›</T>
    </Pressable>
  );
}

/** S-060 마이 (PRD 6.18) */
export default function My() {
  const router = useRouter();
  const qc = useQueryClient();
  const c = useTheme();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const thisYear = Number(todayKst().slice(0, 4));

  const count = (n: number | undefined, label: string, tab: string) => (
    <Card
      onPress={() => router.push({ pathname: '/my/races', params: { tab } })}
      style={{ flex: 1, alignItems: 'center' }}
      testID={`my-count-${tab}`}
    >
      <T variant="title">{me.isError ? '–' : (n ?? '–')}</T>
      <T variant="caption" muted>
        {label}
      </T>
    </Card>
  );

  return (
    <Screen
      onRefresh={() => void qc.invalidateQueries({ queryKey: ['me'] })}
      refreshing={me.isRefetching}
    >
      {me.isPending ? (
        <Skeleton height={72} />
      ) : me.isError ? (
        <ErrorState compact message="불러오지 못했어요" onRetry={() => void me.refetch()} />
      ) : (
        <Row gap={14}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: c.primarySoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <T variant="title" color={c.primary}>
              {[...me.data.nickname][0] ?? ''}
            </T>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T variant="h2" testID="my-nickname">
              {me.data.nickname}
            </T>
            <T variant="caption" muted>
              {REGION_LABELS[me.data.regionCode]}
              {me.data.runningSince ? ` · 러닝 ${thisYear - me.data.runningSince + 1}년 차` : ''}
            </T>
          </View>
          <Button
            small
            kind="secondary"
            label="프로필 수정"
            onPress={() => router.push('/my/profile')}
          />
        </Row>
      )}
      <Row>
        {count(me.data?.counts.interested, '관심', 'interested')}
        {count(me.data?.counts.upcoming, '참가 예정', 'upcoming')}
        {count(me.data?.counts.past, '지난 대회', 'past')}
      </Row>
      <View>
        <MenuRow label="내 대회" onPress={() => router.push('/my/races')} />
        <MenuRow testID="menu-settings" label="설정" onPress={() => router.push('/my/settings')} />
      </View>
    </Screen>
  );
}
