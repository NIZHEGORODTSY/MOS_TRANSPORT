import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import { Navigate, useNavigate } from 'react-router-dom';
import 'mapbox-gl/dist/mapbox-gl.css'

mapboxgl.accessToken = "pk.eyJ1IjoibGlsZnJlZXp5IiwiYSI6ImNtdWQzaHJyajBhZzEyenM1dGV6bDlneWIifQ.j0-rvFgmpKdoglE48Jo5HQ"

export default function BusMap({ center = [37.618423, 55.751244], zoom = 12 }) {
  const mapContainer = useRef(null)
  const map = useRef(null)
  const navigate = useNavigate()

  const isAuth = localStorage.getItem('auth') === 'true';

  if (!isAuth) {
    return <Navigate to="/login" replace />;
  }

  const handleLogout = () => {
    localStorage.removeItem('auth');
    navigate('/login', { replace: true });
  };

  // Пока не авторизован — ничего не рендерим (чтобы не мигала карта)
  if (!isAuth) {
    return null;
  }

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
  <div style={{ padding: '16px' }}>
    <button onClick={handleLogout}>Выйти</button>

    <div
      ref={mapContainer}
      style={{ width: '100%', height: '600px', borderRadius: '8px', marginTop: '12px' }}
    />
  </div>
  );
}