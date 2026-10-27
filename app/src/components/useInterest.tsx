import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { isApiError } from '../api/client';
import { errorMessage } from '../api/messages';
import { toast } from '../stores/toast';
import { PushPermissionSheet, shouldShowPushSheet } from './PushPrompt';
import { useConfirm } from './useConfirm';

/**
 * 관심 대회 토글 (F-013, PRD 4.8): 낙관적 업데이트 → 실패하면 되돌리고 토스트.
 * 참가 예정인 대회의 관심을 끄려면 확인. 알림 권한 미결정이면 처음 켤 때 권한 안내 시트 1회.
 */
export function useInterest(race: {
  id: string;
  my: { interested: boolean; registered: boolean };
}) {
  const qc = useQueryClient();
  const [interested, setInterested] = useState(race.my.interested);
  const [busy, setBusy] = useState(false);
  const [pushSheet, setPushSheet] = useState(false);
  const [dialog, confirm] = useConfirm();

  useEffect(() => setInterested(race.my.interested), [race.my.interested]);

  const refresh = () => {
    for (const key of [['races'], ['race', race.id], ['home'], ['my-races'], ['me']]) {
      void qc.invalidateQueries({ queryKey: key });
    }
  };

  const toggle = async () => {
    if (busy) return;
    const next = !interested;
    if (!next && race.my.registered) {
      const ok = await confirm({
        message: '참가 예정인 대회예요. 관심을 해제해도 참가 예정은 유지돼요.',
        confirmLabel: '해제',
      });
      if (!ok) return;
    }
    setInterested(next);
    setBusy(true);
    try {
      if (next) {
        const res = await api.interestOn(race.id);
        toast(
          res.notifyRegistrationOpen
            ? '관심 대회에 추가했어요. 접수 오픈 전에 알려드릴게요'
            : '관심 대회에 추가했어요',
        );
        if (await shouldShowPushSheet()) setPushSheet(true);
      } else {
        await api.interestOff(race.id);
      }
      refresh();
    } catch (e) {
      setInterested(!next);
      toast(isApiError(e) && e.code === 'LIMIT_EXCEEDED' ? errorMessage(e) : '저장하지 못했어요');
    } finally {
      setBusy(false);
    }
  };

  const elements = (
    <>
      {dialog}
      <PushPermissionSheet visible={pushSheet} onClose={() => setPushSheet(false)} />
    </>
  );
  return { interested, toggle, elements };
}
