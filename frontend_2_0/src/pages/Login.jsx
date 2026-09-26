import { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';


export default function Login() {
  const navigate = useNavigate();
    
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();

    const { data } = await axios.post('http://localhost:8000/api/login', {
      login,
      password,
    });

    if (data === true) {      console.log('Успешный вход'); navigate('/Map'); localStorage.setItem('auth', 'true');  }
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