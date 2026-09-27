# Архитектура

Система состоит из трёх независимых модулей — ML-ядра, бэкенда и BI-дашборда — и поднимается
одной командой `docker compose up`.

```
 NDTP-поток                ┌──────────────────────── docker compose ────────────────────────┐
 (replayer / эмулятор) ──► │ backend  :9201 NDTP  ──► TelemetryStore (история за час)        │
                           │   │  раз в 30 с: история + расписание ──► ml  /set_context      │
                           │   │               точки прогноза       ──► ml  /predict          │
                           │   └── /api, /ws/vehicles (1 с) ◄── frontend (nginx) ◄── браузер  │
                           └────────────────────────────────────────────────────────────────┘
```

| Сервис | Код | Роль |
|---|---|---|
| `ml` | `ml_service/` | ML-ядро: map matching, признаки, ансамбль CatBoost + PyTorch GRU; API `/set_context`, `/predict`, `/health` |
| `backend` | `backend/app`, `backend/ndtp` | приём и разбор NDTP, история ТС, цикл прогноза, REST API, WebSocket, Swagger |
| `replayer` | `backend/ndtp/replayer.py` | исторический датасет → живой NDTP-поток (тот же образ, что `backend`) |
| `frontend` | `frontend_2_0/` | дашборд на React + Mapbox GL; nginx раздаёт его и проксирует `/api`, `/ws`, `/docs` |
| `emulator` | образ организаторов | эмулятор NDTP (профиль `emulator`) |

## Поток данных

1. **Приём.** Терминалы (replayer, эмулятор или реальный источник) подключаются по TCP к порту 9201.
   {class}`app.telemetry.TelemetryStore` разбирает кадры модулем {mod}`ndtp.ndtp` и хранит последнее
   состояние каждого терминала и историю GPS-точек реальных ТС за час.
2. **Прогноз.** Раз в 30 секунд {func}`app.main.run_predictions` отправляет историю и плановое
   расписание в ML-сервис ({func}`app.predictor.set_context`), выбирает для каждого ТС целевую
   остановку ({func}`app.predictor.make_points`) и получает задержки ({func}`app.predictor.predict`).
3. **Дашборд.** {func}`app.main.broadcast` раз в секунду рассылает по WebSocket `/ws/vehicles`
   состояние всех ТС вместе с прогнозами; ряд прогнозов ТС для графика — `GET /api/predictions/{tr_id}/history`.

## Разделение модулей

* ML-ядро — отдельный сервис со своим API и окружением (torch, CatBoost); бэкенд обращается к нему
  только по HTTP (`ML_SERVICE_URL`) и продолжает работать, если ML недоступен.
* Наружу открыт один порт — nginx дашборда. ML-сервис доступен только внутри сети Docker,
  API бэкенда и порт NDTP проброшены лишь на `127.0.0.1` хоста.
* Логин диспетчеров и геометрия маршрутов — в базе команды (PostgreSQL, `DATABASE_URL`),
  справочники датасета и расписание — в образе бэкенда.
