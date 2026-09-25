import asyncio
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

# lets the file run directly (e.g. PyCharm Run), not only via uvicorn
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.dataset import load  # noqa: E402
from app.replay import TICK_S, Replay, iso  # noqa: E402

dataset = load()
replay = Replay(dataset)
clients: set[WebSocket] = set()


async def _send(ws: WebSocket, payload: dict) -> None:
    try:
        await ws.send_json(payload)
    except Exception:
        clients.discard(ws)


async def run_replay() -> None:
    while True:
        await asyncio.sleep(TICK_S)
        replay.step(TICK_S)
        if clients:
            payload = replay.snapshot()
            await asyncio.gather(*(_send(ws, payload) for ws in list(clients)))


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(run_replay())
    yield
    task.cancel()


app = FastAPI(title="MosTransport", lifespan=lifespan)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "clock": iso(replay.clock)}


@app.get("/api/routes")
def routes() -> list[dict]:
    return dataset.routes


@app.get("/api/vehicles")
def vehicles() -> dict:
    return replay.snapshot()


@app.websocket("/ws/vehicles")
async def vehicles_ws(ws: WebSocket) -> None:
    await ws.accept()
    clients.add(ws)
    await ws.send_json(replay.snapshot())
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        clients.discard(ws)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
