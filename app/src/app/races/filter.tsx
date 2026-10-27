import type { DistanceCategory, FeeBucket, RegionCode } from '@berun/shared';
import { REGION_CODES } from '@berun/shared';
import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Button, Chip, Field, Input, Row, Screen, Section, T } from '../../components/ui';
import {
  customPeriodError,
  EMPTY_FILTERS,
  FEE_LABEL,
  filtersToQuery,
  PERIOD_LABEL,
  REG_STATE_LABEL,
  useRaceFilters,
  type PeriodFilter,
  type RaceFilterState,
  type RegistrationStateFilter,
} from '../../features/raceFilters';
import { CATEGORY_LABELS, REGION_LABELS, todayKst } from '../../lib/format';
import { goBack } from '../../lib/nav';

const toggle = <T,>(list: T[], v: T) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

/**
 * S-021 필터 모드 (PRD 4.6). 결과 수는 GET /races/count ("128개 대회 보기", 리스트 보기 기준 —
 * "종료 포함"을 따른다. 캘린더는 지난 날짜도 항상 보인다, PRD v1.12 4.5)
 */
export default function RaceFilter() {
  const { filters, setFilters } = useRaceFilters();
  const [draft, setDraft] = useState<RaceFilterState>(filters);
  const [from, setFrom] = useState(draft.period?.preset === 'custom' ? draft.period.from : '');
  const [to, setTo] = useState(draft.period?.preset === 'custom' ? draft.period.to : '');
  const today = todayKst();
  const customError = draft.period?.preset === 'custom' ? customPeriodError(from, to) : null;

  useEffect(() => {
    if (draft.period?.preset === 'custom' && !customPeriodError(from, to)) {
      setDraft((d) => ({ ...d, period: { preset: 'custom', from, to } }));
    }
  }, [from, to, draft.period?.preset]);

  const query = filtersToQuery(draft, today);
  const count = useQuery({
    queryKey: ['races', 'filter-count', query],
    queryFn: () => api.raceCount(query),
    enabled: !customError,
  });
  const n = count.data?.count ?? null;
  const label = n === null ? '대회 보기' : `${n.toLocaleString('ko-KR')}개 대회 보기`;

  const setPeriod = (p: PeriodFilter['preset']) =>
    setDraft((d) => ({
      ...d,
      period:
        d.period?.preset === p
          ? null
          : p === 'custom'
            ? { preset: 'custom', from: from || today, to: to || today }
            : { preset: p },
    }));

  return (
    <>
      <Stack.Screen options={{ title: '필터', presentation: 'modal' }} />
      <Screen
        footer={
          <Row>
            <Button
              kind="secondary"
              label="초기화"
              onPress={() => setDraft(EMPTY_FILTERS)}
              style={{ flex: 1 }}
            />
            <Button
              testID="filter-apply"
              label={label}
              disabled={n === 0 || !!customError}
              onPress={() => {
                setFilters(draft);
                goBack();
              }}
              style={{ flex: 2 }}
            />
          </Row>
        }
      >
        {n === 0 ? <T muted>조건에 맞는 대회가 없어요</T> : null}
        <Section title="지역">
          <Row wrap>
            {REGION_CODES.map((r: RegionCode) => (
              <Chip
                key={r}
                label={REGION_LABELS[r]}
                selected={draft.region.includes(r)}
                onPress={() => setDraft({ ...draft, region: toggle(draft.region, r) })}
              />
            ))}
          </Row>
        </Section>
        <Section title="기간">
          <Row wrap>
            {(Object.keys(PERIOD_LABEL) as PeriodFilter['preset'][]).map((p) => (
              <Chip
                key={p}
                label={PERIOD_LABEL[p]}
                selected={draft.period?.preset === p}
                onPress={() => setPeriod(p)}
              />
            ))}
          </Row>
          {draft.period?.preset === 'custom' ? (
            <Field error={customError}>
              <Row>
                <Input
                  value={from}
                  onChangeText={setFrom}
                  placeholder="시작 YYYY-MM-DD"
                  maxLength={10}
                  style={{ flex: 1 }}
                />
                <T muted>~</T>
                <Input
                  value={to}
                  onChangeText={setTo}
                  placeholder="종료 YYYY-MM-DD"
                  maxLength={10}
                  style={{ flex: 1 }}
                />
              </Row>
            </Field>
          ) : null}
        </Section>
        <Section title="거리">
          <Row wrap>
            {(Object.keys(CATEGORY_LABELS) as DistanceCategory[]).map((cat) => (
              <Chip
                key={cat}
                testID={`filter-cat-${cat}`}
                label={CATEGORY_LABELS[cat]}
                selected={draft.category.includes(cat)}
                onPress={() => setDraft({ ...draft, category: toggle(draft.category, cat) })}
              />
            ))}
          </Row>
        </Section>
        <Section title="접수 상태">
          <Row wrap>
            {(Object.keys(REG_STATE_LABEL) as RegistrationStateFilter[]).map((s) => (
              <Chip
                key={s}
                label={REG_STATE_LABEL[s]}
                selected={draft.registrationState.includes(s)}
                onPress={() =>
                  setDraft({ ...draft, registrationState: toggle(draft.registrationState, s) })
                }
              />
            ))}
          </Row>
        </Section>
        <Section title="참가비">
          <Row wrap>
            {(Object.keys(FEE_LABEL) as FeeBucket[]).map((f) => (
              <Chip
                key={f}
                label={FEE_LABEL[f]}
                selected={draft.fee.includes(f)}
                onPress={() => setDraft({ ...draft, fee: toggle(draft.fee, f) })}
              />
            ))}
          </Row>
        </Section>
        <Section title="기타">
          <Row wrap>
            <Chip
              label="종료 포함"
              selected={draft.includeEnded}
              onPress={() => setDraft({ ...draft, includeEnded: !draft.includeEnded })}
            />
            <Chip
              label="취소 대회 숨기기"
              selected={draft.hideCancelled}
              onPress={() => setDraft({ ...draft, hideCancelled: !draft.hideCancelled })}
            />
          </Row>
          <T variant="caption" muted>
            캘린더는 지난 날짜도 함께 보여요
          </T>
        </Section>
      </Screen>
    </>
  );
}
