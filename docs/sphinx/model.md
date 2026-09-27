# Модель

ML-ядро (`ml_service/`) — отдельный сервис с API `/set_context`, `/predict`, `/health`
([ml_openapi.json](api/ml_openapi.json)). Код модели — пакет {mod}`ml`, справочник — в разделе
«Справочник по коду».

```{include} ../../ml_service/README.md
:start-after: "## Результаты"
:end-before: "## Как запустить"
```

## Как устроено

```{include} ../../ml_service/README.md
:start-after: "## Как это устроено"
```
