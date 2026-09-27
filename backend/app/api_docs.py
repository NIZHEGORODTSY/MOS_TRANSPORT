"""Тексты и примеры для OpenAPI/Swagger бэкенда (``/docs``, ``/openapi.json``).

Вынесены из ``app.main``, чтобы описания API не смешивались с кодом эндпоинтов.
Примеры ответов взяты из работы системы на потоке 06.01.2026.
"""

DESCRIPTION = """
Бэкенд диспетчерской системы прогноза задержек городского транспорта.

**Поток данных.** Приёмник NDTP (TCP, порт 9201) разбирает навигационные пакеты терминалов и хранит
историю каждого ТС за последний час. Раз в 30 с цикл прогноза отправляет историю и плановое расписание
в ML-сервис и получает прогноз задержки на первой остановке, плановое прибытие на которую через
**10–15 минут**. Состояние ТС вместе с прогнозами рассылается дашборду по WebSocket раз в секунду.

**С чего начать:**
* `GET /api/telemetry/stats` — идёт ли поток NDTP;
* `GET /api/predictions` — текущие прогнозы и состояние цикла прогноза (`elapsed_s`, ошибки ML);
* `GET /api/predictions/{tr_id}/history` — ряд прогнозов одного ТС за час.

**Уровень риска** (`risk`) по прогнозу задержки на целевой остановке:
`late` — больше +3 мин, `risk` — от +1 до +3 мин, `on_time` — в пределах ±1 мин, `early` — раньше графика больше чем на 1 мин.

Все времена — ISO 8601 в UTC (`Z`); дашборд показывает их по Москве.

**WebSocket** `/ws/vehicles` (в Swagger не отображается): при подключении и далее раз в секунду
приходит JSON как у `GET /api/telemetry`.
"""

TAGS = [
    {"name": "Прогноз", "description": "Прогнозы задержек ML-модели по живому потоку NDTP."},
    {"name": "Телеметрия", "description": "Последнее состояние ТС и статистика приёмника NDTP."},
    {"name": "Эмулятор", "description": "Управление эмулятором NDTP организаторов: он шлёт пакеты на приёмник бэкенда."},
    {"name": "Геоданные", "description": "Маршруты и остановки для карты (из базы команды и сервера маршрутизации)."},
    {"name": "Авторизация", "description": "Вход диспетчера."},
    {"name": "Служебные", "description": "Проверка работоспособности."},
]

PREDICTION = {
    "delay_s": 76,
    "risk": "risk",
    "stop_id": 53699433881,
    "address": "2-я Мякининская ул., д.8",
    "plan_time": "2026-01-06T07:07:00Z",
    "expected_time": "2026-01-06T07:08:16Z",
    "at": "2026-01-06T06:55:33Z",
    "horizon_s": 687,
    "computed_at": "2026-09-27T16:30:39Z",
}

PREDICTIONS_EXAMPLE = {
    "status": {"state": "ok", "error": None, "last_run": "2026-09-27T16:30:39Z", "points": 7, "elapsed_s": 0.57},
    "predictions": {"122658": PREDICTION},
}

HISTORY_EXAMPLE = [
    {"at": "2026-01-06T05:48:05Z", "delay_s": 22, "risk": "on_time"},
    {"at": "2026-01-06T05:53:19Z", "delay_s": 76, "risk": "risk"},
]

UNIT_EXAMPLE = {
    "unit_id": 893159,
    "lon": 37.7485,
    "lat": 55.6139,
    "alt": 0,
    "speed": 17,
    "speed_max": 17,
    "course": 125,
    "nsat": 0,
    "pdop": 0,
    "valid": True,
    "battery_mv": 0,
    "time": "2026-01-06T06:02:05Z",
    "received_at": "2026-09-27T16:30:40Z",
    "age_s": 0.4,
    "online": True,
    "tr_id": 122048,
    "route_id": 1,
    "prediction": PREDICTION,
}

TELEMETRY_EXAMPLE = {"type": "telemetry", "time": "2026-09-27T16:30:40Z", "units": [UNIT_EXAMPLE]}

STATS_EXAMPLE = {
    "listening": True,
    "uptime_s": 246.8,
    "open_connections": 42,
    "units": 42,
    "units_online": 40,
    "packets": 21603,
    "nav_packets": 21561,
    "handshakes": 42,
    "bad_crc": 0,
    "skipped_bytes": 0,
    "packets_per_s": 87.54,
    "avg_parse_us": 90.2,
    "history_vehicles": 17,
    "history_points": 3969,
}


def example(value) -> dict:
    """Описание успешного ответа с примером для параметра ``responses`` эндпоинта."""
    return {200: {"content": {"application/json": {"example": value}}}}
