import {useEffect, useRef, useState} from "react";
import {Navigate, useNavigate} from "react-router-dom";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {colorForRoute, NO_ROUTE_COLOR, ROUTE_PALETTE} from "../routeColors";

mapboxgl.accessToken = "pk.eyJ1IjoibGlsZnJlZXp5IiwiYSI6ImNtdWQzaHJyajBhZzEyenM1dGV6bDlneWIifQ.j0-rvFgmpKdoglE48Jo5HQ";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://127.0.0.1:8000";
const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const ROUTES_STREAM_URL = `${API_URL}/api/roads/stream`;
const STOPS_URL = `${API_URL}/api/stops/geojson`;

const EMPTY_FC = {type: "FeatureCollection", features: []};


export default function BusMap({
                                   center = [37.618423, 55.751244], zoom = 11, height = "600px",
                               }) {
    // ───── все хуки — наверху, до любых условий ─────
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

    const [stopsLoading, setStopsLoading] = useState(false);
    const [stopsCount, setStopsCount] = useState(0);
    const [stopsError, setStopsError] = useState(null);
    const [stopsVisible, setStopsVisible] = useState(true);

    const [menuOpen, setMenuOpen] = useState(false);

    const navigate = useNavigate();
    const isAuth = sessionStorage.getItem("auth") === "true";

    // ---------- 1. Создание карты ----------
    useEffect(() => {
        if (!isAuth) return;
        if (!containerRef.current) return;
        if (mapRef.current) return;

        const m = new mapboxgl.Map({
            container: containerRef.current, style: "mapbox://styles/mapbox/navigation-night-v1", center, zoom, language: "ru"
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

    // ---------- 2. Слой маршрутов (пустой, наполняется SSE) ----------
    useEffect(() => {
        if (!map) return;
        const add = () => {
            if (map.getSource("routes")) return;

            map.addSource("routes", {
                type: "geojson", data: EMPTY_FC, generateId: true,
            });

            map.addLayer({
                id: "routes-line",
                type: "line",
                source: "routes",
                layout: {"line-join": "round", "line-cap": "round"},
                paint: {
                    "line-color": ["coalesce", ["get", "color"], NO_ROUTE_COLOR],
                    "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2, 12, 3.5, 15, 6,],
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
                const dist = p.distance_m ? `${(p.distance_m / 1000).toFixed(2)} км` : "—";
                const dur = p.duration_s ? `${(p.duration_s / 60).toFixed(1)} мин` : "—";
                const routedNote = p.routed === false ? '<em style="color:#a00">не по дорогам</em>' : "по дорогам";

                new mapboxgl.Popup({offset: 8})
                    .setLngLat(e.lngLat)
                    .setHTML(`<strong>Маршрут ${p.route_id ?? "—"}</strong><br/>` + `Дистанция: ${dist}<br/>` + `Время: ${dur}<br/>` + routedNote)
                    .addTo(map);
            });
        };

        if (map.isStyleLoaded()) add(); else map.once("load", add);
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

                if (payload.done) {
                    console.log(`[SSE] все ${featuresRef.current.length} маршрутов загружены`);
                    setRoutesLoading(false);
                    setCurrentRoute(null);
                    es.close();
                    return;
                }

                const feature = payload;
                const routeId = feature.properties?.route_id;

                feature.properties.color = colorForRoute(feature.properties.route_id);

                featuresRef.current.push(feature);
                setRouteCount(featuresRef.current.length);
                setCurrentRoute(routeId);

                const src = map.getSource("routes");
                if (src) {
                    src.setData({
                        type: "FeatureCollection", features: featuresRef.current,
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

        if (map.isStyleLoaded()) startStream(); else map.once("load", startStream);

        return () => {
            closed = true;
            if (es) es.close();
        };
    }, [map]);

    // ---------- 4. Остановки (обычный GET) ----------
    useEffect(() => {
        if (!map) return;
        let cancelled = false;

        async function loadStops() {
            setStopsLoading(true);
            setStopsError(null);

            try {
                const res = await fetch(STOPS_URL);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const stops = await res.json();
                if (cancelled) return;

                const count = stops.features?.length ?? 0;
                setStopsCount(count);
                console.log(`Загружено остановок: ${count}`);

                const draw = () => {
                    if (map.getSource("stops")) return;

                    map.addSource("stops", {
                        type: "geojson", data: stops,
                    });

                    map.addLayer({
                        id: "stops-circles", type: "circle", source: "stops", minzoom: 10, paint: {
                            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2, 13, 4, 16, 6,],
                            "circle-color": "#ffffff",
                            "circle-stroke-width": 1.5,
                            "circle-stroke-color": "#a970ff",
                            "circle-opacity": 0.9,
                        },
                    }, map.getLayer("vehicles-points") ? "vehicles-points" : undefined);

                    map.addLayer({
                        id: "stops-labels", type: "symbol", source: "stops", minzoom: 15, layout: {
                            "text-field": ["get", "stop_name"],
                            "text-size": 11,
                            "text-offset": [0, 1.4],
                            "text-anchor": "top",
                            "text-allow-overlap": false,
                            "text-ignore-placement": false,
                        }, paint: {
                            "text-color": "#333", "text-halo-color": "#fff", "text-halo-width": 1.5,
                        },
                    }, map.getLayer("vehicles-points") ? "vehicles-points" : undefined);

                    map.on("mouseenter", "stops-circles", () => {
                        map.getCanvas().style.cursor = "pointer";
                    });
                    map.on("mouseleave", "stops-circles", () => {
                        map.getCanvas().style.cursor = "";
                    });
                    map.on("click", "stops-circles", (e) => {
                        const f = e.features[0];
                        const [lon, lat] = f.geometry.coordinates;
                        const p = f.properties;

                        new mapboxgl.Popup({offset: 12})
                            .setLngLat([lon, lat])
                            .setHTML(`<strong>${p.stop_name ?? "Остановка"}</strong><br/>` + `id: ${p.stop_id ?? "—"}<br/>` + `маршрут: ${p.route_id ?? "—"}`)
                            .addTo(map);
                    });
                };

                if (map.isStyleLoaded()) draw(); else map.once("load", draw);
            } catch (err) {
                if (cancelled) return;
                console.error("Ошибка загрузки остановок:", err);
                setStopsError(err.message || "Не удалось загрузить остановки");
            } finally {
                if (!cancelled) setStopsLoading(false);
            }
        }

        loadStops();
        return () => {
            cancelled = true;
        };
    }, [map]);

    // ---------- 5. Слой автобусов ----------
    useEffect(() => {
        if (!map) return;
        const add = () => {
            if (map.getSource("vehicles")) return;

            map.addSource("vehicles", {type: "geojson", data: EMPTY_FC});

            map.addLayer({
                id: "vehicles-points", type: "circle", source: "vehicles", paint: {
                    "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 4, 12, 7, 15, 11,],
                    "circle-color": ["coalesce", ["get", "color"], NO_ROUTE_COLOR],
                    "circle-stroke-width": 2,
                    "circle-stroke-color": "#ffffff",
                    "circle-opacity": ["case", ["get", "online"], 0.95, 0.35],
                    "circle-stroke-opacity": ["case", ["get", "online"], 1, 0.35],
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
                new mapboxgl.Popup({offset: 12})
                    .setLngLat(f.geometry.coordinates)
                    .setHTML(`<strong>ТС ${p.tr_id ?? `терминал ${p.unit_id}`}</strong><br/>` + `маршрут: ${p.route_id ?? "—"}<br/>` + `скорость: ${p.speed != null ? `${p.speed} км/ч` : "—"}<br/>` + `обновлено: ${p.age_s != null ? `${p.age_s} с назад` : "—"}`)
                    .addTo(map);
            });
        };

        if (map.isStyleLoaded()) add(); else map.once("load", add);
    }, [map]);

    // ---------- 6. Обновление позиций автобусов ----------
    useEffect(() => {
        if (!map) return;
        const src = map.getSource("vehicles");
        if (!src) return;

        const features = units
            .filter((u) => u.valid && Number.isFinite(u.lat) && Number.isFinite(u.lon))
            .map((u) => ({
                type: "Feature", geometry: {type: "Point", coordinates: [u.lon, u.lat]}, properties: {
                    unit_id: u.unit_id,
                    tr_id: u.tr_id ?? null,
                    course: typeof u.course === "number" ? u.course : 0,
                    speed: u.speed ?? null,
                    route_id: u.route_id ?? null,
                    age_s: u.age_s ?? null,
                    online: !!u.online,
                    color: colorForRoute(u.route_id),
                },
            }));

        src.setData({type: "FeatureCollection", features});
    }, [map, units]);

    // ---------- 7. WebSocket: телеметрия автобусов ----------
    useEffect(() => {
        if (!isAuth) return;

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
    }, [isAuth]);

    // ---------- 8. Переключение видимости остановок ----------
    useEffect(() => {
        if (!map) return;
        const visibility = stopsVisible ? "visible" : "none";

        if (map.getLayer("stops-circles")) {
            map.setLayoutProperty("stops-circles", "visibility", visibility);
        }
        if (map.getLayer("stops-labels")) {
            map.setLayoutProperty("stops-labels", "visibility", visibility);
        }
    }, [map, stopsVisible]);

    // ───── условный рендер — ПОСЛЕ всех хуков ─────
    if (!isAuth) {
        return <Navigate to="/login" replace/>;
    }

    const handleLogout = () => {
        localStorage.removeItem("auth");
        navigate("/login", {replace: true});
    };

    const onlineCount = units.filter((u) => u.online).length;

    return (<div style={{position: "relative", width: "100%", height}}>
        {/* Карта */}
        <div
            ref={containerRef}
            style={{width: "100%", height: "100%", borderRadius: 8}}
        />

        {/* Меню справа сверху */}
        <div style={{position: "absolute", top: 8, right: 8, zIndex: 20}}>
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

            {menuOpen && (<div
                style={{
                    position: "absolute",
                    top: "100%",
                    right: 0,
                    marginTop: 4,
                    background: "#fff",
                    borderRadius: 4,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
                    minWidth: 180,
                    overflow: "hidden",
                }}
            >
                <label
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 16px",
                        fontSize: 14,
                        cursor: "pointer",
                        borderBottom: "1px solid #eee",
                    }}
                >
                    <input
                        type="checkbox"
                        checked={stopsVisible}
                        onChange={(e) => setStopsVisible(e.target.checked)}
                    />
                    Показывать остановки
                </label>

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
            </div>)}
        </div>

        {/* Ошибка WebSocket */}
        {wsError && (<div style={overlayTop("rgba(220,38,38,0.9)")}>{wsError}</div>)}

        {/* Загрузка маршрутов */}
        {!wsError && routesLoading && (<div style={overlayTop("rgba(0,0,0,0.75)")}>
            Загружаю маршруты... {routeCount} готово
            {currentRoute && ` — маршрут ${currentRoute}`}
        </div>)}

        {/* Ошибка маршрутов */}
        {!wsError && !routesLoading && routesError && (
            <div style={overlayTop("rgba(220,38,38,0.9)")}>{routesError}</div>)}

        {/* Финальный счётчик маршрутов */}
        {!wsError && !routesLoading && !routesError && routeCount > 0 && (
            <div style={overlayTop("rgba(0,0,0,0.65)")}>
                Маршрутов: {routeCount}
            </div>)}

        {/* Счётчик остановок */}
        {!routesLoading && stopsCount > 0 && (<div
            style={{
                position: "absolute",
                top: 40,
                left: 8,
                background: "rgba(0,0,0,0.65)",
                color: "#fff",
                padding: "4px 8px",
                borderRadius: 4,
                fontSize: 12,
                zIndex: 10,
            }}
        >
            Остановок: {stopsCount}
            {stopsLoading && " (загрузка...)"}
            {stopsError && ` — ошибка: ${stopsError}`}
        </div>)}

        {/* Легенда маршрутов */}
        <div
            style={{
                position: "absolute",
                bottom: 36,
                left: 8,
                background: "rgba(0,0,0,0.65)",
                color: "#fff",
                padding: "6px 8px",
                borderRadius: 4,
                fontSize: 12,
                zIndex: 10,
                display: "grid",
                gridTemplateColumns: "repeat(5, auto)",
                gap: "4px 10px",
            }}
        >
            {ROUTE_PALETTE.map((color, i) => (
                <span key={i} style={{display: "flex", alignItems: "center", gap: 4}}>
                    <span style={{width: 10, height: 10, borderRadius: "50%", background: color}}/>
                    {i + 1}
                </span>
            ))}
            <span style={{display: "flex", alignItems: "center", gap: 4}}>
                <span style={{width: 10, height: 10, borderRadius: "50%", background: NO_ROUTE_COLOR}}/>
                без маршрута
            </span>
        </div>

        {/* Автобусы онлайн */}
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
    </div>);
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