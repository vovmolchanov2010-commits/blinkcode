import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { toLocationPoint } from '../lib/format';
import { api, loadServerUrl } from './client';

export const LOCATION_TASK = 'blink-location-updates';

/**
 * Фоновая задача должна быть объявлена при загрузке модуля, а не в компоненте:
 * когда система будит приложение в фоне, экраны не монтируются.
 */
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  // В фоне приложение может стартовать без экранов — адрес сервера загружаем здесь.
  await loadServerUrl();
  if (!(await api.hasSession())) return;
  try {
    await api.sendLocation(data.locations.slice(-100).map((l) => toLocationPoint(l)));
  } catch {
    // Нет сети — следующая пачка принесёт более свежую позицию, старые точки не нужны.
  }
});

export type LocationPermission = 'denied' | 'foreground' | 'background';

export async function getLocationPermission(): Promise<LocationPermission> {
  const foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted) return 'denied';
  const background = await Location.getBackgroundPermissionsAsync();
  return background.granted ? 'background' : 'foreground';
}

/**
 * Запрашивает разрешения по шагам: сначала «при использовании», затем «всегда».
 * Системы показывают второй запрос только после первого.
 */
export async function requestLocationPermission(): Promise<LocationPermission> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) return 'denied';
  const background = await Location.requestBackgroundPermissionsAsync();
  return background.granted ? 'background' : 'foreground';
}

const SHARING_PREF_KEY = 'blink.sharing';

/** Выключал ли пользователь геолокацию сам — тогда не включаем её автоматически при запуске. */
export async function isSharingDisabledByUser(): Promise<boolean> {
  return (await SecureStore.getItemAsync(SHARING_PREF_KEY)) === 'off';
}

export async function setSharingDisabledByUser(disabled: boolean): Promise<void> {
  if (disabled) await SecureStore.setItemAsync(SHARING_PREF_KEY, 'off');
  else await SecureStore.deleteItemAsync(SHARING_PREF_KEY);
}

export function isSharingLocation(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
}

/**
 * Обычный режим из architecture.md: обновление при смещении на 50 м и не чаще
 * раза в минуту; на iOS система сама притормаживает обновления на месте.
 */
export async function startSharingLocation(): Promise<void> {
  if (await isSharingLocation()) return;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    distanceInterval: 50,
    timeInterval: 60_000,
    deferredUpdatesInterval: 60_000,
    pausesUpdatesAutomatically: true,
    activityType: Location.ActivityType.Other,
    showsBackgroundLocationIndicator: false,
    foregroundService: {
      notificationTitle: 'Blink делится геолокацией',
      notificationBody: 'Друзья видят тебя на карте. Выключить — в профиле.',
      killServiceOnDestroy: false,
    },
  });
}

export async function stopSharingLocation(): Promise<void> {
  if (await isSharingLocation()) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}

/** Разовая свежая позиция — при открытии приложения, чтобы друзья сразу видели актуальную точку. */
export async function sendCurrentLocation(): Promise<Location.LocationObject | null> {
  const permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted) return null;
  const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  await api.sendLocation([toLocationPoint(location)]).catch(() => {});
  return location;
}
