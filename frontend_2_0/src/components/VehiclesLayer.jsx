import {useEffect} from "react";

const EMPTY = {type: "FeatureCollection", features: []};

export default function VehiclesLayer({map, units}) {
    useEffect(() => {
        if (!map) return;

        const add = () => {
            if (map.getSource("vehicles")) return;

            map.addSource("vehicles", {type: "geojson", data: EMPTY});

            map.addLayer({
                id: "vehicles-symbol",
                type: "symbol",
                source: "vehicles",
                layout: {
                    "icon-image": "bus-icon",
                    "icon-size": 0.5,
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": true,
                    "icon-rotate": ["get", "course"],
                    "icon-rotation-alignment": "map",
                },
            });

            map.on("click", "vehicles-symbol", (e) => {
                const f = e.features[0];
                const p = f.properties;
                new window.mapboxgl.Popup()
                    .setLngLat(f.geometry.coordinates)
                    .setHTML(
                        `<strong>Машина #${p.unit_id}</strong><br/>` +
                        `маршрут: ${p.route_id ?? "—"}<br/>` +
                        `скорость: ${p.speed ?? "—"} км/ч`
                    )
                    .addTo(map);
            });
            map.on("mouseenter", "vehicles-symbol", () => (map.getCanvas().style.cursor = "pointer"));
            map.on("mouseleave", "vehicles-symbol", () => (map.getCanvas().style.cursor = ""));
        };

        if (map.isStyleLoaded()) add();
        else map.once("load", add);
    }, [map]);

    useEffect(() => {
        if (!map || !map.getSource("vehicles")) return;

        const features = units
            .filter((u) => u.valid && typeof u.lat === "number" && typeof u.lon === "number")
            .map((u) => ({
                type: "Feature",
                geometry: {type: "Point", coordinates: [u.lon, u.lat]},
                properties: {
                    unit_id: u.unit_id,
                    course: u.course ?? 0,
                    speed: u.speed ?? null,
                    route_id: u.route_id ?? null,
                    online: u.online,
                },
            }));

        map.getSource("vehicles").setData({type: "FeatureCollection", features});
    }, [map, units]);

    return null;
}