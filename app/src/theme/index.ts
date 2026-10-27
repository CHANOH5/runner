import { useColorScheme } from 'react-native';

/** 라이트·다크 팔레트 (tech/01 "다크 모드 지원"). 디자인 시스템 확정 전 임시값 (tech/02 앱 UI [미정]) */
const light = {
  bg: '#FFFFFF',
  surface: '#F4F5F7',
  surfaceStrong: '#E9EBEF',
  text: '#111827',
  subtext: '#6B7280',
  border: '#E5E7EB',
  primary: '#F2581C',
  primaryText: '#FFFFFF',
  primarySoft: '#FDE8DE',
  green: '#15803D',
  greenSoft: '#DCFCE7',
  blue: '#1D4ED8',
  blueSoft: '#DBEAFE',
  yellow: '#A16207',
  yellowSoft: '#FEF3C7',
  red: '#DC2626',
  redSoft: '#FEE2E2',
  gray: '#6B7280',
  graySoft: '#F3F4F6',
  overlay: 'rgba(0,0,0,0.4)',
};

export type Palette = typeof light;

const dark: Palette = {
  bg: '#0E1013',
  surface: '#181B20',
  surfaceStrong: '#22262D',
  text: '#F3F4F6',
  subtext: '#9CA3AF',
  border: '#2B3038',
  primary: '#FF6A2E',
  primaryText: '#FFFFFF',
  primarySoft: '#3A2117',
  green: '#4ADE80',
  greenSoft: '#14301E',
  blue: '#93C5FD',
  blueSoft: '#172A46',
  yellow: '#FCD34D',
  yellowSoft: '#3A2F10',
  red: '#F87171',
  redSoft: '#3B1717',
  gray: '#9CA3AF',
  graySoft: '#23272E',
  overlay: 'rgba(0,0,0,0.6)',
};

export function useTheme(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export const palettes = { light, dark };
