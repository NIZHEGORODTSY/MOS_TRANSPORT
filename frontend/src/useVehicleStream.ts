import { useEffect, useState } from 'react';
import type { ConnectionState, Snapshot } from './types';

const RECONNECT_MS = 2000;

export function useVehicleStream() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: number | undefined;
    let disposed = false;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws/vehicles`);
      setConnection('connecting');
      ws.onopen = () => setConnection('open');
      ws.onmessage = (e) => setSnapshot(JSON.parse(e.data) as Snapshot);
      ws.onclose = () => {
        if (disposed) return;
        setConnection('closed');
        timer = window.setTimeout(connect, RECONNECT_MS);
      };
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return { snapshot, connection };
}
