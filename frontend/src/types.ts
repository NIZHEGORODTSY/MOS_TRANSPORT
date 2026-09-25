export type Status = 'ok' | 'risk' | 'late';

export interface Stop {
  name: string;
  lat: number;
  lon: number;
}

export interface Route {
  id: string;
  name: string;
  title: string;
  color: string;
  /** line parts; the route line is split where telemetry is missing */
  coordinates: [number, number][][];
  stops: Stop[];
  vehicle_count: number;
}

export interface Vehicle {
  id: string;
  route_id: string;
  route_name: string;
  board: string;
  lon: number;
  lat: number;
  speed_kmh: number;
  delay_s: number;
  predicted_delay_s: number;
  status: Status;
  next_stop: string | null;
  target_stop: string | null;
  target_time_plan: string | null;
  lead_s: number;
  /** [seconds ago, delay at that stop] for stops passed recently */
  history: [number, number][];
}

export interface Snapshot {
  type: 'snapshot';
  clock: string;
  speed: number;
  horizon_s: number;
  history_s: number;
  tick_ms: number;
  vehicles: Vehicle[];
}

export type ConnectionState = 'connecting' | 'open' | 'closed';
