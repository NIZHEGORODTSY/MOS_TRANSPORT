import struct
from dataclasses import dataclass

NPL_SIZE = 15
NPH_SIZE = 10
SIGNATURE = b"\x7e\x7e"
NPL_TYPE_NPH = 0x02
SERVICE_GENERIC = 0
# telemetry frames are tens to hundreds of bytes; a larger length means we locked onto a false signature
MAX_DATA_SIZE = 4096
SERVICE_NAVDATA = 1
NPH_CONN_REQUEST = 100
NPH_REALTIME = 101
CELL_NAV00 = 0
NAV00_SIZE = 26

_NPL = struct.Struct("<HHHHBIH")  # signature, dataSize, flags, crc, type, peerAddress, requestId
_NPH = struct.Struct("<HHHI")  # serviceId, type, flags, requestId
_NAV00 = struct.Struct("<IIIBBHHHHHBB")
_HANDSHAKE = struct.Struct("<HHHIII")  # protoVersionHigh, protoVersionLow, flags, peerAddress, maxPacketSize, reserved


@dataclass
class Frame:
    unit_id: int  # NPL peerAddress: the on-board terminal id
    service: int
    nph_type: int
    body: bytes


@dataclass
class Nav:
    unit_id: int
    ts: int  # Unix seconds, UTC
    lon: float
    lat: float
    alt: int
    speed: int  # average speed, km/h
    speed_max: int
    course: int
    nsat: int
    pdop: int
    valid: bool
    battery_mv: int


def crc16_modbus(data: bytes) -> int:
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


class FrameReader:
    """Accumulates TCP chunks and returns complete frames; skips garbage and resyncs on the next signature."""

    def __init__(self) -> None:
        self.buf = bytearray()
        self.bad_crc = 0
        self.skipped_bytes = 0

    def feed(self, chunk: bytes) -> list[Frame]:
        self.buf += chunk
        frames: list[Frame] = []
        while True:
            start = self.buf.find(SIGNATURE)
            if start < 0:
                # keep a trailing 0x7e: it may be the first half of the next signature
                keep = 1 if self.buf.endswith(b"\x7e") else 0
                self.skipped_bytes += len(self.buf) - keep
                del self.buf[: len(self.buf) - keep]
                return frames
            if start:
                self.skipped_bytes += start
                del self.buf[:start]
            if len(self.buf) < NPL_SIZE:
                return frames

            _, data_size, _, crc, npl_type, peer, _ = _NPL.unpack_from(self.buf)
            if npl_type != NPL_TYPE_NPH or not NPH_SIZE <= data_size <= MAX_DATA_SIZE:
                self._drop_byte()
                continue
            total = NPL_SIZE + data_size
            if len(self.buf) < total:
                return frames

            payload = bytes(self.buf[NPL_SIZE:total])
            # the CRC is stored with its two bytes swapped
            if crc16_modbus(payload) != int.from_bytes(crc.to_bytes(2, "little"), "big"):
                self.bad_crc += 1
                self._drop_byte()
                continue
            del self.buf[:total]
            service, nph_type, _, _ = _NPH.unpack_from(payload)
            frames.append(Frame(unit_id=peer, service=service, nph_type=nph_type, body=payload[NPH_SIZE:]))

    def _drop_byte(self) -> None:
        self.skipped_bytes += 1
        del self.buf[:1]


def parse_nav(frame: Frame) -> Nav | None:
    """Navigation cell of a realtime packet; None for handshakes and packets without G6CellNav00."""
    if frame.service != SERVICE_NAVDATA or frame.nph_type != NPH_REALTIME:
        return None
    body = frame.body
    if len(body) < 2 + NAV00_SIZE or body[0] != CELL_NAV00:
        return None
    ts, lon, lat, extra, battery, speed, speed_max, course, _, alt, nsat, pdop = _NAV00.unpack_from(body, 2)
    return Nav(
        unit_id=frame.unit_id,
        ts=ts,
        lat=(1 if extra & 0x20 else -1) * lat / 1e7,
        lon=(1 if extra & 0x40 else -1) * lon / 1e7,
        alt=alt,
        speed=speed,
        speed_max=speed_max,
        course=course,
        nsat=nsat,
        pdop=pdop,
        valid=bool(extra & 0x80),
        battery_mv=battery * 20,
    )


def _u16(value: float) -> int:
    return max(0, min(0xFFFF, round(value)))


def encode_frame(unit_id: int, service: int, nph_type: int, request_id: int, body: bytes) -> bytes:
    payload = _NPH.pack(service, nph_type, 1, request_id) + body
    crc = crc16_modbus(payload)
    swapped = int.from_bytes(crc.to_bytes(2, "big"), "little")
    return _NPL.pack(0x7E7E, len(payload), 0, swapped, NPL_TYPE_NPH, unit_id, 0) + payload


def encode_handshake(unit_id: int, request_id: int) -> bytes:
    """NPH_SGC_CONN_REQUEST that a terminal sends right after connecting."""
    body = _HANDSHAKE.pack(6, 2, 0, unit_id, 65535, 0)
    return encode_frame(unit_id, SERVICE_GENERIC, NPH_CONN_REQUEST, request_id, body)


def encode_nav(nav: Nav, request_id: int) -> bytes:
    """Realtime packet with a single G6CellNav00 cell."""
    extra = (0x20 if nav.lat >= 0 else 0) | (0x40 if nav.lon >= 0 else 0) | (0x80 if nav.valid else 0)
    cell = _NAV00.pack(
        nav.ts,
        round(abs(nav.lon) * 1e7),
        round(abs(nav.lat) * 1e7),
        extra,
        min(0xFF, nav.battery_mv // 20),
        _u16(nav.speed),
        _u16(nav.speed_max),
        _u16(nav.course) % 360,
        0,
        _u16(nav.alt),
        min(0xFF, nav.nsat),
        min(0xFF, nav.pdop),
    )
    return encode_frame(nav.unit_id, SERVICE_NAVDATA, NPH_REALTIME, request_id, bytes([CELL_NAV00, 0]) + cell)
