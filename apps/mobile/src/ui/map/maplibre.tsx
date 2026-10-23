import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map,
  Marker as MapLibreMarker,
  NativeUserLocation,
} from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Text } from 'react-native';

import type { CircleProps, LatLng, MapViewProps, MarkerProps, PolylineProps, Region } from './types';

/** Карта на MapLibre с тайлами без ключа (OpenFreeMap). Используется в установленном приложении. */
const MAP_STYLE = process.env.EXPO_PUBLIC_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/liberty';

const MOSCOW: Region = { latitude: 55.7558, longitude: 37.6173, latitudeDelta: 0.15, longitudeDelta: 0.15 };

/** Ширина видимой области в градусах → уровень приближения. */
function zoomFor(region: Region): number {
  return Math.max(1, Math.min(18, Math.log2(360 / Math.max(region.longitudeDelta, 0.0005))));
}

/** Нажатие на маркер не должно считаться нажатием на пустую карту. */
const MarkerPressContext = createContext<{ markerPressedAt: { current: number } }>({ markerPressedAt: { current: 0 } });

export function MapView({
  ref,
  style,
  initialRegion,
  showsUserLocation = false,
  onPress,
  onRegionChangeComplete,
  children,
}: MapViewProps) {
  const camera = useRef<CameraRef>(null);
  const markerPressedAt = useRef(0);
  const [locationAllowed, setLocationAllowed] = useState(false);
  const start = initialRegion ?? MOSCOW;

  // Точка «я» требует разрешения на геолокацию — без него не показываем.
  useEffect(() => {
    if (!showsUserLocation) return;
    let active = true;
    void Location.getForegroundPermissionsAsync()
      .then((permission) => active && setLocationAllowed(permission.granted))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [showsUserLocation]);

  useImperativeHandle(ref, () => ({
    animateToRegion(region) {
      camera.current?.easeTo({ center: [region.longitude, region.latitude], zoom: zoomFor(region), duration: 500 });
    },
    fitToCoordinates(coordinates, options) {
      if (coordinates.length === 0) return;
      const lats = coordinates.map((c) => c.latitude);
      const lngs = coordinates.map((c) => c.longitude);
      const [west, east, south, north] = [Math.min(...lngs), Math.max(...lngs), Math.min(...lats), Math.max(...lats)];
      if (west === east && south === north) {
        camera.current?.easeTo({ center: [west, south], zoom: 15, duration: 500 });
        return;
      }
      camera.current?.fitBounds([west, south, east, north], {
        padding: options?.edgePadding,
        duration: options?.animated === false ? 0 : 500,
      });
    },
  }));

  const context = useMemo(() => ({ markerPressedAt }), []);

  return (
    <Map
      style={style}
      mapStyle={MAP_STYLE}
      logo={false}
      compass={false}
      touchPitch={false}
      onPress={() => {
        if (Date.now() - markerPressedAt.current < 400) return;
        onPress?.();
      }}
      onRegionDidChange={(event) => {
        const [longitude, latitude] = event.nativeEvent.center;
        onRegionChangeComplete?.({ latitude, longitude });
      }}
    >
      <Camera
        ref={camera}
        initialViewState={{ center: [start.longitude, start.latitude], zoom: zoomFor(start) }}
      />
      {showsUserLocation && locationAllowed && <NativeUserLocation />}
      <MarkerPressContext.Provider value={context}>{children}</MarkerPressContext.Provider>
    </Map>
  );
}

export function Marker({ coordinate, onPress, children }: MarkerProps) {
  const { markerPressedAt } = useContext(MarkerPressContext);
  return (
    <MapLibreMarker
      lngLat={[coordinate.longitude, coordinate.latitude]}
      anchor={children ? 'center' : 'bottom'}
      onPress={() => {
        markerPressedAt.current = Date.now();
        onPress?.();
      }}
    >
      {children ?? <Text style={{ fontSize: 32 }}>📍</Text>}
    </MapLibreMarker>
  );
}

export function Polyline({ coordinates, strokeColor, strokeWidth = 3, dashed = false }: PolylineProps) {
  const id = `line-${useId().replace(/\W/g, '')}`;
  const data = useMemo<GeoJSON.Feature>(
    () => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coordinates.map((c) => [c.longitude, c.latitude]) },
    }),
    [coordinates],
  );
  return (
    <GeoJSONSource id={id} data={data}>
      <Layer
        id={`${id}-layer`}
        type="line"
        style={{
          lineColor: strokeColor,
          lineWidth: strokeWidth,
          lineCap: 'round',
          ...(dashed ? { lineDasharray: [2, 1.5] } : {}),
        }}
      />
    </GeoJSONSource>
  );
}

/** Круг радиусом в метрах — многоугольником, чтобы размер был верным на любом приближении. */
export function Circle({ center, radius, strokeColor, fillColor }: CircleProps) {
  const id = `circle-${useId().replace(/\W/g, '')}`;
  const data = useMemo<GeoJSON.Feature>(() => {
    const points: [number, number][] = [];
    const latRadius = radius / 111_320;
    const lngRadius = radius / (111_320 * Math.cos((center.latitude * Math.PI) / 180));
    for (let i = 0; i <= 64; i++) {
      const angle = (i / 64) * 2 * Math.PI;
      points.push([center.longitude + lngRadius * Math.cos(angle), center.latitude + latRadius * Math.sin(angle)]);
    }
    return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [points] } };
  }, [center.latitude, center.longitude, radius]);
  return (
    <GeoJSONSource id={id} data={data}>
      <Layer id={`${id}-layer`} type="fill" style={{ fillColor, fillOutlineColor: strokeColor }} />
    </GeoJSONSource>
  );
}
