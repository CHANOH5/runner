import type { Prediction } from '@berun/shared';
import { create } from 'zustand';

/** S-023 예측 카드의 "자세히" → S-033 미리보기 (저장하지 않은 preview 결과를 화면 사이에 넘긴다) */
export const usePreviewPrediction = create<{
  prediction: Prediction | null;
  set: (p: Prediction | null) => void;
}>((set) => ({ prediction: null, set: (prediction) => set({ prediction }) }));
