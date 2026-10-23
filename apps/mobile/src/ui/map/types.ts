import type { ReactElement, ReactNode, Ref } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

// Общий API карты для экранов — подмножество react-native-maps: регион в градусах, маркеры, линии, круги.

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Region extends LatLng {
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface MapViewRef {
  animateToRegion(region: Region): void;
  fitToCoordinates(
    coordinates: LatLng[],
    options?: { edgePadding?: { top: number; right: number; bottom: number; left: number }; animated?: boolean },
  ): void;
}

export interface MapViewProps {
  ref?: Ref<MapViewRef>;
  style?: StyleProp<ViewStyle>;
  initialRegion?: Region;
  showsUserLocation?: boolean;
  onPress?: () => void;
  onRegionChangeComplete?: (center: LatLng) => void;
  children?: ReactNode;
}

export interface MarkerProps {
  coordinate: LatLng;
  onPress?: () => void;
  /** Без содержимого — обычная булавка. */
  children?: ReactElement;
}

export interface PolylineProps {
  coordinates: LatLng[];
  strokeColor: string;
  strokeWidth?: number;
  dashed?: boolean;
}

export interface CircleProps {
  /** Радиус в метрах. */
  center: LatLng;
  radius: number;
  strokeColor: string;
  fillColor: string;
}
