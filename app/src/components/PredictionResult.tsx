import type { Prediction, SplitRow, Splits } from '@berun/shared';
import { useState } from 'react';
import { View } from 'react-native';
import {
  CONFIDENCE_BADGE,
  CONFIDENCE_REASON_TEXT,
  PREDICTION_DISCLAIMER,
  clockAt,
  formatRange,
  splitPointLabel,
  type SplitBasis,
  type StrategyView,
} from '../features/prediction';
import {
  formatDate,
  formatDistance,
  formatDuration,
  formatHoursMinutes,
  formatPace,
} from '../lib/format';
import { useTheme } from '../theme';
import { Badge, Card, LinkText, Notice, Row, Section, Segmented, T } from './ui';

function SplitTable({ rows, startAt }: { rows: SplitRow[]; startAt: string | null }) {
  const c = useTheme();
  const cell = { flex: 1 } as const;
  return (
    <View testID="split-table" style={{ borderWidth: 1, borderColor: c.border, borderRadius: 10 }}>
      <Row style={{ padding: 10, backgroundColor: c.surface }}>
        <T variant="small" muted style={cell}>
          지점
        </T>
        <T variant="small" muted style={cell}>
          구간 페이스
        </T>
        <T variant="small" muted style={cell}>
          누적
        </T>
        {startAt ? (
          <T variant="small" muted style={cell}>
            예상 통과
          </T>
        ) : null}
      </Row>
      {rows.map((r) => (
        <Row key={r.atM} style={{ padding: 10, borderTopWidth: 1, borderTopColor: c.border }}>
          <T variant="caption" style={cell}>
            {splitPointLabel(r)}
          </T>
          <T variant="caption" style={cell}>
            {formatPace(r.segmentPaceSecPerKm)}
          </T>
          <T variant="caption" style={cell}>
            {formatDuration(r.cumulativeSec)}
          </T>
          {startAt ? (
            <T variant="caption" style={cell}>
              {clockAt(startAt, r.cumulativeSec)}
            </T>
          ) : null}
        </Row>
      ))}
    </View>
  );
}

/** 페이스 전략 (PRD 4.13): 기준 토글(목표/예측) + 이븐/네거티브 탭 + 스플릿 표 */
export function PaceStrategy({
  bases,
  defaultBasis,
  goalSplits,
  predictionSplits,
  startAt,
}: {
  bases: SplitBasis[];
  defaultBasis: SplitBasis;
  goalSplits: Splits | null;
  predictionSplits: Splits | null;
  startAt: string | null;
}) {
  const [basis, setBasis] = useState<SplitBasis>(defaultBasis);
  const [tab, setTab] = useState<'even' | 'negative'>('even');
  const splits = basis === 'goal' ? goalSplits : predictionSplits;
  if (!splits) return null;
  return (
    <Section title="페이스 전략">
      {bases.length > 1 ? (
        <Segmented<SplitBasis>
          testID="split-basis"
          options={[
            { value: 'goal', label: '목표 기준' },
            { value: 'prediction', label: '예측 기준' },
          ]}
          value={basis}
          onChange={setBasis}
        />
      ) : null}
      <Segmented
        testID="split-tab"
        options={[
          { value: 'even', label: '이븐 페이스' },
          { value: 'negative', label: '네거티브 스플릿' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <SplitTable rows={splits[tab]} startAt={startAt} />
      <T variant="caption" muted>
        {tab === 'even'
          ? '처음부터 끝까지 같은 속도로 달려요.'
          : '전반은 조금 천천히, 후반에 조금 빠르게 달려요. 후반에 무너질 위험이 줄어요.'}
      </T>
    </Section>
  );
}

export function Disclaimer() {
  return (
    <Notice>
      <T variant="caption" muted testID="disclaimer">
        {PREDICTION_DISCLAIMER}
      </T>
    </Notice>
  );
}

/** 결과 카드 + 면책 + 첫 풀 제안·제한 시간 경고 + 사용한 기록 (PRD 6.17 ②~⑤) */
export function PredictionBody({
  p,
  timeLimitMin,
  onRepredict,
}: {
  p: Prediction;
  timeLimitMin: number | null;
  onRepredict?: () => void;
}) {
  const c = useTheme();
  const [showRecords, setShowRecords] = useState(false);
  const badge = CONFIDENCE_BADGE[p.confidence];
  return (
    <>
      {p.recordsChangedSince && onRepredict ? (
        <LinkText
          testID="records-changed"
          color={c.yellow}
          label="기록이 바뀌었어요 · 다시 예측"
          onPress={onRepredict}
        />
      ) : null}
      <Card testID="prediction-result">
        <T variant="caption" muted>
          예상 기록
        </T>
        <T variant="display" testID="predicted-time">
          {formatDuration(p.predictedSec)}
        </T>
        <T muted>
          범위 {formatRange(p)} · 평균 페이스 {formatPace(p.avgPaceSecPerKm)}
        </T>
        <Row style={{ alignItems: 'flex-start' }}>
          <Badge label={badge.label} tone={badge.tone} testID="confidence" />
        </Row>
        <T variant="caption">{CONFIDENCE_REASON_TEXT[p.confidenceReason]}</T>
      </Card>
      <Disclaimer />
      {p.firstFullSuggestionSec ? (
        <Notice tone="blue">
          {`첫 풀코스라면 ${formatDuration(p.firstFullSuggestionSec)} 목표를 권해요. 후반 30km 이후를 대비해 여유를 두세요.`}
        </Notice>
      ) : null}
      {p.timeLimitWarning && timeLimitMin !== null ? (
        <Notice tone="yellow">{`예상 범위가 제한 시간(${formatHoursMinutes(timeLimitMin * 60)})에 가까워요.`}</Notice>
      ) : null}
      {p.usedRecords.length > 0 ? (
        <View style={{ gap: 8 }}>
          <LinkText
            label={`사용한 기록 ${p.usedRecords.length}개 ${showRecords ? '접기' : '펼치기'}`}
            color={c.text}
            onPress={() => setShowRecords(!showRecords)}
          />
          {showRecords
            ? p.usedRecords.map((r) => (
                <Row key={r.recordId} style={{ justifyContent: 'space-between' }}>
                  <T variant="caption">
                    {formatDistance(r.distanceM)} {formatDuration(r.durationSec)} ·{' '}
                    {formatDate(r.runDate)}
                  </T>
                  <T variant="caption" muted>
                    환산 {formatDuration(r.convertedSec)}
                  </T>
                </Row>
              ))
            : null}
        </View>
      ) : null}
    </>
  );
}

export type { StrategyView };
