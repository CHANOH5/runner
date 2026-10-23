import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { api } from '../api';
import {
  Button,
  CheckRow,
  Dialog,
  Divider,
  ErrorState,
  LinkText,
  Screen,
  SkeletonCards,
  T,
  TopBar,
} from '../components/ui';
import { openInAppBrowser } from '../lib/external';
import { PrivacySummary, TERMS_LABEL } from '../components/terms';
import { useSession } from '../stores/session';

const KIND_ORDER = ['service', 'privacy', 'marketing'];

/** S-003 약관 동의 (PRD 4.2, 6.3). 동의 저장은 S-004 완료 시 가입 요청에 함께 보낸다 */
export default function Terms() {
  const router = useRouter();
  const signup = useSession((s) => s.signup);
  const setSignup = useSession((s) => s.setSignup);
  const [checked, setChecked] = useState<Set<string>>(new Set(signup?.agreedTermIds ?? []));
  const [leaving, setLeaving] = useState(false);
  const terms = useQuery({ queryKey: ['terms'], queryFn: api.terms });

  const items = useMemo(
    () =>
      (terms.data ?? [])
        .filter((t) => t.kind in TERMS_LABEL)
        .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)),
    [terms.data],
  );
  const allChecked = items.length > 0 && items.every((t) => checked.has(t.id));
  const requiredOk = items.filter((t) => t.required).every((t) => checked.has(t.id));

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const abort = async () => {
    setLeaving(false);
    if (signup) await api.signupAbort(signup.token).catch(() => undefined);
    setSignup(null);
    router.replace('/login');
  };

  const next = () => {
    if (!signup) return router.replace('/login');
    const marketing = items.some((t) => t.kind === 'marketing' && checked.has(t.id));
    setSignup({ ...signup, agreedTermIds: [...checked], marketing });
    router.push('/profile-setup');
  };

  const privacy = items.find((t) => t.kind === 'privacy');

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <TopBar onBack={() => setLeaving(true)} />
      <Screen
        footer={<Button testID="terms-next" label="다음" disabled={!requiredOk} onPress={next} />}
      >
        <T variant="title">서비스 이용을 위해 동의해주세요</T>
        {terms.isPending ? (
          <SkeletonCards count={3} height={44} />
        ) : terms.isError ? (
          <ErrorState
            compact
            message="약관을 불러오지 못했어요"
            onRetry={() => void terms.refetch()}
          />
        ) : (
          <>
            <CheckRow
              testID="terms-all"
              strong
              label="전체 동의"
              checked={allChecked}
              onToggle={() => setChecked(allChecked ? new Set() : new Set(items.map((t) => t.id)))}
            />
            <Divider />
            {items.map((t) => (
              <CheckRow
                key={t.id}
                testID={`terms-${t.kind}`}
                label={`${t.required ? '[필수]' : '[선택]'} ${TERMS_LABEL[t.kind]}`}
                checked={checked.has(t.id)}
                onToggle={() => toggle(t.id)}
                right={
                  <LinkText label="보기" onPress={() => void openInAppBrowser(t.contentUrl)} />
                }
              />
            ))}
            <PrivacySummary />
            {privacy ? (
              <LinkText
                label="개인정보 처리방침 보기"
                onPress={() => void openInAppBrowser(privacy.contentUrl)}
              />
            ) : null}
          </>
        )}
      </Screen>
      <Dialog
        visible={leaving}
        message="가입을 그만둘까요?"
        confirmLabel="그만두기"
        cancelLabel="계속하기"
        onConfirm={() => void abort()}
        onCancel={() => setLeaving(false)}
      />
    </>
  );
}
