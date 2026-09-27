import { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import './Login.css';   // подключаем стили

export default function Login() {
  const navigate = useNavigate();

  const [login, setLogin] = useState('operator');
  const [password, setPassword] = useState('secret123');
  const [error, setError] = useState('');   // ← добавили состояние ошибки

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    try {
      const { data } = await axios.post('http://localhost:8000/api/login', {
        login,
        password,
      });

      if (data === true) {
        console.log('Успешный вход');
        sessionStorage.setItem('auth', 'true');
        navigate('/Map');
      } else {
        setError('Неверный логин или пароль');
      }
    } catch (err) {
      console.error(err);
      setError('Ошибка сервера, попробуйте позже');
    }
  };

  return (
    <div className="login-page">
      <form className="login-form" onSubmit={handleSubmit}>
        <h1>Вход</h1>

        <input
          type="text"
          placeholder="Логин"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
        />

        <input
          type="password"
          placeholder="Пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <p className="login-error">{error}</p>}

        <button type="submit">Войти</button>
      </form>
    </div>
  );
}