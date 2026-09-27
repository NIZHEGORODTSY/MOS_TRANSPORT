import {useEffect, useMemo, useRef, useState} from "react";
import {Navigate, useNavigate} from "react-router-dom";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {colorForRoute, NO_ROUTE_COLOR, routeKey} from "../routeColors";
import Sidebar from "../components/Sidebar";
import "./Map.css";

mapboxgl.accessToken = "pk.eyJ1IjoibGlsZnJlZXp5IiwiYSI6ImNtdWQzaHJyajBhZzEyenM1dGV6bDlneWIifQ.j0-rvFgmpKdoglE48Jo5HQ";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://127.0.0.1:8000";
const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const ROUTES_STREAM_URL = `${API_URL}/api/roads/stream`;
const STOPS_URL = `${API_URL}/api/stops/geojson`;

const EMPTY_FC = {type: "FeatureCollection", features: []};


export default function BusMap({center = [37.618423, 55.751244], zoom = 11}) {
    // ───── все хуки — наверху, до любых условий ─────
    const containerRef = useRef(null);
    const mapRef = useRef(null);
    const featuresRef = useRef([]);

    const [map, setMap] = useState(null);
    const [units, setUnits] = useState([]);
    const [wsStatus, setWsStatus] = useState("connecting");

    const [routesLoading, setRoutesLoading] = useState(true);
    const [routeCount, setRouteCount] = useState(0);
    const [currentRoute, setCurrentRoute] = useState(null);
    const [routesError, setRoutesError] = useState(null);

    const [stopsLoading, setStopsLoading] = useState(false);
    const [stopsCount, setStopsCount] = useState(0);
    const [stopsError, setStopsError] = useState(null);
    const [stopsVisible, setStopsVisible] = useState(true);

    const [hiddenRoutes, setHiddenRoutes] = useState(() => new Set());
    const [statusFilter, setStatusFilter] = useState(null);
    const [selectedId, setSelectedId] = useState(null);

    const shownUnits = useMemo(
        () => units.filter((u) =>
            !hiddenRoutes.has(routeKey(u)) &&
            (statusFilter === null || (statusFilter === "online") === !!u.online)
        ),
        [units, hiddenRoutes, statusFilter]
    );

    const navigate = useNavigate();
    const isAuth = sessionStorage.getItem("auth") === "true";

    // ---------- 1. Создание карты ----------
    useEffect(() => {
        if (!isAuth) return;
        if (!containerRef.current) return;
        if (mapRef.current) return;

        const m = new mapboxgl.Map({
            container: containerRef.current, style: "mapbox://styles/mapbox/dark-v11", center, zoom, language: "ru"
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
    // ---------- 2. Слой маршрутов (пустой, наполняется SSE) ----------
useEffect(() => {
    if (!map) {
        console.log("[LAYER] пропускаю: map ещё не создан");
        return;
    }

    const add = () => {
        if (map.getSource("routes")) {
            console.log("[LAYER] источник 'routes' уже существует — пропускаю создание");
            return;
        }

        console.log("[LAYER] создаю источник 'routes' + слой 'routes-line'");

        map.addSource("routes", {
            type: "geojson",
            data: EMPTY_FC,
            generateId: true,
        });

        map.addLayer({
            id: "routes-line",
            type: "line",
            source: "routes",
            layout: {"line-join": "round", "line-cap": "round"},
            paint: {
                "line-color": ["coalesce", ["get", "color"], NO_ROUTE_COLOR],
                "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2, 12, 3.5, 15, 6],
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
            const routedNote = p.routed === false
                ? '<div class="popup-warn">линия не по дорогам</div>'
                : "";

            new mapboxgl.Popup({offset: 8})
                .setLngLat(e.lngLat)
                .setHTML(
                    `<div class="popup-title">Маршрут ${p.route ?? "—"}</div>` +
                    `<div class="popup-row"><span>ТС</span><span>${p.route_id ?? "—"}</span></div>` +
                    `<div class="popup-row"><span>Дистанция</span><span>${dist}</span></div>` +
                    `<div class="popup-row"><span>Время</span><span>${dur}</span></div>` +
                    routedNote
                )
                .addTo(map);
        });

        console.log("[LAYER] ✅ слой создан. Проверки:", {
            hasSource: !!map.getSource("routes"),
            hasLayer: !!map.getLayer("routes-line"),
            visibility: map.getLayoutProperty("routes-line", "visibility"),
            lineColorRule: map.getPaintProperty("routes-line", "line-color"),
            lineWidthRule: map.getPaintProperty("routes-line", "line-width"),
            NO_ROUTE_COLOR,
        });
    };

    if (map.isStyleLoaded()) {
        console.log("[LAYER] стиль уже загружен — добавляю сразу");
        add();
    } else {
        console.log("[LAYER] стиль ещё грузится — жду события load");
        map.once("load", () => {
            console.log("[LAYER] событие load получено");
            add();
        });
    }
}, [map]);

    // ---------- 3. SSE: маршруты по одному ----------
    // ---------- 3. SSE: маршруты по одному ----------
    useEffect(() => {
    if (!map) {
        console.log("[SSE] пропускаю: map ещё не создан");
        return;
    }

    let es = null;
    let closed = false;
    let msgIndex = 0;

    // Специальный набор — проблемные маршруты, за которыми следим особо
    const WATCH_IDS = new Set([122658, 130072]);

    const startStream = () => {
        if (closed) return;

        console.log("[SSE] подключаюсь к", ROUTES_STREAM_URL);
        es = new EventSource(ROUTES_STREAM_URL);

        es.onopen = () => {
            console.log("[SSE] ✅ соединение открыто");
            setRoutesError(null);
        };

        es.onmessage = (e) => {
            msgIndex++;

            let payload;
            try {
                payload = JSON.parse(e.data);
            } catch (err) {
                console.warn(`[SSE] #${msgIndex} parse error`, err, e.data?.slice?.(0, 200));
                return;
            }

            // ── служебный маркер конца потока ──
            if (payload.done) {
                console.log(
                    `[SSE] ✅ DONE. Всего фич: ${featuresRef.current.length}, ` +
                    `сообщений: ${msgIndex}`
                );
                console.log(
                    "[SSE] список route_id в источнике:",
                    featuresRef.current.map(f => f.properties?.route_id)
                );
                setRoutesLoading(false);
                setCurrentRoute(null);
                es.close();

                // финальная проверка источника и слоя
                const src = map.getSource("routes");
                if (src) {
                    console.log("[LAYER] финальное состояние источника:", {
                        totalFeatures: src._data?.features?.length ?? 0,
                        summary: src._data?.features?.map(f => ({
                            id: f.properties?.route_id,
                            nCoords: f.geometry?.coordinates?.length ?? 0,
                            color: f.properties?.color,
                            routed: f.properties?.routed,
                        })) ?? [],
                    });
                } else {
                    console.warn("[LAYER] ❌ источника 'routes' нет!");
                }
                return;
            }

            const feature = payload;
            const props = feature.properties ?? (feature.properties = {});
            const routeId = props.route_id;
            const numericId = Number(routeId);
            const isWatched = WATCH_IDS.has(numericId);

            // ── лог по каждой фиче ──
            const geom = feature.geometry;
            const coords = Array.isArray(geom?.coordinates) ? geom.coordinates : [];
            const nCoords = coords.length;

            const line = `[SSE] #${msgIndex} route_id=${routeId} ` +
                         `type=${geom?.type ?? "null"} ` +
                         `coords=${nCoords} ` +
                         `routed=${props.routed} ` +
                         `cached=${props.cached} ` +
                         `error=${props.error ?? "—"}`;

            if (isWatched) console.warn(`⚠️ ${line}`);
            else console.log(line);

            // ── детальный дамп именно проблемных маршрутов ──
            if (isWatched) {
                console.warn(`[SSE ⚠️] полный feature route_id=${routeId}:`, feature);
                console.warn(`[SSE ⚠️] первые 3 координаты:`, coords.slice(0, 3));
                console.warn(`[SSE ⚠️] последние 3 координаты:`, coords.slice(-3));
                console.warn(`[SSE ⚠️] properties полностью:`, props);

                if (nCoords === 0) {
                    console.error(
                        `[SSE ❌] route_id=${routeId}: геометрия ПУСТАЯ. ` +
                        `Сервер вернул routed=${props.routed}, error="${props.error ?? "-"}". ` +
                        `Скорее всего роутинг упал и кэш хранит ошибку.`
                    );
                } else if (nCoords === 1) {
                    console.warn(
                        `[SSE ⚠️] route_id=${routeId}: только 1 координата — ` +
                        `линию из одной точки нарисовать нельзя`
                    );
                } else if (nCoords === 2) {
                    const same =
                        coords[0][0] === coords[1][0] &&
                        coords[0][1] === coords[1][1];
                    if (same) {
                        console.error(
                            `[SSE ❌] route_id=${routeId}: 2 точки, но они ` +
                            `одинаковые — линия нулевой длины`
                        );
                    } else {
                        console.log(
                            `[SSE] route_id=${routeId}: 2 разные точки, ` +
                            `линия будет очень короткой`
                        );
                    }
                } else if (nCoords >= 2) {
                    console.log(
                        `[SSE] route_id=${routeId}: геометрия в порядке (${nCoords} точек). ` +
                        `Если не рисуется — проверь colorForRoute и цвет слоя.`
                    );
                }
            }

            // ── присвоение цвета ──
            const color = colorForRoute(routeId);
            if (isWatched) {
                console.log(
                    `[SSE] colorForRoute(${routeId}) = ${color} ` +
                    `(typeof=${typeof color})`
                );
                if (!color || typeof color !== "string") {
                    console.error(
                        `[SSE ❌] colorForRoute вернул невалидный цвет для ${routeId}: ` +
                        `${color} — линия получит NO_ROUTE_COLOR`
                    );
                }
            }
            props.color = color;

            // ── добавление в источник ──
            featuresRef.current.push(feature);
            setRouteCount(featuresRef.current.length);
            setCurrentRoute(routeId);

            const src = map.getSource("routes");
            if (!src) {
                console.error(
                    `[SSE ❌] источника 'routes' нет! setData не вызовется. ` +
                    `Проверь, отработал ли эффект №2.`
                );
                return;
            }

            src.setData({
                type: "FeatureCollection", features: featuresRef.current,
            });

            // Периодически логируем состояние источника
            if (msgIndex % 10 === 0 || isWatched) {
                console.log(
                    `[LAYER] после #${msgIndex}: features в источнике=${featuresRef.current.length}, ` +
                    `включая route_id=${routeId} (nCoords=${nCoords})`
                );
            }
        };

        es.onerror = (err) => {
            if (closed) return;
            console.error("[SSE] ❌ ошибка:", err);
            console.error(
                "[SSE] проверь: сервер на 127.0.0.1:8000 запущен, " +
                "эндпоинт /api/roads/stream отвечает, CORS настроен"
            );
            setRoutesError("Потеряно соединение с сервером");
            setRoutesLoading(false);
            es.close();
        };
    };

    if (map.isStyleLoaded()) {
        console.log("[SSE] стиль загружен — стартую стрим сразу");
        startStream();
    } else {
        console.log("[SSE] стиль ещё грузится — жду load");
        map.once("load", () => {
            console.log("[SSE] load получен, стартую стрим");
            startStream();
        });
    }

    return () => {
        console.log("[SSE] cleanup: закрываю соединение");
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
                            "text-color": "#c9d1d9", "text-halo-color": "#0e1116", "text-halo-width": 1.5,
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
                            .setHTML(
                                `<div class="popup-title">${p.stop_name ?? "Остановка"}</div>` +
                                `<div class="popup-row"><span>Остановка</span><span>${p.id ?? p.stop_id ?? "—"}</span></div>` +
                                `<div class="popup-row"><span>Маршрут</span><span>${p.route_id ?? "—"}</span></div>`
                            )
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

            // ring around the vehicle selected in the sidebar
            map.addLayer({
                id: "vehicles-selected", type: "circle", source: "vehicles", filter: ["get", "selected"], paint: {
                    "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 9, 12, 12, 15, 17],
                    "circle-color": "rgba(0,0,0,0)",
                    "circle-stroke-width": 2,
                    "circle-stroke-color": "#ffffff",
                },
            });

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
            // details of the clicked vehicle are shown in the sidebar card
            map.on("click", "vehicles-points", (e) => {
                setSelectedId(e.features[0].properties.unit_id);
            });
        };

        if (map.isStyleLoaded()) add(); else map.once("load", add);
    }, [map]);

    // ---------- 6. Обновление позиций автобусов ----------
    useEffect(() => {
        if (!map) return;
        const src = map.getSource("vehicles");
        if (!src) return;

        const features = shownUnits
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
                    selected: u.unit_id === selectedId,
                },
            }));

        src.setData({type: "FeatureCollection", features});
    }, [map, shownUnits, selectedId]);

    // ---------- 6a. Фильтр маршрутов для линий ----------
    useEffect(() => {
        if (!map || !map.getLayer("routes-line")) return;
        map.setFilter("routes-line", [
            "!",
            ["in", ["to-string", ["coalesce", ["get", "route"], "none"]], ["literal", [...hiddenRoutes]]],
        ]);
    }, [map, hiddenRoutes, routeCount]);

    // ---------- 7. WebSocket: телеметрия автобусов ----------
    useEffect(() => {
        if (!isAuth) return;

        let ws = null;
        let closed = false;
        let retryId = null;

        function connect() {
            ws = new WebSocket(`${WS_URL}/ws/vehicles`);

            setWsStatus("connecting");
            ws.onopen = () => setWsStatus("open");
            ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg.type === "telemetry") setUnits(msg.units ?? []);
                } catch (err) {
                    console.warn("WS parse error", err);
                }
            };
            ws.onclose = () => {
                if (closed) return;
                setWsStatus("closed");
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
        return <Navigate to="/Login" replace/>;
    }

    const handleLogout = () => {
        sessionStorage.removeItem("auth");
        navigate("/login", {replace: true});
    };

    const pickUnit = (unitId) => {
        setSelectedId(unitId);
        const u = units.find((x) => x.unit_id === unitId);
        if (map && u?.valid) map.flyTo({center: [u.lon, u.lat], zoom: Math.max(map.getZoom(), 13), duration: 800});
    };

    const toggleRoute = (key) =>
        setHiddenRoutes((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    // newest packet time; dataset vehicles (historical replay time) win over emulator ones (current time)
    const clockUnits = units.some((u) => u.tr_id != null) ? units.filter((u) => u.tr_id != null) : units;
    const clock = clockUnits.reduce((max, u) => (max === null || u.time > max ? u.time : max), null);

    const routesStatus = routesLoading
        ? `маршруты: загрузка ${routeCount}${currentRoute ? ` · ТС ${currentRoute}` : ""}`
        : routesError ? "маршруты: ошибка" : `маршрутов: ${routeCount}`;
    const stopsStatus = stopsLoading ? "остановки: загрузка" : stopsError ? "остановки: ошибка" : `остановок: ${stopsCount}`;

    return (
        <div className="dash">
            <Sidebar
                units={units}
                wsStatus={wsStatus}
                clock={clock}
                hiddenRoutes={hiddenRoutes}
                onToggleRoute={toggleRoute}
                onShowAllRoutes={() => setHiddenRoutes(new Set())}
                statusFilter={statusFilter}
                onStatusFilter={setStatusFilter}
                stopsVisible={stopsVisible}
                onStopsVisible={setStopsVisible}
                selectedId={selectedId}
                onPick={pickUnit}
                onClose={() => setSelectedId(null)}
                dataStatus={`${routesStatus} · ${stopsStatus}`}
                onLogout={handleLogout}
            />
            <main className="dash-map">
                <div ref={containerRef} className="dash-map-canvas"/>
            </main>
        </div>
    );
}