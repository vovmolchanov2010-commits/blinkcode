import { useImperativeHandle, useRef } from 'react';
import RNMapView, { Circle as RNCircle, Marker as RNMarker, Polyline as RNPolyline } from 'react-native-maps';
import type { CircleProps, MapViewProps, MarkerProps, PolylineProps } from './types';

/**
 * Карта для Expo Go: MapLibre в нём нет, а react-native-maps есть (с ключом Google от Expo).
 * В установленном APK используется maplibre.tsx — там ключ Google не нужен.
 */
export function MapView({ ref, style, initialRegion, showsUserLocation, onPress, onRegionChangeComplete, children }: MapViewProps) {
  const map = useRef<RNMapView>(null);
  useImperativeHandle(ref, () => ({
    animateToRegion: (region) => map.current?.animateToRegion(region),
    fitToCoordinates: (coordinates, options) => map.current?.fitToCoordinates(coordinates, options),
  }));
  return (
    <RNMapView
      ref={map}
      style={style}
      initialRegion={initialRegion}
      showsUserLocation={showsUserLocation}
      onPress={onPress}
      onRegionChangeComplete={(region) => onRegionChangeComplete?.(region)}
    >
      {children}
    </RNMapView>
  );
}

export function Marker({ coordinate, onPress, children }: MarkerProps) {
  return (
    <RNMarker
      coordinate={coordinate}
      tracksViewChanges={false}
      onPress={(event) => {
        event.stopPropagation();
        onPress?.();
      }}
    >
      {children}
    </RNMarker>
  );
}

export function Polyline({ coordinates, strokeColor, strokeWidth = 3, dashed = false }: PolylineProps) {
  return (
    <RNPolyline
      coordinates={coordinates}
      strokeColor={strokeColor}
      strokeWidth={strokeWidth}
      lineDashPattern={dashed ? [8, 6] : undefined}
    />
  );
}

export function Circle(props: CircleProps) {
  return <RNCircle {...props} />;
}
