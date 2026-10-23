import type { TermsKind } from '@berun/shared';
import { View } from 'react-native';
import { useTheme } from '../theme';
import { T } from './ui';

export const TERMS_LABEL: Record<TermsKind, string> = {
  service: '서비스 이용약관',
  privacy: '개인정보 수집·이용 동의',
  marketing: '마케팅 정보 수신 동의 (앱 푸시)',
};

/** 개인정보 수집 요약 표 (PRD 6.3) */
export function PrivacySummary() {
  const c = useTheme();
  const rows = [
    ['항목', '소셜 계정 식별자, 이메일(선택), 닉네임, 출생연도, 지역, 성별(선택), 러닝 기록'],
    ['목적', '회원 관리, 대회 추천·알림, 기록 예측'],
    ['보존', '탈퇴 시까지'],
  ];
  return (
    <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 10 }}>
      {rows.map(([k, v], i) => (
        <View
          key={k}
          style={{
            flexDirection: 'row',
            padding: 10,
            gap: 10,
            borderTopWidth: i === 0 ? 0 : 1,
            borderTopColor: c.border,
          }}
        >
          <T variant="caption" style={{ width: 40, fontWeight: '600' }}>
            {k}
          </T>
          <T variant="caption" muted style={{ flex: 1 }}>
            {v}
          </T>
        </View>
      ))}
    </View>
  );
}
