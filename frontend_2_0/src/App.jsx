import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import Map from './pages/Map';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/login" element={<Login />} />
        <Route path="/map" element={<Map />} />
      </Routes>
    </BrowserRouter>
  );
}
export default App
