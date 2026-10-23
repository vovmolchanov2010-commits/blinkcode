import { isRunningInExpoGo } from 'expo';

export type { LatLng, MapViewRef, Region } from './types';

/**
 * Реализация выбирается при запуске: в Expo Go нет нативного MapLibre, поэтому там
 * react-native-maps; в установленном приложении — MapLibre (без ключа Google, иначе Android падает).
 * require внутри условия — чтобы модуль другой реализации даже не загружался.
 */
const impl: typeof import('./maplibre') = isRunningInExpoGo() ? require('./expo-go') : require('./maplibre');

export const { MapView, Marker, Polyline, Circle } = impl;
