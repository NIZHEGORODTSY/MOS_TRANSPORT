import { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import './Login.css';

export default function Login() {
  const navigate = useNavigate();

  const [login, setLogin] = useState('operator');
  const [password, setPassword] = useState('secret123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data } = await axios.post('http://localhost:8000/api/login', {
        login,
        password,
      });

      if (data === true) {
        sessionStorage.setItem('auth', 'true');
        sessionStorage.setItem("login", login); 
        navigate('/Map');
      } else {
        setError('Неверный логин или пароль');
      }
    } catch (err) {
      console.error(err);
      setError('Ошибка сервера, попробуйте позже');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-form" onSubmit={handleSubmit}>
        <div className="login-head">
          <img className="login-logo" src="/favicon.svg" alt="" />
          <div>
            <h1>МосТранспорт</h1>
            <p>Диспетчерская · прогноз задержек</p>
          </div>
        </div>

        <label className="login-field">
          <span>Логин</span>
          <input
            type="text"
            autoComplete="username"
            autoFocus
            required
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
        </label>

        <label className="login-field">
          <span>Пароль</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && <p className="login-error">{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
