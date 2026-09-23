# Route geometry and stops come from these OpenStreetMap relations (one per direction);
# run `python -m app.build_geometry` after changing them.
ROUTES = [
    {
        "id": "B",
        "name": "Б",
        "title": "Садовое кольцо",
        "color": "#4c8dff",
        "vehicles": 10,
        "osm": [1343003],
    },
    {
        "id": "m1",
        "name": "м1",
        "title": "Метро «Новаторская» — Больница РЖД",
        "color": "#a970ff",
        "vehicles": 14,
        "osm": [3228821, 3228965],
    },
    {
        "id": "m2",
        "name": "м2",
        "title": "Метро «Парк Победы» — Метро «Владыкино»",
        "color": "#22c3e6",
        "vehicles": 14,
        "osm": [11865871, 11865872],
    },
    {
        "id": "m3",
        "name": "м3",
        "title": "Проспект Будённого — Серебряный Бор",
        "color": "#ff7ab8",
        "vehicles": 12,
        "osm": [3132036, 3132037],
    },
    {
        "id": "m16",
        "name": "м16",
        "title": "Метро «Октябрьская» — Метро «Озёрная»",
        "color": "#3ddbb0",
        "vehicles": 10,
        "osm": [3225737, 374043],
    },
]
