import { useEffect, useMemo, useRef, useState } from 'react';
import MapGL, { Layer, NavigationControl, ScaleControl, Source } from 'react-map-gl/mapbox';
import type { LayerProps, MapMouseEvent, MapRef } from 'react-map-gl/mapbox';
import type { GeoJSONSource } from 'mapbox-gl';
import type { Feature, FeatureCollection } from 'geojson';
import 'mapbox-gl/dist/mapbox-gl.css';
import { formatClockMsk } from './format';
import type { Route, TelemetryUnit } from './types';

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const INITIAL_VIEW = { longitude: 37.55, latitude: 55.75, zoom: 9.6 };
const ANIMATION_MS = 1000;
// a jump this large (in degrees) is a replay restart or a GPS gap, not movement, so it is not animated
const MAX_ANIMATED_JUMP = 0.02;
const EMULATOR_COLOR = '#8b98a8';

const unitCircle: LayerProps = {
  id: 'units-circle',
  type: 'circle',
  paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4, 15, 9],
    'circle-color': ['get', 'color'],
    'circle-opacity': ['case', ['get', 'online'], 1, 0.35],
    'circle-stroke-color': '#ffffff',
    'circle-stroke-width': 1.5,
    'circle-stroke-opacity': ['case', ['get', 'online'], 1, 0.35],
  },
};

// wider invisible target: the units move, so the visible circle is hard to hit with the cursor
const unitHit: LayerProps = {
  id: 'units-hit',
  type: 'circle',
  paint: { 'circle-radius': 14, 'circle-opacity': 0 },
};

const unitLabel: LayerProps = {
  id: 'units-label',
  type: 'symbol',
  minzoom: 12.5,
  layout: {
    'text-field': ['get', 'label'],
    'text-size': 11,
    'text-offset': [0, -1.5],
    'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
  },
  paint: { 'text-color': '#ffffff', 'text-halo-color': '#0b0f14', 'text-halo-width': 1.5 },
};

interface Props {
  units: TelemetryUnit[];
  routes: Route[];
  hiddenRoutes: Set<string>;
}

interface Anim {
  from: Map<number, [number, number]>;
  to: Map<number, [number, number]>;
  start: number;
}

interface Hover {
  unitId: number;
  x: number;
  y: number;
}

export function TransitMap({ units, routes, hiddenRoutes }: Props) {
  const mapRef = useRef<MapRef>(null);
  const shownRef = useRef(new Map<number, [number, number]>());
  const animRef = useRef<Anim | null>(null);
  const featuresRef = useRef<{ unit: TelemetryUnit; color: string }[]>([]);
  const dirtyRef = useRef(true);
  const [hover, setHover] = useState<Hover | null>(null);

  const colorOf = useMemo(() => new Map(routes.map((r) => [r.id, r.color])), [routes]);

  // units without any GPS fix yet are at (0, 0) and are not drawn
  const visible = useMemo(
    () =>
      units.filter(
        (u) => (u.lat !== 0 || u.lon !== 0) && (u.route_id === null || !hiddenRoutes.has(String(u.route_id))),
      ),
    [units, hiddenRoutes],
  );

  useEffect(() => {
    featuresRef.current = visible.map((unit) => ({
      unit,
      color: unit.route_id === null ? EMULATOR_COLOR : (colorOf.get(String(unit.route_id)) ?? EMULATOR_COLOR),
    }));
    const to = new Map<number, [number, number]>(visible.map((u) => [u.unit_id, [u.lon, u.lat]]));
    const from = new Map(to);
    for (const [id, p] of shownRef.current) {
      const target = to.get(id);
      if (target && Math.hypot(target[0] - p[0], target[1] - p[1]) < MAX_ANIMATED_JUMP) from.set(id, p);
    }
    animRef.current = { from, to, start: performance.now() };
    dirtyRef.current = true;
  }, [visible, colorOf]);

  useEffect(() => {
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const anim = animRef.current;
      const source = mapRef.current?.getSource('units') as GeoJSONSource | undefined;
      if (!anim || !source) return;
      const t = Math.min(1, (now - anim.start) / ANIMATION_MS);
      if (t >= 1 && !dirtyRef.current) return;
      dirtyRef.current = t < 1;

      const features: Feature[] = featuresRef.current.map(({ unit, color }) => {
        const a = anim.from.get(unit.unit_id) ?? [unit.lon, unit.lat];
        const b = anim.to.get(unit.unit_id) ?? [unit.lon, unit.lat];
        const p: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        shownRef.current.set(unit.unit_id, p);
        return {
          type: 'Feature',
          properties: {
            unit_id: unit.unit_id,
            color,
            online: unit.online,
            label: unit.route_id === null ? '' : String(unit.route_id),
          },
          geometry: { type: 'Point', coordinates: p },
        };
      });
      source.setData({ type: 'FeatureCollection', features });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!TOKEN) {
    return (
      <div className="map-placeholder">
        <h2>Нужен токен Mapbox</h2>
        <p>
          Создайте файл <code>frontend/.env.local</code> со строкой
          <br />
          <code>VITE_MAPBOX_TOKEN=pk.…</code>
          <br />и перезапустите <code>npm run dev</code>.
        </p>
      </div>
    );
  }

  const handleMove = (e: MapMouseEvent) => {
    const unitId = e.features?.[0]?.properties?.unit_id as number | undefined;
    setHover(unitId ? { unitId, x: e.point.x, y: e.point.y } : null);
  };

  const hovered = hover ? units.find((u) => u.unit_id === hover.unitId) : undefined;
  const online = visible.filter((u) => u.online).length;

  return (
    <div className="map-wrap">
      <MapGL
        ref={mapRef}
        mapboxAccessToken={TOKEN}
        initialViewState={INITIAL_VIEW}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        language="ru"
        interactiveLayerIds={['units-hit']}
        cursor={hover ? 'pointer' : 'grab'}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        onLoad={() => (dirtyRef.current = true)}
      >
        <NavigationControl position="top-right" />
        <ScaleControl position="bottom-right" />
        <Source id="units" type="geojson" data={EMPTY}>
          <Layer {...unitHit} />
          <Layer {...unitCircle} />
          <Layer {...unitLabel} />
        </Source>
      </MapGL>

      {hover && hovered && (
        <div className="map-tooltip" style={{ left: hover.x, top: hover.y }}>
          <div className="map-tooltip-title">
            {hovered.tr_id !== null ? `ТС ${hovered.tr_id} · маршрут ${hovered.route_id}` : `Эмулятор · терминал ${hovered.unit_id}`}
          </div>
          <div>
            {hovered.speed} км/ч · курс {hovered.course}°
          </div>
          <div className="muted">
            {formatClockMsk(hovered.time)} МСК
            {hovered.online ? '' : ` · нет связи ${Math.round(hovered.age_s)} с`}
            {hovered.valid ? '' : ' · нет GPS'}
          </div>
        </div>
      )}

      <div className="map-legend">
        <div className="map-legend-title">
          ТС на связи: {online} из {visible.length}
        </div>
        <div className="map-legend-row">
          <span className="dot" style={{ background: 'linear-gradient(90deg, #4c8dff, #ff7ab8, #3ddbb0)' }} />
          ТС датасета — цвет маршрута
        </div>
        <div className="map-legend-row">
          <span className="dot" style={{ background: EMULATOR_COLOR }} />
          Эмулятор NDTP
        </div>
        <div className="map-legend-row">
          <span className="dot" style={{ background: '#ffffff', opacity: 0.35 }} />
          Нет связи
        </div>
      </div>
    </div>
  );
}
