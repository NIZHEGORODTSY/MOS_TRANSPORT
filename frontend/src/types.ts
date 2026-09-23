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
  coordinates: [number, number][];
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
  next_stop: string;
  history: number[];
}

export interface Snapshot {
  type: 'snapshot';
  sim_time: number;
  horizon_s: number;
  history_step_s: number;
  tick_ms: number;
  vehicles: Vehicle[];
}

export type ConnectionState = 'connecting' | 'open' | 'closed';
