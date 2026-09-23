import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from .simulator import TICK_S, TIME_SCALE, Simulator

sim = Simulator(seed=42)
clients: set[WebSocket] = set()


async def _send(ws: WebSocket, payload: dict) -> None:
    try:
        await ws.send_json(payload)
    except Exception:
        clients.discard(ws)


async def run_simulation() -> None:
    while True:
        await asyncio.sleep(TICK_S)
        sim.step(TICK_S * TIME_SCALE)
        if clients:
            payload = sim.snapshot()
            await asyncio.gather(*(_send(ws, payload) for ws in list(clients)))


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(run_simulation())
    yield
    task.cancel()


app = FastAPI(title="MosTransport stub", lifespan=lifespan)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "sim_time": round(sim.sim_t)}


@app.get("/api/routes")
def routes() -> list[dict]:
    return sim.routes_geo()


@app.get("/api/vehicles")
def vehicles() -> dict:
    return sim.snapshot()


@app.websocket("/ws/vehicles")
async def vehicles_ws(ws: WebSocket) -> None:
    await ws.accept()
    clients.add(ws)
    await ws.send_json(sim.snapshot())
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        clients.discard(ws)
