#!/usr/bin/env python3
"""
Приём NDTP-пакетов от Docker-эмулятора ndtp-telemetry-emulator.

Что делает:
  1. Поднимает TCP-сервер (по умолчанию 0.0.0.0:9201).
  2. Через REST API эмулятора (http://localhost:18080/api/config)
     просит его слать пакеты на наш сервер.
  3. Принимает бинарные NDTP-пакеты, парсит ячейку G6CellNav00
     и печатает координаты в реальном времени.

Запуск:
    python ndtp_receiver.py
"""

from __future__ import annotations

import json
import socket
import struct
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from typing import Optional


# ============ Настройки ============
LISTEN_HOST = "0.0.0.0"
LISTEN_PORT = 9201                  # куда эмулятор будет слать TCP
EMULATOR_API = "http://localhost:18080"
TARGET_HOST = "host.docker.internal"  # как контейнер видит наш хост
N_UNITS = 16
INTERVAL_MS = 1000
# ===================================


# ---------- Константы NDTP ----------
NPL_SIZE = 15
NPH_SIZE = 10
NPL_SIGNATURE = 0x7E7E
NPH_TYPE_REALTIME = 101
CELL_NAV00 = 0
NAV00_SIZE = 26


# ---------- Парсинг G6CellNav00 ----------
def parse_nav00(payload: bytes) -> dict:
    """
    Раскладка (26 байт, little-endian, packed):
      u32 timestamp
      u32 longitude
      u32 latitude
      u8  extraDop bits (bit5=N/S, bit6=E/W, bit7=valid)
      u8  batVoltage
      u16 speedAvg
      u16 speedMax
      u16 course
      u16 track
      u16 altitude
      u8  nsat
      u8  pdop
    """
    (ts, lon_raw, lat_raw, extra, bat_v,
     speed_avg, speed_max, course, track, alt,
     nsat, pdop) = struct.unpack_from("<IIIBBHHHHHBB", payload, 0)

    lat = (1 if (extra >> 5) & 1 else -1) * (lat_raw / 1e7)
    lon = (1 if (extra >> 6) & 1 else -1) * (lon_raw / 1e7)
    valid = bool((extra >> 7) & 1)

    return {
        "ts": ts,
        "datetime": datetime.fromtimestamp(ts).strftime("%H:%M:%S"),
        "lat": lat,
        "lon": lon,
        "alt": alt,
        "speed_avg": speed_avg,
        "speed_max": speed_max,
        "course": course,
        "nsat": nsat,
        "pdop": pdop,
        "valid": valid,
        "bat_mv": bat_v * 20,   # 1 единица = 20 мВ
    }


def parse_packet(buf: bytes) -> Optional[tuple[int, dict]]:
    """Разбирает один NDTP-пакет, возвращает (unit_id, nav) или None."""
    if len(buf) < NPL_SIZE + NPH_SIZE:
        return None

    signature, data_size, flags, crc, ptype, peer, req_id = struct.unpack_from(
        "<HHHHBIH", buf, 0
    )
    if signature != NPL_SIGNATURE:
        return None

    total = NPL_SIZE + data_size
    if total > len(buf):
        return None

    service_id, nph_type, nph_flags, nph_req = struct.unpack_from(
        "<HHHI", buf, NPL_SIZE
    )
    if nph_type != NPH_TYPE_REALTIME:
        return None

    body = buf[NPL_SIZE + NPH_SIZE:total]
    if len(body) < 2 + NAV00_SIZE:
        return None
    ctype, cnum = body[0], body[1]
    if ctype != CELL_NAV00:
        return None

    return peer, parse_nav00(body[2:2 + NAV00_SIZE])


# ---------- TCP-сервер ----------
def handle_client(conn: socket.socket, addr) -> None:
    print(f"[+] Подключился клиент: {addr}", file=sys.stderr)
    buf = b""
    try:
        while True:
            chunk = conn.recv(8192)
            if not chunk:
                break
            buf += chunk

            while True:
                # ищем сигнатуру кадра
                idx = buf.find(b"\x7e\x7e")
                if idx < 0:
                    buf = buf[-1:] if buf else b""
                    break
                if idx > 0:
                    buf = buf[idx:]
                if len(buf) < NPL_SIZE:
                    break

                sig, data_size = struct.unpack_from("<HH", buf, 0)
                if sig != NPL_SIGNATURE:
                    buf = buf[1:]
                    continue

                total = NPL_SIZE + data_size
                if len(buf) < total:
                    break

                packet = buf[:total]
                buf = buf[total:]

                parsed = parse_packet(packet)
                if parsed:
                    unit_id, nav = parsed
                    print(
                        f"[{nav['datetime']}] "
                        f"unit={unit_id} "
                        f"lat={nav['lat']:.7f} "
                        f"lon={nav['lon']:.7f} "
                        f"speed={nav['speed_avg']:>3} km/h "
                        f"course={nav['course']:>3}° "
                        f"alt={nav['alt']:>3}m "
                        f"sats={nav['nsat']} "
                        f"valid={'Y' if nav['valid'] else 'N'}"
                    )
    except Exception as e:
        print(f"[!] Ошибка у клиента {addr}: {e}", file=sys.stderr)
    finally:
        conn.close()
        print(f"[-] Клиент отключился: {addr}", file=sys.stderr)


def serve(host: str, port: int) -> None:
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((host, port))
    srv.listen(16)
    print(f"[*] TCP-сервер слушает {host}:{port}", file=sys.stderr)
    while True:
        conn, addr = srv.accept()
        conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        threading.Thread(
            target=handle_client, args=(conn, addr), daemon=True
        ).start()


# ---------- Настройка эмулятора ----------
def configure_emulator(api_url: str, target_host: str, target_port: int,
                       n_units: int, interval_ms: int) -> None:
    cfg = {
        "targetHost": target_host,
        "targetPort": target_port,
        "units": [
            {
                "unitId": 1166336 + i,
                "intervalMs": interval_ms,
                "autoGenerate": True,
                "cells": [],
            }
            for i in range(n_units)
        ],
    }
    req = urllib.request.Request(
        f"{api_url}/api/config",
        data=json.dumps(cfg).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            resp.read()
            print(
                f"[*] Конфиг отправлен: {n_units} устройств, "
                f"интервал {interval_ms} мс, target="
                f"{target_host}:{target_port}",
                file=sys.stderr,
            )
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        print(f"[!] HTTP {e.code}: {body}", file=sys.stderr)
        raise
    except Exception as e:
        print(f"[!] Не удалось настроить эмулятор: {e}", file=sys.stderr)
        raise


# ---------- Main ----------
def main() -> None:
    # 1) TCP-сервер
    threading.Thread(
        target=serve, args=(LISTEN_HOST, LISTEN_PORT), daemon=True
    ).start()
    time.sleep(0.5)

    # 2) Настройка эмулятора
    try:
        configure_emulator(
            EMULATOR_API, TARGET_HOST, LISTEN_PORT, N_UNITS, INTERVAL_MS
        )
    except Exception:
        print(
            f"[!] Эмулятор недоступен. Проверь, что он запущен:\n"
            f"    curl {EMULATOR_API}/api/cells\n"
            f"    docker run --rm -p 18080:18080 "
            f"--add-host=host.docker.internal:host-gateway "
            f"--name ndtp-emu ndtp-telemetry-emulator:1.0",
            file=sys.stderr,
        )
        return

    # 3) Ждём пакеты
    print("[*] Жду пакеты... Ctrl+C — выход", file=sys.stderr)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[*] Выход", file=sys.stderr)


if __name__ == "__main__":
    main()