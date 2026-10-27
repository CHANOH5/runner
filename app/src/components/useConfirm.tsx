import { useCallback, useRef, useState } from 'react';
import { Dialog } from './ui';

type Ask = {
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  title?: string;
  danger?: boolean;
};

/** 확인 다이얼로그를 Promise로 (Alert.alert는 웹에서 동작하지 않아 자체 Dialog를 쓴다) */
export function useConfirm() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback(
    (a: Ask) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setAsk(a);
      }),
    [],
  );

  const close = (ok: boolean) => {
    setAsk(null);
    resolver.current?.(ok);
    resolver.current = null;
  };

  const dialog = (
    <Dialog
      visible={ask !== null}
      title={ask?.title}
      message={ask?.message ?? ''}
      confirmLabel={ask?.confirmLabel ?? '확인'}
      cancelLabel={ask?.cancelLabel ?? '취소'}
      danger={ask?.danger}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  );
  return [dialog, confirm] as const;
}
