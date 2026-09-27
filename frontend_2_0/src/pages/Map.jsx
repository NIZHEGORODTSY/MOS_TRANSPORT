import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { api } from "../api/client";   // если используешь
mapboxgl.accessToken = "pk.eyJ1IjoibGlsZnJlZXp5IiwiYSI6ImNtdWQzaHJyajBhZzEyenM1dGV6bDlneWIifQ.j0-rvFgmpKdoglE48Jo5HQ";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://127.0.0.1:8000";
const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const ROUTES_STREAM_URL = `${API_URL}/api/roads/stream`;

const EMPTY_FC = { type: "FeatureCollection", features: [] };

const ROUTE_COLORS = [
    "#4c8dff", "#22c55e", "#ef4444", "#f59e0b", "#a855f7",
    "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#14b8a6",
    "#8b5cf6", "#eab308", "#dc2626",
];

export default function Map({    center = [37.618423, 55.751244],    zoom = 11,    height = "600px", }) {
    const containerRef = useRef(null);
    const mapRef = useRef(null);
    const featuresRef = useRef([]);
    const [map, setMap] = useState(null);
    const [units, setUnits] = useState([]);
    const [wsError, setWsError] = useState(null);
    const [routesLoading, setRoutesLoading] = useState(true);
    const [routeCount, setRouteCount] = useState(0);
    const [currentRoute, setCurrentRoute] = useState(null);
    const [routesError, setRoutesError] = useState(null);
    const [menuOpen, setMenuOpen] = useState(false);   // ← ЭТУ СТРОКУ ДОБАВИТЬ

    const navigate = useNavigate();
    const isAuth = localStorage.getItem("auth") === "true";

    // ---------- 1. Карта ----------
    useEffect(() => {
    // 1) Не авторизован — карту не создаём
    if (!isAuth) return;

    // 2) div ещё не в DOM — ref.current === null
    if (!containerRef.current) return;

    // 3) Карта уже создана — не создаём повторно
    if (mapRef.current) return;

    const m = new mapboxgl.Map({
        container: containerRef.current,      // ← теперь точно DOM-элемент
        style: "mapbox://styles/mapbox/streets-v12",
        center,
        zoom,
    });
    m.addControl(new mapboxgl.NavigationControl(), "top-right");
    mapRef.current = m;
    setMap(m);

    return () => {
        m.remove();
        mapRef.current = null;
        setMap(null);
    };
}, [isAuth]); // eslint-disable-line react-hooks/exhaustive-deps

    // ---------- 2. Слой маршрутов (пустой, наполняется через SSE) ----------
    useEffect(() => {
        if (!map) return;
        const add = () => {
            if (map.getSource("routes")) return;

            map.addSource("routes", {
                type: "geojson",
                data: EMPTY_FC,
                generateId: true,
            });

            map.addLayer({
                id: "routes-line",
                type: "line",
                source: "routes",
                layout: { "line-join": "round", "line-cap": "round" },
                paint: {
                    "line-color": ["coalesce", ["get", "color"], "#4c8dff"],
                    "line-width": [
                        "interpolate", ["linear"], ["zoom"],
                        9, 2,
                        12, 3.5,
                        15, 6,
                    ],
                    "line-opacity": 0.85,
                },
            });

            map.on("mouseenter", "routes-line", () => {
                map.getCanvas().style.cursor = "pointer";
            });
            map.on("mouseleave", "routes-line", () => {
                map.getCanvas().style.cursor = "";
            });
            map.on("click", "routes-line", (e) => {
                const f = e.features[0];
                const p = f.properties || {};
                const dist = p.distance_m
                    ? `${(p.distance_m / 1000).toFixed(2)} км`
                    : "—";
                const dur = p.duration_s
                    ? `${(p.duration_s / 60).toFixed(1)} мин`
                    : "—";
                const routedNote = p.routed === false
                    ? '<em style="color:#a00">не по дорогам</em>'
                    : "по дорогам";

                new mapboxgl.Popup({ offset: 8 })
                    .setLngLat(e.lngLat)
                    .setHTML(
                        `<strong>Маршрут ${p.route_id ?? "—"}</strong><br/>` +
                        `Дистанция: ${dist}<br/>` +
                        `Время: ${dur}<br/>` +
                        routedNote
                    )
                    .addTo(map);
            });
        };

        if (map.isStyleLoaded()) add();
        else map.once("load", add);
    }, [map]);

    // ---------- 3. SSE: маршруты по одному ----------
    useEffect(() => {
        if (!map) return;

        let es = null;
        let closed = false;

        const startStream = () => {
            if (closed) return;

            console.log("[SSE] подключаюсь к", ROUTES_STREAM_URL);
            es = new EventSource(ROUTES_STREAM_URL);

            es.onopen = () => {
                console.log("[SSE] соединение открыто");
                setRoutesError(null);
            };

            es.onmessage = (e) => {
                let payload;
                try {
                    payload = JSON.parse(e.data);
                } catch (err) {
                    console.warn("[SSE] parse error", err);
                    return;
                }

                // Сигнал завершения
                if (payload.done) {
                    console.log(
                        `[SSE] все ${featuresRef.current.length} маршрутов загружены`
                    );
                    setRoutesLoading(false);
                    setCurrentRoute(null);
                    es.close();
                    return;
                }

                // Новый маршрут
                const feature = payload;
                const routeId = feature.properties?.route_id;

                // Назначаем цвет по индексу
                if (!feature.properties.color) {
                    const idx = featuresRef.current.length % ROUTE_COLORS.length;
                    feature.properties.color = ROUTE_COLORS[idx];
                }

                featuresRef.current.push(feature);
                setRouteCount(featuresRef.current.length);
                setCurrentRoute(routeId);
                console.log(`[SSE] маршрут ${routeId} (routed=${feature.properties.routed})`);

                // Обновляем источник на карте
                const src = map.getSource("routes");
                if (src) {
                    src.setData({
                        type: "FeatureCollection",
                        features: featuresRef.current,
                    });
                }
            };

            es.onerror = (err) => {
                if (closed) return;
                console.error("[SSE] ошибка:", err);
                setRoutesError("Потеряно соединение с сервером");
                setRoutesLoading(false);
                es.close();
            };
        };

        if (map.isStyleLoaded()) startStream();
        else map.once("load", startStream);

        return () => {
            closed = true;
            if (es) es.close();
        };
    }, [map]);

    // ---------- 4. Слой автобусов ----------
    useEffect(() => {
        if (!map) return;
        const add = () => {
            if (map.getSource("vehicles")) return;

            map.addSource("vehicles", { type: "geojson", data: EMPTY_FC });

            map.addLayer({
                id: "vehicles-points",
                type: "circle",
                source: "vehicles",
                paint: {
                    "circle-radius": [
                        "interpolate", ["linear"], ["zoom"],
                        9, 4,
                        12, 7,
                        15, 11,
                    ],
                    "circle-color": [
                        "case",
                        ["get", "online"], "#22c55e",
                        "#9ca3af",
                    ],
                    "circle-stroke-width": 2,
                    "circle-stroke-color": "#ffffff",
                    "circle-opacity": 0.95,
                },
            });

            map.on("mouseenter", "vehicles-points", () => {
                map.getCanvas().style.cursor = "pointer";
            });
            map.on("mouseleave", "vehicles-points", () => {
                map.getCanvas().style.cursor = "";
            });
            map.on("click", "vehicles-points", (e) => {
                const f = e.features[0];
                const p = f.properties;
                new mapboxgl.Popup({ offset: 12 })
                    .setLngLat(f.geometry.coordinates)
                    .setHTML(
                        `<strong>Машина #${p.unit_id}</strong><br/>` +
                        `маршрут: ${p.route_id ?? "—"}<br/>` +
                        `скорость: ${p.speed != null ? `${p.speed} км/ч` : "—"}<br/>` +
                        `обновлено: ${p.age_s != null ? `${p.age_s} с назад` : "—"}`
                    )
                    .addTo(map);
            });
        };

        if (map.isStyleLoaded()) add();
        else map.once("load", add);
    }, [map]);

    // ---------- 5. Обновление позиций автобусов ----------
    useEffect(() => {
        if (!map) return;
        const src = map.getSource("vehicles");
        if (!src) return;

        const features = units
            .filter(
                (u) =>
                    u.online &&
                    u.valid &&
                    Number.isFinite(u.lat) &&
                    Number.isFinite(u.lon)
            )
            .map((u) => ({
                type: "Feature",
                geometry: { type: "Point", coordinates: [u.lon, u.lat] },
                properties: {
                    unit_id: u.unit_id,
                    course: typeof u.course === "number" ? u.course : 0,
                    speed: u.speed ?? null,
                    route_id: u.route_id ?? null,
                    age_s: u.age_s ?? null,
                    online: true,
                },
            }));

        src.setData({ type: "FeatureCollection", features });
    }, [map, units]);

    // ---------- 6. WebSocket: телеметрия автобусов ----------
    useEffect(() => {
        let ws = null;
        let closed = false;
        let retryId = null;

        function connect() {
            ws = new WebSocket(`${WS_URL}/ws/vehicles`);

            ws.onopen = () => setWsError(null);
            ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg.type === "telemetry") setUnits(msg.units ?? []);
                } catch (err) {
                    console.warn("WS parse error", err);
                }
            };
            ws.onerror = () => setWsError("Ошибка WebSocket");
            ws.onclose = () => {
                if (closed) return;
                retryId = setTimeout(connect, 2000);
            };
        }

        connect();
        return () => {
            closed = true;
            if (retryId) clearTimeout(retryId);
            ws?.close();
        };
    }, []);

    const onlineCount = units.filter((u) => u.online).length;
    if (!isAuth) {
    return <Navigate to="/login" replace />;
  }

  const handleLogout = () => {
    localStorage.removeItem('auth');
    navigate('/login', { replace: true });
  };

  return (
    <div style={{ position: "relative", width: "100%", height }}>
        {/* Карта */}
        <div
            ref={containerRef}
            style={{ width: "100%", height: "100%", borderRadius: 8 }}
        />

        {/* Меню справа сверху */}
        <div style={{ position: "absolute", top: 8, right: 8, zIndex: 20 }}>
            <button
                onClick={() => setMenuOpen((v) => !v)}
                style={{
                    background: "rgba(0,0,0,0.75)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 4,
                    padding: "6px 12px",
                    fontSize: 14,
                    cursor: "pointer",
                }}
            >
                Меню ▾
            </button>

            {menuOpen && (
                <div
                    style={{
                        position: "absolute",
                        top: "100%",
                        right: 0,
                        marginTop: 4,
                        background: "#fff",
                        borderRadius: 4,
                        boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
                        minWidth: 140,
                        overflow: "hidden",
                    }}
                >
                    <button
                        onClick={handleLogout}
                        style={{
                            display: "block",
                            width: "100%",
                            padding: "10px 16px",
                            background: "transparent",
                            border: "none",
                            textAlign: "left",
                            fontSize: 14,
                            cursor: "pointer",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                        Выйти
                    </button>
                </div>
            )}
        </div>

        {/* Ошибка WebSocket — приоритет выше */}
        {wsError && (
            <div style={overlayTop("rgba(220,38,38,0.9)")}>{wsError}</div>
        )}

        {/* Загрузка маршрутов */}
        {!wsError && routesLoading && (
            <div style={overlayTop("rgba(0,0,0,0.75)")}>
                Загружаю маршруты... {routeCount} готово
                {currentRoute && ` — маршрут ${currentRoute}`}
            </div>
        )}

        {/* Ошибка маршрутов */}
        {!wsError && !routesLoading && routesError && (
            <div style={overlayTop("rgba(220,38,38,0.9)")}>{routesError}</div>
        )}

        {/* Финальный счётчик маршрутов */}
        {!wsError && !routesLoading && !routesError && routeCount > 0 && (
            <div style={overlayTop("rgba(0,0,0,0.65)")}>
                Маршрутов: {routeCount}
            </div>
        )}

        {/* Автобусы онлайн — всегда внизу слева */}
        <div
            style={{
                position: "absolute",
                bottom: 8,
                left: 8,
                background: "rgba(0,0,0,0.65)",
                color: "#fff",
                padding: "4px 8px",
                borderRadius: 4,
                fontSize: 12,
                zIndex: 10,
            }}
        >
            Автобусов онлайн: {onlineCount}
        </div>
    </div>
);

  
}

function overlayTop(background) {
    return {
        position: "absolute",
        top: 8,
        left: 8,
        background,
        color: "#fff",
        padding: "4px 8px",
        borderRadius: 4,
        fontSize: 12,
        zIndex: 10,
    };
}