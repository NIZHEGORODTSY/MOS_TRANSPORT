# Развёртывание

```{include} ../../README.md
:start-after: "## Запуск"
:end-before: "## Инструкция для жюри"
```

## Настройки

| Файл | Переменная | Назначение |
|---|---|---|
| `.env` | `WEB_PORT` | публичный порт дашборда (по умолчанию 8080) |
| `.env` | `REPLAY_SPEED` | скорость проигрывания датасета: 1 — реальное время |
| `.env` | `API_PORT`, `NDTP_PORT` | порты API и NDTP на `127.0.0.1` хоста |
| `backend/.env` | `DATABASE_URL` | база команды: логины диспетчеров и геометрия маршрутов |
| compose | `ML_SERVICE_URL` | адрес ML-сервиса (`http://ml:8001`) |
| compose | `EMULATOR_API`, `EMULATOR_TARGET_HOST` | эмулятор NDTP и адрес приёмника для него |
| — | `ML_PREDICT_S`, `ML_MIN_TRACK_S` | период цикла прогноза (30 с) и минимум истории ТС (900 с) |
| — | `OSMNX_URL` | сервер маршрутизации по дорогам |

## Сборка документации

```bash
backend/.venv/Scripts/pip install -r docs/requirements.txt
backend/.venv/Scripts/python docs/build_docs.py
```

Скрипт выгружает OpenAPI бэкенда в `docs/api/openapi.json` и собирает Sphinx в
`frontend_2_0/public/code-docs/` — оттуда документация попадает в образ дашборда и доступна на `/code-docs/`.
