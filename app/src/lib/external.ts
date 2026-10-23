import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

/**
 * 외부 링크는 인앱 브라우저로 연다 (PRD 3.6: iOS SFSafariViewController, Android Custom Tabs).
 * 웹(로컬 확인용)은 새 탭으로 연다.
 */
export const openInAppBrowser = (url: string) => WebBrowser.openBrowserAsync(url);

/**
 * 인앱 브라우저를 열고 닫고 돌아온 순간 onReturn(머문 시간 ms)을 부른다 — 복귀 질문용 (PRD 4.10.1).
 * - iOS: openBrowserAsync가 닫힐 때 끝난다
 * - Android: Custom Tabs는 바로 끝나므로 앱이 다시 active가 되는 순간
 * - 웹: 새 탭에서 돌아와 창이 다시 보이거나(focus·visibility) 활성화되는 순간
 */
export function useExternalLinkReturn(onReturn: (stayMs: number) => void) {
  const openedAt = useRef<number | null>(null);
  const callback = useRef(onReturn);
  useEffect(() => {
    callback.current = onReturn;
  }, [onReturn]);

  const finish = useCallback(() => {
    const t = openedAt.current;
    if (t === null) return;
    openedAt.current = null;
    callback.current(Date.now() - t);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') finish();
    });
    let removeFocus: (() => void) | undefined;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const onFocus = () => finish();
      window.addEventListener('focus', onFocus);
      removeFocus = () => window.removeEventListener('focus', onFocus);
    }
    return () => {
      sub.remove();
      removeFocus?.();
    };
  }, [finish]);

  return useCallback(
    async (url: string) => {
      openedAt.current = Date.now();
      const res = await WebBrowser.openBrowserAsync(url);
      if (
        Platform.OS === 'ios' &&
        (res.type === WebBrowser.WebBrowserResultType.CANCEL ||
          res.type === WebBrowser.WebBrowserResultType.DISMISS)
      ) {
        finish();
      }
    },
    [finish],
  );
}
