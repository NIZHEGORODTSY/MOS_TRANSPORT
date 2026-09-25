import { useEffect, useMemo, useRef, useState } from 'react';
import MapGL, { Layer, NavigationControl, ScaleControl, Source } from 'react-map-gl/mapbox';
import type { LayerProps, MapMouseEvent, MapRef } from 'react-map-gl/mapbox';
import type { GeoJSONSource } from 'mapbox-gl';
import type { Feature, FeatureCollection } from 'geojson';
import 'mapbox-gl/dist/mapbox-gl.css';
import { STATUS_COLOR, STATUS_LABEL, formatDelay } from './format';
import type { Route, Status, Vehicle } from './types';

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const INITIAL_VIEW = { longitude: 37.55, latitude: 55.75, zoom: 9.6 };
// a jump this large (in degrees) is a replay restart or a GPS gap, not movement, so it is not animated
const MAX_ANIMATED_JUMP = 0.02;

const statusColor = [
  'match',
  ['get', 'status'],
  'ok', STATUS_COLOR.ok,
  'risk', STATUS_COLOR.risk,
  'late', STATUS_COLOR.late,
  '#888',
] as const;

const routeCasing: LayerProps = {
  id: 'routes-casing',
  type: 'line',
  layout: { 'line-join': 'round', 'line-cap': 'round' },
  paint: {
    'line-color': '#0b0f14',
    'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 11],
    'line-opacity': ['case', ['get', 'active'], 0.7, 0],
  },
};

const routeLine: LayerProps = {
  id: 'routes-line',
  type: 'line',
  layout: { 'line-join': 'round', 'line-cap': 'round' },
  paint: {
    'line-color': ['get', 'color'],
    'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 7],
    'line-opacity': ['case', ['get', 'active'], 0.9, 0.12],
  },
};

const stopCircle: LayerProps = {
  id: 'stops-circle',
  type: 'circle',
  minzoom: 11.5,
  filter: ['get', 'active'],
  paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 11.5, 2.5, 15, 5],
    'circle-color': '#0b0f14',
    'circle-stroke-color': '#e6edf3',
    'circle-stroke-width': 1.5,
  },
};

const stopLabel: LayerProps = {
  id: 'stops-label',
  type: 'symbol',
  minzoom: 13.5,
  filter: ['get', 'active'],
  layout: {
    'text-field': ['get', 'name'],
    'text-size': 11,
    'text-offset': [0, 1.1],
    'text-anchor': 'top',
  },
  paint: { 'text-color': '#c9d1d9', 'text-halo-color': '#0b0f14', 'text-halo-width': 1.5 },
};

const vehicleHalo: LayerProps = {
  id: 'vehicles-halo',
  type: 'circle',
  filter: ['get', 'selected'],
  paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 13, 15, 20],
    'circle-color': statusColor as unknown as string,
    'circle-opacity': 0.25,
    'circle-stroke-color': statusColor as unknown as string,
    'circle-stroke-width': 2,
  },
};

const vehicleHit: LayerProps = {
  id: 'vehicles-hit',
  type: 'circle',
  paint: { 'circle-radius': 16, 'circle-opacity': 0 },
};

const vehicleCircle: LayerProps = {
  id: 'vehicles-circle',
  type: 'circle',
  paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 10],
    'circle-color': statusColor as unknown as string,
    'circle-stroke-color': '#ffffff',
    'circle-stroke-width': ['case', ['get', 'selected'], 2.5, 1.5],
  },
};

const vehicleLabel: LayerProps = {
  id: 'vehicles-label',
  type: 'symbol',
  minzoom: 12.5,
  layout: {
    'text-field': ['get', 'route_name'],
    'text-size': 11,
    'text-offset': [0, -1.5],
    'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
  },
  paint: { 'text-color': '#ffffff', 'text-halo-color': '#0b0f14', 'text-halo-width': 1.5 },
};

interface Props {
  routes: Route[];
  vehicles: Vehicle[];
  hiddenRoutes: Set<string>;
  selectedId: string | null;
  flyToken: number;
  tickMs: number;
  onSelect: (id: string | null) => void;
}

interface Anim {
  from: Map<string, [number, number]>;
  to: Map<string, [number, number]>;
  start: number;
  duration: number;
}

interface Hover {
  id: string;
  x: number;
  y: number;
}

export function TransitMap({ routes, vehicles, hiddenRoutes, selectedId, flyToken, tickMs, onSelect }: Props) {
  const mapRef = useRef<MapRef>(null);
  const shownRef = useRef(new Map<string, [number, number]>());
  const animRef = useRef<Anim | null>(null);
  const latestRef = useRef({ vehicles, selectedId });
  const dirtyRef = useRef(true);
  const [hover, setHover] = useState<Hover | null>(null);

  latestRef.current = { vehicles, selectedId };

  const routesGeo = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: routes.map((r) => ({
        type: 'Feature',
        properties: { id: r.id, color: r.color, active: !hiddenRoutes.has(r.id) },
        geometry: { type: 'MultiLineString', coordinates: r.coordinates },
      })),
    }),
    [routes, hiddenRoutes],
  );

  const stopsGeo = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: routes.flatMap((r) =>
        r.stops.map((s) => ({
          type: 'Feature' as const,
          properties: { name: s.name, active: !hiddenRoutes.has(r.id) },
          geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
        })),
      ),
    }),
    [routes, hiddenRoutes],
  );

  useEffect(() => {
    const to = new Map<string, [number, number]>(vehicles.map((v) => [v.id, [v.lon, v.lat]]));
    const from = new Map(to);
    for (const [id, p] of shownRef.current) {
      const target = to.get(id);
      if (target && Math.hypot(target[0] - p[0], target[1] - p[1]) < MAX_ANIMATED_JUMP) from.set(id, p);
    }
    animRef.current = { from, to, start: performance.now(), duration: tickMs };
    dirtyRef.current = true;
  }, [vehicles, tickMs]);

  useEffect(() => {
    dirtyRef.current = true;
  }, [selectedId]);

  useEffect(() => {
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const anim = animRef.current;
      const source = mapRef.current?.getSource('vehicles') as GeoJSONSource | undefined;
      if (!anim || !source) return;
      const t = Math.min(1, (now - anim.start) / anim.duration);
      if (t >= 1 && !dirtyRef.current) return;
      dirtyRef.current = t < 1;

      const { vehicles: list, selectedId: sel } = latestRef.current;
      const features: Feature[] = [];
      for (const v of list) {
        const a = anim.from.get(v.id) ?? [v.lon, v.lat];
        const b = anim.to.get(v.id) ?? [v.lon, v.lat];
        const p: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        shownRef.current.set(v.id, p);
        features.push({
          type: 'Feature',
          properties: { id: v.id, status: v.status, route_name: v.route_name, selected: v.id === sel },
          geometry: { type: 'Point', coordinates: p },
        });
      }
      source.setData({ type: 'FeatureCollection', features });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const fittedRef = useRef(false);
  const fitToRoutes = () => {
    const map = mapRef.current;
    const coords = routes.flatMap((r) => [...r.coordinates.flat(), ...r.stops.map((s): [number, number] => [s.lon, s.lat])]);
    if (fittedRef.current || !map || coords.length === 0) return;
    const lons = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 40, duration: 0 },
    );
    fittedRef.current = true;
  };

  useEffect(fitToRoutes, [routes]);

  useEffect(() => {
    if (!flyToken || !selectedId) return;
    const pos = shownRef.current.get(selectedId);
    const map = mapRef.current;
    if (!pos || !map) return;
    map.flyTo({ center: pos, zoom: Math.max(map.getZoom(), 14), duration: 900 });
    // only explicit fly requests move the camera; clicking a vehicle on the map should not
  }, [flyToken]);

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

  const handleClick = (e: MapMouseEvent) => {
    const id = e.features?.[0]?.properties?.id as string | undefined;
    onSelect(id ?? null);
  };

  const handleMove = (e: MapMouseEvent) => {
    const id = e.features?.[0]?.properties?.id as string | undefined;
    setHover(id ? { id, x: e.point.x, y: e.point.y } : null);
  };

  const hovered = hover ? vehicles.find((v) => v.id === hover.id) : undefined;

  return (
    <div className="map-wrap">
      <MapGL
        ref={mapRef}
        mapboxAccessToken={TOKEN}
        initialViewState={INITIAL_VIEW}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        language="ru"
        interactiveLayerIds={['vehicles-hit']}
        cursor={hover ? 'pointer' : 'grab'}
        onClick={handleClick}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        onLoad={() => {
          dirtyRef.current = true;
          fitToRoutes();
        }}
      >
        <NavigationControl position="top-right" />
        <ScaleControl position="bottom-right" />
        <Source id="routes" type="geojson" data={routesGeo}>
          <Layer {...routeCasing} />
          <Layer {...routeLine} />
        </Source>
        <Source id="stops" type="geojson" data={stopsGeo}>
          <Layer {...stopCircle} />
          <Layer {...stopLabel} />
        </Source>
        <Source id="vehicles" type="geojson" data={EMPTY}>
          <Layer {...vehicleHalo} />
          <Layer {...vehicleHit} />
          <Layer {...vehicleCircle} />
          <Layer {...vehicleLabel} />
        </Source>
      </MapGL>

      {hover && hovered && (
        <div className="map-tooltip" style={{ left: hover.x, top: hover.y }}>
          <div className="map-tooltip-title">
            Маршрут {hovered.route_name} · ТС {hovered.board}
          </div>
          <div>
            Сейчас <b>{formatDelay(hovered.delay_s)}</b> → прогноз{' '}
            <b style={{ color: STATUS_COLOR[hovered.status] }}>{formatDelay(hovered.predicted_delay_s)}</b>
          </div>
          {hovered.next_stop && <div className="muted">След.: {hovered.next_stop}</div>}
        </div>
      )}

      <div className="map-legend">
        <div className="map-legend-title">Прогноз на 10–15 мин</div>
        {(Object.keys(STATUS_COLOR) as Status[]).map((s) => (
          <div key={s} className="map-legend-row">
            <span className="dot" style={{ background: STATUS_COLOR[s] }} />
            {STATUS_LABEL[s]}
          </div>
        ))}
      </div>
    </div>
  );
}
