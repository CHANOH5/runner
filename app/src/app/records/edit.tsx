import type { RunRecord } from '@berun/shared';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { saveErrorMessage } from '../../api/messages';
import { api } from '../../api';
import { RecordForm } from '../../components/RecordForm';
import { Button, EmptyState, LinkText, Screen, TopBar } from '../../components/ui';
import { useConfirm } from '../../components/useConfirm';
import { emptyRecordForm, recordToForm, validateRecordForm } from '../../features/recordForm';
import { RECORD_RELATED_KEYS, saveRecordWithDuplicateCheck } from '../../features/records';
import { todayKst } from '../../lib/format';
import { toast } from '../../stores/toast';
import { useTheme } from '../../theme';
import { goBack } from '../../lib/nav';
import { analytics } from '../../lib/analyticsClient';

/** S-031 기록 추가/수정 (PRD 4.4, 6.15). 수정할 기록은 S-030 목록 캐시에서 찾는다 (단건 조회 API 없음) */
export default function RecordEdit() {
  const { id } = useLocalSearchParams<{ id?: string; returnTo?: string }>();
  const qc = useQueryClient();
  const record = useMemo(() => {
    if (!id) return null;
    const data = qc.getQueryData<InfiniteData<{ items: RunRecord[] }>>(['records', 'list']);
    return data?.pages.flatMap((p) => p.items).find((r) => r.id === id) ?? null;
  }, [id, qc]);
  if (id && !record) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <TopBar title="기록 수정" />
        <EmptyState message="삭제되었거나 찾을 수 없는 정보예요" />
      </>
    );
  }
  return <Editor record={record} />;
}

function Editor({ record }: { record: RunRecord | null }) {
  const qc = useQueryClient();
  const c = useTheme();
  const today = todayKst();
  const [form, setForm] = useState(record ? recordToForm(record) : emptyRecordForm(today));
  const [touched, setTouched] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dialog, confirm] = useConfirm();
  const { errors, values } = validateRecordForm(form, today);

  const refresh = () => {
    for (const key of [...RECORD_RELATED_KEYS, ['preview']])
      void qc.invalidateQueries({ queryKey: key });
  };

  const back = async () => {
    if (dirty && !(await confirm({ message: '작성 중인 내용이 사라져요', confirmLabel: '나가기' })))
      return;
    goBack();
  };

  const save = async () => {
    setTouched(true);
    if (!values) return;
    setSaving(true);
    try {
      const saved = await saveRecordWithDuplicateCheck(
        values,
        () =>
          confirm({ message: '같은 기록이 이미 있어요. 그래도 저장할까요?', confirmLabel: '저장' }),
        record?.id,
      );
      if (!saved) return;
      analytics.track('record_saved', {
        distance_category: saved.category,
        kind: saved.kind,
        is_edit: !!record,
        source: 'records',
      });
      refresh();
      goBack();
      toast('저장했어요');
    } catch (e) {
      toast(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!record) return;
    if (!(await confirm({ message: '이 기록을 삭제할까요?', confirmLabel: '삭제', danger: true })))
      return;
    try {
      await api.deleteRecord(record.id);
      refresh();
      goBack();
      toast('삭제했어요');
    } catch (e) {
      toast(saveErrorMessage(e));
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <TopBar title={record ? '기록 수정' : '기록 추가'} onBack={() => void back()} />
      <Screen
        footer={
          <Button
            testID="record-save"
            label="저장"
            loading={saving}
            disabled={touched && !values}
            onPress={() => void save()}
          />
        }
      >
        <RecordForm
          value={form}
          onChange={(v) => {
            setForm(v);
            setDirty(true);
          }}
          errors={errors}
          today={today}
          showErrors={touched}
        />
        {record ? (
          <LinkText
            testID="record-delete"
            label="기록 삭제"
            color={c.red}
            onPress={() => void remove()}
          />
        ) : null}
      </Screen>
      {dialog}
    </>
  );
}
