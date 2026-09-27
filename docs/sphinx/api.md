# API

## Бэкенд

Интерактивный Swagger — `/docs` на сайте (например, <http://localhost:8080/docs>), ReDoc — `/redoc`.
Спецификация OpenAPI 3: [openapi.json](api/openapi.json).

| Метод и путь | Группа | Что возвращает |
|---|---|---|
| `GET /api/predictions` | Прогноз | прогнозы всех ТС и состояние цикла прогноза |
| `GET /api/predictions/{tr_id}/history` | Прогноз | ряд прогнозов ТС за час |
| `GET /api/ml/health` | Прогноз | доступность ML-сервиса |
| `GET /api/telemetry` | Телеметрия | состояние всех терминалов с прогнозами |
| `GET /api/telemetry/stats` | Телеметрия | статистика приёмника NDTP |
| `POST /api/emulator/start` | Эмулятор | направить эмулятор NDTP на приёмник |
| `POST /api/emulator/stop` | Эмулятор | остановить эмулятор |
| `GET /api/roads/stream` | Геоданные | маршруты по дорогам, SSE |
| `GET /api/routes/geojson`, `GET /api/stops/geojson`, `GET /api/roads` | Геоданные | маршруты и остановки для карты |
| `POST /api/login` | Авторизация | вход диспетчера |
| `GET /api/health` | Служебные | бэкенд работает |

**WebSocket** `/ws/vehicles`: при подключении и далее раз в секунду — JSON как у `GET /api/telemetry`.

Пример прогноза ТС из `GET /api/predictions`:

```json
{
  "delay_s": 76,
  "risk": "risk",
  "stop_id": 53699433881,
  "address": "2-я Мякининская ул., д.8",
  "plan_time": "2026-01-06T07:07:00Z",
  "expected_time": "2026-01-06T07:08:16Z",
  "at": "2026-01-06T06:55:33Z",
  "horizon_s": 687,
  "computed_at": "2026-09-27T16:30:39Z"
}
```

`at` — момент прогноза (последний пакет ТС), `horizon_s` — сколько секунд от него до планового
прибытия (600–900), `expected_time` — плановое время плюс прогноз задержки.

## ML-сервис

Доступен только внутри сети Docker. Спецификация — [ml_openapi.json](api/ml_openapi.json).

| Метод и путь | Что делает |
|---|---|
| `POST /set_context` | принимает телеметрию и плановое расписание, строит контекст (map matching, признаки) |
| `POST /predict` | точки `tr_id, T, target_stop_id, target_time_begin, cur_dev_s` → задержки, с |
| `GET /health` | состояние и число ТС в контексте |
