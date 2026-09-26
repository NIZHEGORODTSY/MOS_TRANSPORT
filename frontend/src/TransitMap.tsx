import MapGL, { NavigationControl, ScaleControl } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
const INITIAL_VIEW = { longitude: 37.55, latitude: 55.75, zoom: 9.6 };

export function TransitMap() {
  if (!TOKEN) {
    return (
      <div className="map-placeholder">
        <h2>Нужен токен Mapbox</h2>
        <p>
          Создайте файл <code>frontend/.env.local</code> со строкой
          <br />
          <code>VITE_MAPBOX_TOKEN=pk.…</code>
          <br />и перезапустите <code>npm run dev</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="map-wrap">
      <MapGL mapboxAccessToken={TOKEN} initialViewState={INITIAL_VIEW} mapStyle="mapbox://styles/mapbox/dark-v11" language="ru">
        <NavigationControl position="top-right" />
        <ScaleControl position="bottom-right" />
      </MapGL>
    </div>
  );
}
