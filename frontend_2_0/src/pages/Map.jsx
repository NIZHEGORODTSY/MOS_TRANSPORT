import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { fetchRoutesGeo, fetchStopsGeo } from '../api/geo'

mapboxgl.accessToken = "pk.eyJ1IjoibGlsZnJlZXp5IiwiYSI6ImNtdWQzaHJyajBhZzEyenM1dGV6bDlneWIifQ.j0-rvFgmpKdoglE48Jo5HQ"

// Выносим выражения наружу — используем в addLayer и в mouseleave (не нужно)
// Это избавляет от дублирования формулы толщины линии
const ROUTE_WIDTH_BASE = [
  'interpolate', ['linear'], ['zoom'],
  9, 1.5,
  12, 2.5,
  15, 4,
]
const ROUTE_OPACITY_BASE = 0.75

export default function BusMap({ center = [37.618423, 55.751244], zoom = 11 }) {
  const mapContainer = useRef(null)
  const map = useRef(null)
  const hoveredId = useRef(null)   // ← ИЗМЕНЕНО: id фичи, на которую наведён курсор

  // 1. Создаём карту
  useEffect(() => {
    if (map.current) return
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center,
      zoom,
    })
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')
    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  // 2. Грузим и рисуем
  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [routes, stops] = await Promise.all([
          fetchRoutesGeo(),
          fetchStopsGeo(),
        ])
        if (cancelled) return
        const m = map.current
        if (!m) return

        const draw = () => {
          if (m.getSource('routes')) return
          console.log(routes)

          // --- Линии маршрутов ---
          // ← ИЗМЕНЕНО: добавили generateId, чтобы у каждой фичи был свой id
          m.addSource('routes', {
            type: 'geojson',
            data: routes,
            generateId: true,
          })

          m.addLayer({
            id: 'routes-line',
            type: 'line',
            source: 'routes',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': '#4c8dff',

              // ← ИЗМЕНЕНО: толщина зависит от feature-state 'hover' конкретной фичи
              'line-width': [
                'interpolate', ['linear'], ['zoom'],
                9,  ['case', ['boolean', ['feature-state', 'hover'], false], 5, 1.5],
                12, ['case', ['boolean', ['feature-state', 'hover'], false], 5, 2.5],
                15, ['case', ['boolean', ['feature-state', 'hover'], false], 5, 4],
              ], 

              // ← ИЗМЕНЕНО: прозрачность тоже зависит от hover конкретной фичи
              'line-opacity': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                1,                    // hover — полностью непрозрачно
                ROUTE_OPACITY_BASE,   // иначе — 0.75
              ],
            },
          })

          // --- Подсветка ОДНОГО маршрута при наведении ---
          // ← ИЗМЕНЕНО: вместо mouseenter/setPaintProperty используем mousemove + setFeatureState

          m.on('mousemove', 'routes-line', (e) => {
            if (!e.features.length) return

            const feature = e.features[0]

            // Если уже на этой же фиче — ничего не делаем
            if (hoveredId.current === feature.id) return

            // Снимаем hover с предыдущей фичи
            if (hoveredId.current !== null) {
              m.setFeatureState(
                { source: 'routes', id: hoveredId.current },
                { hover: false }
              )
            }

            // Ставим hover на новую
            hoveredId.current = feature.id
            m.setFeatureState(
              { source: 'routes', id: hoveredId.current },
              { hover: true }
            )

            m.getCanvas().style.cursor = 'pointer'
          })

          m.on('mouseleave', 'routes-line', () => {
            if (hoveredId.current !== null) {
              m.setFeatureState(
                { source: 'routes', id: hoveredId.current },
                { hover: false }
              )
              hoveredId.current = null
            }
            m.getCanvas().style.cursor = ''
          })

          // --- Клик по маршруту ---
          m.on('click', 'routes-line', (e) => {
            const f = e.features[0]
            const routeId = f.properties.route_id
            new mapboxgl.Popup()
              .setLngLat(e.lngLat)
              .setHTML(`<strong>Маршрут ${routeId}</strong>`)
              .addTo(m)
          })

          // --- Точки остановок ---
          m.addSource('stops', { type: 'geojson', data: stops })
          m.addLayer({
            id: 'stops-circles',
            type: 'circle',
            source: 'stops',
            minzoom: 12,
            paint: {
              'circle-radius': 4,
              'circle-color': '#ffffff',
              'circle-stroke-width': 1.5,
              'circle-stroke-color': '#a970ff',
            },
          })

          m.on('click', 'stops-circles', (e) => {
            const f = e.features[0]
            const [lon, lat] = f.geometry.coordinates
            new mapboxgl.Popup()
              .setLngLat([lon, lat])
              .setHTML(
                `<strong>Остановка</strong><br/>id: ${f.properties.stop_id}<br/>маршрут: ${f.properties.route_id}`
              )
              .addTo(m)
          })

          m.on('mouseenter', 'stops-circles', () => (m.getCanvas().style.cursor = 'pointer'))
          m.on('mouseleave', 'stops-circles', () => (m.getCanvas().style.cursor = ''))
        }

        if (m.isStyleLoaded()) draw()
        else m.once('load', draw)
      } catch (err) {
        console.error('Failed to load geo data:', err)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  return (
    <div
      ref={mapContainer}
      style={{ width: '100%', height: '600px', borderRadius: '8px' }}
    />
  )
}