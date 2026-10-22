import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { colors } from '../../ui/theme';

const icon = (emoji: string) =>
  function TabIcon({ focused }: { focused: boolean }) {
    return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>;
  };

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Карта', headerShown: false, tabBarIcon: icon('🗺️') }} />
      <Tabs.Screen name="friends" options={{ title: 'Друзья', tabBarIcon: icon('👥') }} />
      <Tabs.Screen name="profile" options={{ title: 'Профиль', tabBarIcon: icon('🙂') }} />
    </Tabs>
  );
}
