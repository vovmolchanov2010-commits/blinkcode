// Регистрирует фоновую задачу геолокации при загрузке бандла (до монтирования экранов).
import '../services/location';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../state/auth';
import { RealtimeProvider } from '../state/realtime';
import { colors } from '../ui/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <RealtimeProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </RealtimeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { state } = useAuth();

  if (state.status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const signedIn = state.status === 'signedIn';
  // Без ника друзья не смогут найти пользователя — сначала заполняем профиль.
  const needsProfile = signedIn && state.me !== null && !state.me.username;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={needsProfile}>
        <Stack.Screen name="setup" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !needsProfile}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="friend/[id]"
          options={{ headerShown: true, title: 'Друг', headerBackTitle: 'Назад', presentation: 'modal' }}
        />
      </Stack.Protected>
    </Stack>
  );
}
