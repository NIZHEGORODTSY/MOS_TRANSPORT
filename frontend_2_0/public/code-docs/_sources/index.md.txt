# МосТранспорт — предиктор изменений в графике движения

Система в реальном времени принимает телеметрию NDTP, накладывает её на плановое расписание
и за **10–15 минут** до прибытия на остановку прогнозирует задержку каждого ТС.
Диспетчер видит на карте, кто опаздывает, кто в зоне риска и кто идёт по графику.

Это документация по коду (Sphinx, autodoc по docstring-ам) и описание устройства системы.
Спецификация API — в Swagger бэкенда (`/docs` на сайте) и в файлах
[openapi.json](api/openapi.json) (бэкенд) и [ml_openapi.json](api/ml_openapi.json) (ML-сервис).

```{toctree}
:maxdepth: 2
:caption: Система

architecture
ndtp
prediction
model
api
deployment
```

```{toctree}
:maxdepth: 1
:caption: Для жюри

jury
performance
features
```

```{toctree}
:maxdepth: 2
:caption: Справочник по коду

reference/backend
reference/ndtp
reference/ml
```
