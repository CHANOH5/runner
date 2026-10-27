import { create } from 'zustand';

export type ToastAction = { label: string; onPress: () => void };

type ToastState = {
  message: string | null;
  action: ToastAction | null;
  /** 보이는 시간 (ms) */
  duration: number;
  seq: number;
  show: (message: string, opts?: { action?: ToastAction; duration?: number }) => void;
  hide: () => void;
};

export const TOAST_MS = 2600;

export const useToast = create<ToastState>((set) => ({
  message: null,
  action: null,
  duration: TOAST_MS,
  seq: 0,
  show: (message, opts) =>
    set((s) => ({
      message,
      action: opts?.action ?? null,
      duration: opts?.duration ?? TOAST_MS,
      seq: s.seq + 1,
    })),
  hide: () => set({ message: null, action: null }),
}));

/** 컴포넌트 밖(API 콜백 등)에서 토스트. action이 있으면 버튼을 함께 (예: [되돌리기]) */
export const toast = (message: string, opts?: { action?: ToastAction; duration?: number }) =>
  useToast.getState().show(message, opts);
