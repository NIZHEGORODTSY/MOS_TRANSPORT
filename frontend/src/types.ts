export type Status = 'ok' | 'risk' | 'late';

export interface Route {
  id: string;
  name: string;
  title: string;
  color: string;
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

/** Last known state of an NDTP terminal, as sent by the backend receiver */
export interface TelemetryUnit {
  unit_id: number;
  tr_id: number | null;
  route_id: number | null;
  time: string;
  received_at: string;
  age_s: number;
  online: boolean;
  lon: number;
  lat: number;
  alt: number;
  speed: number;
  speed_max: number;
  course: number;
  nsat: number;
  pdop: number;
  valid: boolean;
  battery_mv: number;
}

export interface TelemetryMessage {
  type: 'telemetry';
  time: string;
  units: TelemetryUnit[];
}

export type ConnectionState = 'connecting' | 'open' | 'closed';
