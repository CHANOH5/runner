import { create } from 'zustand';

type ToastState = {
  message: string | null;
  seq: number;
  show: (message: string) => void;
  hide: () => void;
};

export const useToast = create<ToastState>((set) => ({
  message: null,
  seq: 0,
  show: (message) => set((s) => ({ message, seq: s.seq + 1 })),
  hide: () => set({ message: null }),
}));

/** 컴포넌트 밖(API 콜백 등)에서 토스트 */
export const toast = (message: string) => useToast.getState().show(message);
