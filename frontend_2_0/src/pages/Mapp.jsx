import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

mapboxgl.accessToken = "pk.eyJ1IjoibGlsZnJlZXp5IiwiYSI6ImNtdWQzaHJyajBhZzEyenM1dGV6bDlneWIifQ.j0-rvFgmpKdoglE48Jo5HQ"

const API_URL = import.meta.env.VITE_API_URL || ''
const STREAM_URL = `${API_URL}/api/roads/stream`

const ROUTE_COLORS = [
  '#4c8dff', '#22c55e', '#ef4444', '#f59e0b', '#a855f7',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6',
  '#8b5cf6', '#eab308', '#dc2626',
]

export default function Mapp() {
  const mapContainer = useRef(null)
  const map = useRef(null)
  const featuresRef = useRef([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [routeCount, setRouteCount] = useState(0)
  const [currentRoute, setCurrentRoute] = useState(null)

  useEffect(() => {
    if (!mapContainer.current) return
    if (map.current) return

    const m = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [37.618423, 55.751244],
      zoom: 11,
    })
    m.addControl(new mapboxgl.NavigationControl(), 'top-right')
    map.current = m

    m.on('load', () => {
      m.addSource('routes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        generateId: true,
      })

      m.addLayer({
        id: 'routes-line',
        type: 'line',
        source: 'routes',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': [
            'match', ['get', 'route_id'],
            ...flattenColors(),
            '#888888',
          ],
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            9, 2,
            12, 3.5,
            15, 6,
          ],
          'line-opacity': 0.85,
        },
      })

      m.addLayer({
        id: 'routes-point',
        type: 'circle',
        source: 'routes',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 4,
          'circle-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#a970ff',
        },
      })

      m.on('mouseenter', 'routes-line', () => {
        m.getCanvas().style.cursor = 'pointer'
      })
      m.on('mouseleave', 'routes-line', () => {
        m.getCanvas().style.cursor = ''
      })

      m.on('click', 'routes-line', (e) => {
        const p = e.features[0].properties || {}
        const dist = p.distance_m ? `${(p.distance_m / 1000).toFixed(2)} км` : '—'
        const dur = p.duration_s ? `${(p.duration_s / 60).toFixed(1)} мин` : '—'
        const routedNote = p.routed === false
          ? '<em style="color:#a00">не по дорогам</em>'
          : 'по дорогам'

        new mapboxgl.Popup({ offset: 8 })
          .setLngLat(e.lngLat)
          .setHTML(
            `<strong>Маршрут ${p.route_id ?? '—'}</strong><br/>` +
            `Дистанция: ${dist}<br/>` +
            `Время: ${dur}<br/>` +
            `${routedNote}`
          )
          .addTo(m)
      })
    })

    const es = new EventSource(STREAM_URL)

    es.onmessage = (e) => {
      let payload
      try {
        payload = JSON.parse(e.data)
      } catch (err) {
        console.warn('SSE parse error', err)
        return
      }

      if (payload.done) {
        console.log(`Все ${featuresRef.current.length} маршрутов загружены`)
        setLoading(false)
        setCurrentRoute(null)
        es.close()
        return
      }

      const feature = payload
      const routeId = feature.properties?.route_id

      featuresRef.current.push(feature)
      setRouteCount(featuresRef.current.length)
      setCurrentRoute(routeId)

      const src = m.getSource('routes')
      if (src) {
        src.setData({
          type: 'FeatureCollection',
          features: featuresRef.current,
        })
      }
    }

    es.onerror = (err) => {
      console.error('SSE ошибка:', err)
      setError('Потеряно соединение с сервером')
      setLoading(false)
      es.close()
    }

    return () => {
      es.close()
      m.remove()
      map.current = null
      featuresRef.current = []
    }
  }, [])

  return (
    <div style={{ position: 'relative', width: '100%', height: '600px' }}>
      {loading && (
        <div style={overlayStyle}>
          Загружаю маршруты... {routeCount > 0 && `(${routeCount} готово)`}
          {currentRoute && ` — маршрут ${currentRoute}`}
        </div>
      )}

      {error && (
        <div style={{ ...overlayStyle, background: 'rgba(180,0,0,0.85)' }}>
          {error}
        </div>
      )}

      {!loading && !error && (
        <div style={{ ...overlayStyle, background: 'rgba(0,0,0,0.65)' }}>
          Маршрутов: {routeCount}
        </div>
      )}

      <div
        ref={mapContainer}
        style={{ width: '100%', height: '100%', borderRadius: 8 }}
      />
    </div>
  )
}

const overlayStyle = {
  position: 'absolute',
  top: 16,
  left: 16,
  zIndex: 1000,
  padding: '8px 16px',
  background: 'rgba(0,0,0,0.75)',
  color: 'white',
  borderRadius: 4,
  fontSize: 14,
}

function flattenColors() {
  const arr = []
  ROUTE_COLORS.forEach((color, i) => {
    arr.push(i, color)
  })
  return arr
}