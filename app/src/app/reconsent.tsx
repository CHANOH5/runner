import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { api } from '../api';
import { saveErrorMessage } from '../api/messages';
import { TERMS_LABEL } from '../components/terms';
import {
  Button,
  CheckRow,
  Dialog,
  ErrorState,
  LinkText,
  Notice,
  Screen,
  SkeletonCards,
  T,
  TopBar,
} from '../components/ui';
import { openInAppBrowser } from '../lib/external';
import { useSession } from '../stores/session';
import { toast } from '../stores/toast';

/** 약관 재동의 (PRD 4.2) — S-003과 같은 레이아웃, 변경된 항목만. 동의 전에는 다른 화면으로 갈 수 없다 */
export default function Reconsent() {
  const router = useRouter();
  const qc = useQueryClient();
  const setGate = useSession((s) => s.setGate);
  const reactivated = useSession((s) => s.reactivated);
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [refusing, setRefusing] = useState(false);
  const [saving, setSaving] = useState(false);

  const pending = me.data?.pendingTerms ?? [];
  const allChecked = pending.length > 0 && pending.every((t) => checked.has(t.id));

  const agree = async () => {
    setSaving(true);
    try {
      await api.agreeConsents([...checked]);
      setGate(null);
      await qc.invalidateQueries({ queryKey: ['me'] });
      router.replace(reactivated ? '/reactivated' : '/home');
    } catch (e) {
      toast(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <TopBar title="약관 동의" />
      <Screen
        footer={
          <>
            <Button
              testID="reconsent-agree"
              label="동의하고 계속하기"
              disabled={!allChecked}
              loading={saving}
              onPress={() => void agree()}
            />
            <Button kind="ghost" label="동의하지 않음" onPress={() => setRefusing(true)} />
          </>
        }
      >
        <T variant="title">약관이 변경되었어요</T>
        {me.isPending ? (
          <SkeletonCards count={2} height={44} />
        ) : me.isError ? (
          <ErrorState
            compact
            message="약관을 불러오지 못했어요"
            onRetry={() => void me.refetch()}
          />
        ) : (
          pending.map((t) => {
            const label = TERMS_LABEL[t.kind as keyof typeof TERMS_LABEL] ?? t.kind;
            return (
              <Notice key={t.id}>
                <CheckRow
                  label={`[필수] ${label} (${t.version})`}
                  checked={checked.has(t.id)}
                  onToggle={() =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (next.has(t.id)) next.delete(t.id);
                      else next.add(t.id);
                      return next;
                    })
                  }
                  right={
                    <LinkText label="보기" onPress={() => void openInAppBrowser(t.contentUrl)} />
                  }
                />
                {t.summary ? (
                  <T variant="caption" muted>
                    주요 변경: {t.summary}
                  </T>
                ) : null}
              </Notice>
            );
          })
        )}
      </Screen>
      <Dialog
        visible={refusing}
        message="동의하지 않으면 서비스를 이용할 수 없어요. 탈퇴하시겠어요?"
        confirmLabel="탈퇴 안내 보기"
        cancelLabel="돌아가기"
        onConfirm={() => {
          setRefusing(false);
          router.push('/my/delete-account');
        }}
        onCancel={() => setRefusing(false)}
      />
    </>
  );
}
