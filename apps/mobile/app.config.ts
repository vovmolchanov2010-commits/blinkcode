import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Blink',
  slug: 'blinkcode',
  scheme: 'blinkcode',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.blinkcode.app',
  },
  android: {
    package: 'com.blinkcode.app',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // Добавляются шаблоном по умолчанию, но приложению не нужны.
    blockedPermissions: ['android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE'],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-build-properties',
      // Разрешаем http: тестовый сервер в локальной сети работает без HTTPS.
      // Облачный сервер (deploy/yandex) отдаёт HTTPS.
      { android: { usesCleartextTraffic: true } },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Blink показывает тебя друзьям на карте. Точность для каждого друга настраивается.',
        locationAlwaysAndWhenInUsePermission:
          'Чтобы друзья видели тебя, даже когда приложение свёрнуто. Можно в любой момент включить режим «призрак».',
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    // Карта — MapLibre с тайлами OpenFreeMap, ключ не нужен (см. src/ui/map).
    '@maplibre/maplibre-react-native',
  ],
};

export default config;
