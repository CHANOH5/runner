import type { DistanceCategory, RunKind } from '@berun/shared';
import { View } from 'react-native';
import type { RecordFormErrors, RecordFormState } from '../features/recordForm';
import { addDaysKst, CATEGORY_LABELS } from '../lib/format';
import { Chip, DurationInput, Field, Input, Row, Segmented } from './ui';

const CATEGORIES: DistanceCategory[] = ['5k', '10k', 'half', 'full', 'other'];

/** 기록 입력 항목 (PRD 4.4). 오류는 입력을 건드린 뒤에만 보여준다(touched) */
export function RecordForm({
  value,
  onChange,
  errors,
  today,
  showErrors,
  testID = 'record',
}: {
  value: RecordFormState;
  onChange: (v: RecordFormState) => void;
  errors: RecordFormErrors;
  today: string;
  showErrors: boolean;
  testID?: string;
}) {
  const err = (k: keyof RecordFormErrors) => (showErrors ? (errors[k] ?? null) : null);
  return (
    <View style={{ gap: 14 }}>
      <Field label="거리" error={err('distance')}>
        <Row wrap>
          {CATEGORIES.map((c) => (
            <Chip
              key={c}
              testID={`${testID}-cat-${c}`}
              label={CATEGORY_LABELS[c]}
              selected={value.category === c}
              onPress={() => onChange({ ...value, category: c })}
            />
          ))}
        </Row>
        {value.category === 'other' ? (
          <Row gap={6}>
            <Input
              testID={`${testID}-other-km`}
              value={value.otherKm}
              onChangeText={(t) =>
                onChange({ ...value, otherKm: t.replace(/[^\d.]/g, '').slice(0, 5) })
              }
              keyboardType="decimal-pad"
              placeholder="12.5"
              style={{ flex: 1 }}
            />
          </Row>
        ) : null}
      </Field>
      <Field label="기록" error={err('duration')}>
        <DurationInput
          testID={`${testID}-duration`}
          value={value.duration}
          onChange={(duration) => onChange({ ...value, duration })}
          invalid={!!err('duration')}
        />
      </Field>
      <Field label="날짜" error={err('runDate')}>
        <Input
          testID={`${testID}-date`}
          value={value.runDate}
          onChangeText={(t) => onChange({ ...value, runDate: t.slice(0, 10) })}
          placeholder="YYYY-MM-DD"
          maxLength={10}
          invalid={!!err('runDate')}
        />
        <Row>
          <Chip label="오늘" onPress={() => onChange({ ...value, runDate: today })} />
          <Chip
            label="어제"
            onPress={() => onChange({ ...value, runDate: addDaysKst(today, -1) })}
          />
        </Row>
      </Field>
      <Field label="구분">
        <Segmented<RunKind>
          options={[
            { value: 'race', label: '대회' },
            { value: 'training', label: '개인 훈련' },
          ]}
          value={value.kind}
          onChange={(kind) => onChange({ ...value, kind })}
        />
      </Field>
      <Field label="제목 (선택)" error={err('title')}>
        <Input
          testID={`${testID}-title`}
          value={value.title}
          onChangeText={(title) => onChange({ ...value, title })}
          placeholder="예: 2026 JTBC 마라톤"
          maxLength={60}
        />
      </Field>
    </View>
  );
}
