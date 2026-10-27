import { addDaysKst } from '../lib/format';
import { Chip, Row } from './ui';

export type DateFieldProps = {
  value: string;
  onChange: (date: string) => void;
  /** 오늘(KST) — 이후 날짜는 고를 수 없다 */
  today: string;
  invalid?: boolean;
  testID?: string;
};

/** 빠른 선택 칩 [오늘] [어제] (PRD v1.11 4.4, 네이티브·웹 공통) */
export function QuickDateChips({ today, onChange }: Pick<DateFieldProps, 'today' | 'onChange'>) {
  return (
    <Row>
      <Chip label="오늘" onPress={() => onChange(today)} />
      <Chip label="어제" onPress={() => onChange(addDaysKst(today, -1))} />
    </Row>
  );
}
