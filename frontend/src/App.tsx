import { useEffect, useMemo, useState } from 'react';
import { Sidebar } from './Sidebar';
import { TransitMap } from './TransitMap';
import { VehicleCard } from './VehicleCard';
import { useVehicleStream } from './useVehicleStream';
import type { Route, Status } from './types';

export function App() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [hiddenRoutes, setHiddenRoutes] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Status | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { snapshot, telemetry, connection } = useVehicleStream();
  const units = telemetry?.units ?? [];
  // newest packet time; dataset units (historical replay time) win over emulator units (current time)
  const clockUnits = units.some((u) => u.tr_id !== null) ? units.filter((u) => u.tr_id !== null) : units;
  const telemetryClock = clockUnits.reduce<string | null>((max, u) => (max === null || u.time > max ? u.time : max), null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch('/api/routes')
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((data: Route[]) => !cancelled && setRoutes(data))
        .catch(() => !cancelled && window.setTimeout(load, 2000));
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const all = snapshot?.vehicles ?? [];
  const inRoutes = useMemo(() => all.filter((v) => !hiddenRoutes.has(v.route_id)), [all, hiddenRoutes]);
  const shown = useMemo(
    () => (statusFilter ? inRoutes.filter((v) => v.status === statusFilter) : inRoutes),
    [inRoutes, statusFilter],
  );
  const sorted = useMemo(() => [...shown].sort((a, b) => b.predicted_delay_s - a.predicted_delay_s), [shown]);
  const counts = useMemo(() => {
    const c: Record<Status, number> = { ok: 0, risk: 0, late: 0 };
    for (const v of inRoutes) c[v.status] += 1;
    return c;
  }, [inRoutes]);

  const selected = all.find((v) => v.id === selectedId);

  const toggleRoute = (id: string) =>
    setHiddenRoutes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="layout">
      <Sidebar
        routes={routes}
        vehicles={sorted}
        counts={counts}
        total={inRoutes.length}
        connection={connection}
        clock={snapshot?.clock ?? telemetryClock}
        speed={snapshot?.speed ?? null}
        hiddenRoutes={hiddenRoutes}
        statusFilter={statusFilter}
        selectedId={selectedId}
        onToggleRoute={toggleRoute}
        onShowAllRoutes={() => setHiddenRoutes(new Set())}
        onStatusFilter={setStatusFilter}
        onPick={setSelectedId}
        card={
          selected &&
          snapshot && (
            <VehicleCard
              vehicle={selected}
              route={routes.find((r) => r.id === selected.route_id)}
              historyS={snapshot.history_s}
              horizonS={snapshot.horizon_s}
              onClose={() => setSelectedId(null)}
            />
          )
        }
      />
      <main className="map-area">
        <TransitMap units={units} routes={routes} hiddenRoutes={hiddenRoutes} />
      </main>
    </div>
  );
}
