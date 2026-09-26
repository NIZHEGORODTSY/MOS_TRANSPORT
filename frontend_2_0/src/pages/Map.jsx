import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { fetchRoutesGeo, fetchStopsGeo } from '../api/geo'

mapboxgl.accessToken = "pk.eyJ1IjoibGlsZnJlZXp5IiwiYSI6ImNtdWQzaHJyajBhZzEyenM1dGV6bDlneWIifQ.j0-rvFgmpKdoglE48Jo5HQ"

export default function BusMap({ center = [37.618423, 55.751244], zoom = 11 }) {
  const mapContainer = useRef(null)
  const map = useRef(null)

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

          // --- Линии маршрутов ---
          m.addSource('routes', { type: 'geojson', data: routes })
          m.addLayer({
            id: 'routes-line',
            type: 'line',
            source: 'routes',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': '#4c8dff',
              'line-width': [
                'interpolate', ['linear'], ['zoom'],
                9, 1.5,
                12, 2.5,
                15, 4,
              ],
              'line-opacity': 0.75,
            },
          })

          // Подсветка маршрута при наведении
          m.on('mouseenter', 'routes-line', () => {
            m.getCanvas().style.cursor = 'pointer'
            m.setPaintProperty('routes-line', 'line-width', 5)
            m.setPaintProperty('routes-line', 'line-opacity', 1)
          })
          m.on('mouseleave', 'routes-line', () => {
            m.getCanvas().style.cursor = ''
            m.setPaintProperty('routes-line', 'line-width', [
              'interpolate', ['linear'], ['zoom'],
              9, 1.5, 12, 2.5, 15, 4,
            ])
            m.setPaintProperty('routes-line', 'line-opacity', 0.75)
          })

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
            minzoom: 12, // прячем точки на мелком зуме, чтобы не засорять карту
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