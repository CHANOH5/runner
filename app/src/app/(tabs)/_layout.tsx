import { Tabs } from 'expo-router/js-tabs';
import { Text, type ColorValue } from 'react-native';
import { useTheme } from '../../theme';

const icon = (glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;
  };

/** 하단 탭 4개: 홈 / 대회 / 기록 / 마이 (D-012). 라이브 탭은 Phase 3 */
export default function TabsLayout() {
  const c = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.subtext,
        tabBarStyle: { backgroundColor: c.bg, borderTopColor: c.border },
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.text,
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: '홈', headerShown: false, tabBarIcon: icon('⌂') }}
      />
      <Tabs.Screen name="races" options={{ title: '대회', tabBarIcon: icon('◎') }} />
      <Tabs.Screen name="records" options={{ title: '기록', tabBarIcon: icon('▤') }} />
      <Tabs.Screen name="my" options={{ title: '마이', tabBarIcon: icon('☺') }} />
    </Tabs>
  );
}
