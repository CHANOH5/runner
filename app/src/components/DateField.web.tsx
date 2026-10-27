import { QuickDateChips, type DateFieldProps } from './dateFieldShared';
import { Input } from './ui';

/** 웹 미리보기 전용: `YYYY-MM-DD` 직접 입력 + [오늘]·[어제] (PRD v1.11 4.4). 범위 검사는 recordForm이 한다 */
export function DateField({ value, onChange, today, invalid, testID = 'date' }: DateFieldProps) {
  return (
    <>
      <Input
        testID={testID}
        value={value}
        onChangeText={(t) => onChange(t.slice(0, 10))}
        placeholder="YYYY-MM-DD"
        maxLength={10}
        invalid={invalid}
      />
      <QuickDateChips today={today} onChange={onChange} />
    </>
  );
}
