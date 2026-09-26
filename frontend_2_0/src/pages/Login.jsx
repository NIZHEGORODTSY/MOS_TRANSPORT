import { useState } from 'react';

export default function Login() {
    
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();

    const api = axios.create({
      baseURL: 'http://localhost:8000',
    });

    const { data } = await api.post('/api/login', {
      login,
      password,
    });

    if (data === true) {      console.log('Успешный вход');    }
    else {setError('Неверный логин или пароль');}
  };

  return (
    <form onSubmit={handleSubmit}>
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

      <button type="submit">Войти</button>
    </form>
  );
}