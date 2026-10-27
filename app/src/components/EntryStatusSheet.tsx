import type { EntryStatus, EntryStatusSource } from '@berun/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { saveErrorMessage } from '../api/messages';
import { ENTRY_STATUS_LABEL } from '../features/race';
import { savePromptSettled } from '../features/returnPrompt';
import { toast } from '../stores/toast';
import { Notice, RadioRow, Sheet } from './ui';
import { useConfirm } from './useConfirm';
import { analytics } from '../lib/analyticsClient';

const STATUSES: EntryStatus[] = ['not_registered', 'registered', 'missed'];

export function invalidateRegistrationQueries(
  qc: ReturnType<typeof useQueryClient>,
  raceId: string,
) {
  for (const key of [['race', raceId], ['home'], ['my-races'], ['me'], ['races']]) {
    void qc.invalidateQueries({ queryKey: key });
  }
}

/**
 * 접수 상태 선택 시트 (PRD 4.10.1): 3개 라디오, 현재 값 선택됨 → 즉시 저장 + 토스트.
 * '접수 못 함'이면 "이번 대회는 참가 예정에서 뺄까요?" → [참가 예정 해제]면 DELETE.
 * 직접 바꾸면 그 대회는 복귀 질문을 더 하지 않는다.
 */
export function EntryStatusSheet({
  target,
  source,
  onClose,
}: {
  target: {
    raceId: string;
    registrationId: string;
    entryStatus: EntryStatus;
    lottery: boolean;
  } | null;
  source: Extract<EntryStatusSource, 'race_detail' | 'my_races'>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [dialog, confirm] = useConfirm();

  const choose = async (status: EntryStatus) => {
    if (!target || saving) return;
    if (status === target.entryStatus) return onClose();
    setSaving(true);
    try {
      await api.updateRegistration(target.registrationId, {
        entryStatus: status,
        entryStatusSource: source,
      });
      await savePromptSettled(target.raceId);
      analytics.track('entry_status_changed', {
        race_id: target.raceId,
        from: target.entryStatus,
        to: status,
        source,
      });
      toast('접수 상태를 바꿨어요');
      onClose();
      if (status === 'missed') {
        const remove = await confirm({
          message: '이번 대회는 참가 예정에서 뺄까요?',
          confirmLabel: '참가 예정 해제',
          cancelLabel: '그대로 두기',
        });
        if (remove) {
          await api.deleteRegistration(target.registrationId);
          analytics.track('registration_cancelled', { race_id: target.raceId });
          toast('참가 예정을 해제했어요');
        }
      }
    } catch (e) {
      toast(saveErrorMessage(e));
    } finally {
      setSaving(false);
      invalidateRegistrationQueries(qc, target.raceId);
    }
  };

  return (
    <>
      <Sheet
        visible={target !== null}
        onClose={onClose}
        title="접수 상태"
        testID="entry-status-sheet"
      >
        {target?.lottery ? (
          <Notice>
            추첨 대회는 신청을 마쳤으면 접수 완료, 떨어졌으면 접수 못 함으로 바꿔주세요
          </Notice>
        ) : null}
        {STATUSES.map((s) => (
          <RadioRow
            key={s}
            testID={`entry-${s}`}
            label={ENTRY_STATUS_LABEL[s]}
            selected={target?.entryStatus === s}
            disabled={saving}
            onPress={() => void choose(s)}
          />
        ))}
      </Sheet>
      {dialog}
    </>
  );
}
