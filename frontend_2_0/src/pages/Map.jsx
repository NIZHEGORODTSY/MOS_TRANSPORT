import {useEffect, useRef, useState} from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {api} from "../api/client";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://127.0.0.1:8000";
const EMPTY_FC = {type: "FeatureCollection", features: []};

export default function BusMap({
                                   center = [37.618423, 55.751244],
                                   zoom = 11,
                                   height = "600px",
                               }) {
    const containerRef = useRef(null);
    const mapRef = useRef(null);
    const [map, setMap] = useState(null);
    const [units, setUnits] = useState([]);
    const [wsError, setWsError] = useState(null);

    // ---------- 1. Карта ----------
    useEffect(() => {
        if (mapRef.current) return;
        const m = new mapboxgl.Map({
            container: containerRef.current,
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
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ---------- 2. Иконка автобуса ----------
    useEffect(() => {
        if (!map) return;
        const add = () => {
            if (map.hasImage("bus-icon")) return;
            map.loadImage("/bus.png", (err, image) => {
                if (err) {
                    console.error("Не удалось загрузить /bus.png", err);
                    return;
                }
                if (!map.hasImage("bus-icon")) map.addImage("bus-icon", image);
            });
        };
        if (map.isStyleLoaded()) add();
        else map.once("load", add);
    }, [map]);

    // ---------- 3. Маршруты + остановки ----------
    useEffect(() => {
        if (!map) return;
        let cancelled = false;

        async function load() {
            try {
                // Если у вас две отдельные ручки:
                // const [routes, stops] = await Promise.all([
                //   api.get("/api/routes/geojson").then((r) => r.data),
                //   api.get("/api/stops/geojson").then((r) => r.data),
                // ]);
                const {data} = await api.get("/api/map");
                const routes = data.routes ?? EMPTY_FC;
                const stops = data.stops ?? EMPTY_FC;
                if (cancelled) return;

                const draw = () => {
                    // Линии маршрутов
                    if (!map.getSource("routes")) {
                        map.addSource("routes", {type: "geojson", data: routes});
                        map.addLayer({
                            id: "routes-line",
                            type: "line",
                            source: "routes",
                            layout: {"line-join": "round", "line-cap": "round"},
                            paint: {
                                "line-color": "#4c8dff",
                                "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.5, 12, 2.5, 15, 4],
                                "line-opacity": 0.75,
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
                            new mapboxgl.Popup()
                                .setLngLat(e.lngLat)
                                .setHTML(`<strong>Маршрут ${f.properties.route_id ?? "—"}</strong>`)
                                .addTo(map);
                        });
                    }

                    // Остановки
                    if (!map.getSource("stops")) {
                        map.addSource("stops", {type: "geojson", data: stops});
                        map.addLayer({
                            id: "stops-circles",
                            type: "circle",
                            source: "stops",
                            minzoom: 12,
                            paint: {
                                "circle-radius": 4,
                                "circle-color": "#ffffff",
                                "circle-stroke-width": 1.5,
                                "circle-stroke-color": "#a970ff",
                            },
                        });
                        map.on("mouseenter", "stops-circles", () => {
                            map.getCanvas().style.cursor = "pointer";
                        });
                        map.on("mouseleave", "stops-circles", () => {
                            map.getCanvas().style.cursor = "";
                        });
                        map.on("click", "stops-circles", (e) => {
                            const f = e.features[0];
                            const [lon, lat] = f.geometry.coordinates;
                            new mapboxgl.Popup()
                                .setLngLat([lon, lat])
                                .setHTML(
                                    `<strong>Остановка</strong><br/>` +
                                    `id: ${f.properties.stop_id}<br/>` +
                                    `маршрут: ${f.properties.route_id ?? "—"}`
                                )
                                .addTo(map);
                        });
                    }
                };

                if (map.isStyleLoaded()) draw();
                else map.once("load", draw);
            } catch (err) {
                console.error("Ошибка загрузки карты:", err);
            }
        }

        load();
        return () => {
            cancelled = true;
        };
    }, [map]);

    // ---------- 4. Слой автобусов ----------
    useEffect(() => {
        if (!map) return;
        const add = () => {
            if (map.getSource("vehicles")) return;

            map.addSource("vehicles", {type: "geojson", data: EMPTY_FC});

            map.addLayer({
                id: "vehicles-symbol",
                type: "symbol",
                source: "vehicles",
                layout: {
                    "icon-image": "bus-icon",
                    "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.4, 14, 0.7],
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": true,
                    "icon-rotate": ["coalesce", ["get", "course"], 0],
                    "icon-rotation-alignment": "map",
                },
            });

            map.on("mouseenter", "vehicles-symbol", () => {
                map.getCanvas().style.cursor = "pointer";
            });
            map.on("mouseleave", "vehicles-symbol", () => {
                map.getCanvas().style.cursor = "";
            });
            map.on("click", "vehicles-symbol", (e) => {
                const f = e.features[0];
                const p = f.properties;
                new mapboxgl.Popup({offset: 12})
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
                geometry: {type: "Point", coordinates: [u.lon, u.lat]},
                properties: {
                    unit_id: u.unit_id,
                    course: typeof u.course === "number" ? u.course : 0,
                    speed: u.speed ?? null,
                    route_id: u.route_id ?? null,
                    age_s: u.age_s ?? null,
                },
            }));

        src.setData({type: "FeatureCollection", features});
    }, [map, units]);

    // ---------- 6. WebSocket ----------
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

    return (
        <div style={{position: "relative", width: "100%", height}}>
            <div ref={containerRef} style={{width: "100%", height: "100%", borderRadius: 8}}/>

            {wsError && (
                <div
                    style={{
                        position: "absolute",
                        top: 8,
                        left: 8,
                        background: "rgba(220,38,38,0.9)",
                        color: "#fff",
                        padding: "4px 8px",
                        borderRadius: 4,
                        fontSize: 12,
                    }}
                >
                    {wsError}
                </div>
            )}

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
                }}
            >
                Автобусов онлайн: {onlineCount}
            </div>
        </div>
    );
}