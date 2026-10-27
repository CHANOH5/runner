import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { RECORD_MIN_DATE } from '@berun/shared';
import { useState } from 'react';
import { Platform } from 'react-native';
import { formatDate } from '../lib/format';
import { Button, Row, SelectBox, Sheet } from './ui';
import { QuickDateChips, type DateFieldProps } from './dateFieldShared';

const pad = (n: number) => String(n).padStart(2, '0');
/** `YYYY-MM-DD` ↔ 기기 시간대의 그날 0시 (피커는 기기 시간대로 동작한다) */
export const toPickerDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
};
export const fromPickerDate = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * 날짜 선택 — 네이티브: 달력 피커(미래·1990년 이전 비활성) + [오늘]·[어제] (PRD v1.11 4.4).
 * 웹 미리보기는 DateField.web.tsx (직접 입력).
 */
export function DateField({ value, onChange, today, testID = 'date' }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const picker = (onPick: (e: DateTimePickerEvent, d?: Date) => void) => (
    <DateTimePicker
      testID={`${testID}-picker`}
      mode="date"
      value={toPickerDate(valid ? value : today)}
      maximumDate={toPickerDate(today)}
      minimumDate={toPickerDate(RECORD_MIN_DATE)}
      display={Platform.OS === 'ios' ? 'inline' : 'default'}
      onChange={onPick}
    />
  );
  return (
    <>
      <SelectBox
        testID={testID}
        label={valid ? formatDate(value) : null}
        placeholder="날짜 선택"
        onPress={() => setOpen(true)}
      />
      <QuickDateChips today={today} onChange={onChange} />
      {Platform.OS === 'android' ? (
        open ? (
          picker((e, d) => {
            setOpen(false);
            if (e.type === 'set' && d) onChange(fromPickerDate(d));
          })
        ) : null
      ) : (
        <Sheet visible={open} onClose={() => setOpen(false)} title="날짜">
          {picker((_e, d) => {
            if (d) onChange(fromPickerDate(d));
          })}
          <Row>
            <Button label="완료" onPress={() => setOpen(false)} style={{ flex: 1 }} />
          </Row>
        </Sheet>
      )}
    </>
  );
}
