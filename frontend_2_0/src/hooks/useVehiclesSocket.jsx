import {useEffect, useState} from "react";

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://127.0.0.1:8000";

export function useVehiclesSocket() {
    const [units, setUnits] = useState([]);
    const [error, setError] = useState(null);

    useEffect(() => {
        let ws;
        let closed = false;
        let retryId;

        function connect() {
            ws = new WebSocket(`${WS_URL}/ws/vehicles`);

            ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg.type === "telemetry") setUnits(msg.units);
                } catch {
                }
            };
            ws.onerror = (e) => setError(e.message ?? "ws error");
            ws.onclose = () => {
                if (closed) return;
                retryId = setTimeout(connect, 2000);   // авто-реконнект
            };
        }

        connect();
        return () => {
            closed = true;
            clearTimeout(retryId);
            ws?.close();
        };
    }, []);

    return {units, error};
}