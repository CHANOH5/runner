import { Pressable, View } from 'react-native';
import { useTheme } from '../../theme';
import { T } from '../ui';

/**
 * 지도 래퍼 (D-008, tech/03 6장). 화면은 지도 SDK를 직접 import하지 않고 이 컴포넌트만 쓴다.
 * D-008(네이버 지도) 최종 확정 전이라 지금은 **자리 표시**만 그린다. SDK를 붙일 때 이 파일 구현만 바꾼다
 * (네이버: @mj-studio/react-native-naver-map + config plugin, Development Build 필요).
 * Phase 1 규칙: 미니 지도는 제스처 비활성, 내 위치 표시 없음, 다크 모드에서도 밝은 지도 (PRD 4.7).
 */
export type MapViewProps = {
  lat: number;
  lng: number;
  /** 마커 위 말풍선 (장소명) */
  label: string | null;
  height?: number;
  onPress?: () => void;
  testID?: string;
};

export function MapView({ label, height = 180, onPress, testID }: MapViewProps) {
  const c = useTheme();
  return (
    <Pressable
      testID={testID ?? 'map-placeholder'}
      disabled={!onPress}
      onPress={onPress}
      accessibilityLabel={`대회장 지도: ${label ?? '대회장'}`}
      style={{
        height,
        borderRadius: 12,
        backgroundColor: '#E8EDE6',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        borderWidth: 1,
        borderColor: c.border,
      }}
    >
      <View
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 4,
        }}
      >
        <T variant="caption" color="#111827">
          {label ?? '대회장'}
        </T>
      </View>
      <T variant="h2" color="#F2581C">
        ●
      </T>
      <T variant="small" color="#4B5563">
        지도 준비 중 (D-008 확정 후 네이버 지도)
      </T>
    </Pressable>
  );
}
