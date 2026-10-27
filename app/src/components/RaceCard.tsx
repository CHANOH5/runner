import type { RaceSummary } from '@berun/shared';
import { Pressable, Text } from 'react-native';
import { cardDDay, raceBadges } from '../features/race';
import { CATEGORY_LABELS, formatDate, formatDDay, REGION_LABELS } from '../lib/format';
import { useTheme } from '../theme';
import { Badge, Card, Row, T } from './ui';
import { useInterest } from './useInterest';

export function HeartButton({
  on,
  onPress,
  testID,
}: {
  on: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const c = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={on ? '관심 해제' : '관심 추가'}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      hitSlop={10}
      style={{ padding: 4 }}
    >
      <Text style={{ fontSize: 22, color: on ? c.primary : c.subtext }}>{on ? '♥' : '♡'}</Text>
    </Pressable>
  );
}

/** 대회 리스트 카드 (PRD 4.5): 대회명·대회일·지역·종목·접수 배지·D-day(30일 이내)·관심 하트 */
export function RaceCard({
  race,
  onPress,
  muted,
  extra,
  showHeart = true,
  onInterestOff,
}: {
  race: RaceSummary;
  onPress: () => void;
  muted?: boolean;
  extra?: React.ReactNode;
  showHeart?: boolean;
  /** 하트로 관심을 끈 뒤 (S-061 관심 탭: 카드 빼기 + [되돌리기]) */
  onInterestOff?: () => void;
}) {
  const c = useTheme();
  const dDay = formatDDay(cardDDay(race.dDay));
  // 카드 전체를 버튼으로 만들면 하트 버튼이 중첩된다(웹 <button> 중첩 경고) → 내용 영역만 누를 수 있게 한다
  return (
    <Card tone={muted ? 'muted' : 'surface'} testID={`race-card-${race.id}`}>
      <Row style={{ alignItems: 'flex-start' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={race.name}
          onPress={onPress}
          style={({ pressed }) => ({ flex: 1, gap: 6, opacity: pressed ? 0.7 : 1 })}
        >
          <Row wrap gap={6}>
            {raceBadges(race).map((b) => (
              <Badge key={b.label} label={b.label} tone={b.tone} />
            ))}
            {dDay ? (
              <T variant="caption" color={c.primary} style={{ fontWeight: '700' }}>
                {dDay}
              </T>
            ) : null}
          </Row>
          <T variant="bodyStrong" numberOfLines={2}>
            {race.name}
          </T>
          <T variant="caption" muted>
            {formatDate(race.raceDate)} · {REGION_LABELS[race.regionCode]}
          </T>
          <Row wrap gap={4}>
            {race.categories.map((cat) => (
              <Badge key={cat} label={CATEGORY_LABELS[cat]} tone="primary" />
            ))}
          </Row>
        </Pressable>
        {showHeart ? <CardHeart race={race} onInterestOff={onInterestOff} /> : null}
      </Row>
      {extra}
    </Card>
  );
}

function CardHeart({ race, onInterestOff }: { race: RaceSummary; onInterestOff?: () => void }) {
  const { interested, toggle, elements } = useInterest(race, { onTurnedOff: onInterestOff });
  return (
    <>
      <HeartButton on={interested} onPress={() => void toggle()} testID={`heart-${race.id}`} />
      {elements}
    </>
  );
}
