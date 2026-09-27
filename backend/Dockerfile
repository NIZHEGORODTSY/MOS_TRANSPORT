# Backend: FastAPI API + NDTP receiver + prediction loop; the same image runs the NDTP replayer.
# Build context is the repository root (see docker-compose.yml): the image needs ml_data/ as well.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MOSTRANSPORT_DATA=/srv/data/mostransport \
    ML_DATA_DIR=/srv/ml_data

WORKDIR /srv/backend

COPY backend/requirements.txt .
RUN pip install -r requirements.txt

COPY backend/app app
COPY backend/ndtp ndtp
# vehicles.csv / routes.csv: terminal -> vehicle -> route mapping of the dataset
COPY backend/data /srv/data/mostransport
# planned schedule for the model, the telemetry the replayer streams and the forecast points of validate
COPY ml_data/schedule_test.csv ml_data/traffic_test.csv ml_data/points.csv /srv/ml_data/

# 8000 — HTTP API, 9201 — NDTP (TCP)
EXPOSE 8000 9201
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
