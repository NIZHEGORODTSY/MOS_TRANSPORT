import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

mapboxgl.accessToken = "pk.eyJ1IjoibGlsZnJlZXp5IiwiYSI6ImNtdWQzaHJyajBhZzEyenM1dGV6bDlneWIifQ.j0-rvFgmpKdoglE48Jo5HQ"

export default function BusMap({ center = [37.618423, 55.751244], zoom = 12 }) {
  const mapContainer = useRef(null)
  const map = useRef(null)

  useEffect(() => {
    if (map.current) return // защита от двойного вызова в StrictMode

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12', // стиль карты
      center,
      zoom,
    })

    // Добавляем навигационные контролы
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')

    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  return (
    <div
      ref={mapContainer}
      style={{ width: '100%', height: '600px', borderRadius: '8px' }}
    />
  )
}