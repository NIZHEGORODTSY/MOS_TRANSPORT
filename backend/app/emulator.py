"""Клиент REST API эмулятора NDTP организаторов (``EMULATOR_API``): запуск и остановка потока на приёмник бэкенда."""

import json
import os
import urllib.request

EMULATOR_API = os.environ.get("EMULATOR_API", "http://localhost:18080")
# how the emulator container reaches this backend; Docker Desktop resolves host.docker.internal to the host
EMULATOR_TARGET_HOST = os.environ.get("EMULATOR_TARGET_HOST", "host.docker.internal")
FIRST_UNIT_ID = 1166336


def _request(method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(
        EMULATOR_API + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        raw = resp.read()
    return json.loads(raw) if raw else {}


def get_config() -> dict:
    return _request("GET", "/api/config")


def set_config(config: dict) -> dict:
    """Replaces the emulator config; it starts sending immediately."""
    return _request("POST", "/api/config", config)


def start(target_port: int, units: int, interval_ms: int) -> dict:
    return set_config(
        {
            "targetHost": EMULATOR_TARGET_HOST,
            "targetPort": target_port,
            "units": [
                {"unitId": FIRST_UNIT_ID + i, "intervalMs": interval_ms, "autoGenerate": True, "cells": []}
                for i in range(units)
            ],
        }
    )


def stop(target_port: int) -> dict:
    return set_config({"targetHost": EMULATOR_TARGET_HOST, "targetPort": target_port, "units": []})
