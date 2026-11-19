#!/usr/bin/env python3
"""
gen-icons.py — render the ParamHunt logo into manifest PNGs (16/32/48/128).

Pure-stdlib rasterizer: the same geometry as assets/logo.svg drawn with
per-pixel tests at 4× supersampling, box-downsampled for anti-aliasing.
Reproducible — run after any logo geometry change:

    python3 scripts/gen-icons.py
"""
import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'icons')
SS = 4  # supersampling factor

# geometry (512-canvas units)
SIZE = 512.0
RADIUS = 112.0
BG = (11, 18, 32)          # #0b1220
RING = (56, 189, 248)      # #38bdf8
RING_CENTER = (225.0, 225.0)
RING_R = 118.0
RING_W = 30.0
HANDLE = (312.0, 312.0, 424.0, 424.0)
BAR1 = (168.0, 184.0, 114.0, 22.0, 11.0, (226, 232, 240))  # #e2e8f0
BAR2 = (168.0, 242.0, 70.0, 22.0, 11.0, (100, 116, 139))   # #64748b


def in_rounded_rect(x: float, y: float, rx: float, ry: float, rw: float, rh: float, rr: float) -> bool:
    if not (rx <= x < rx + rw and ry <= y < ry + rh):
        return False
    # corner circles test
    dx = max(rx + rr - x, 0, x - (rx + rw - rr))
    dy = max(ry + rr - y, 0, y - (ry + rh - rr))
    return dx * dx + dy * dy <= rr * rr


def seg_dist(px: float, py: float, x1: float, y1: float, x2: float, y2: float) -> float:
    dx, dy = x2 - x1, y2 - y1
    len2 = dx * dx + dy * dy
    if len2 == 0:
        return math.hypot(px - x1, py - y1)
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / len2))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))


def sample(x: float, y: float):
    """Color at one canvas-space point (x, y in [0, SIZE))."""
    if in_rounded_rect(x, y, 0, 0, SIZE, SIZE, RADIUS):
        color = BG
        d = math.hypot(x - RING_CENTER[0], y - RING_CENTER[1])
        if abs(d - RING_R) <= RING_W / 2:
            color = RING
        if seg_dist(x, y, *HANDLE) <= RING_W / 2:
            color = RING
        for bx, by, bw, bh, br, bc in (BAR1, BAR2):
            if in_rounded_rect(x, y, bx, by, bw, bh, br):
                color = bc
        return color
    return None  # transparent (icon corners)


def render(size: int) -> bytes:
    n = size * SS
    cell = SIZE / n
    acc = [0.0] * (size * size * 4)
    for iy in range(n):
        for ix in range(n):
            x = (ix + 0.5) * cell
            y = (iy + 0.5) * cell
            c = sample(x, y)
            px, py = ix // SS, iy // SS
            idx = (py * size + px) * 4
            if c is None:
                acc[idx + 3] += 0.0
            else:
                acc[idx + 0] += c[0]
                acc[idx + 1] += c[1]
                acc[idx + 2] += c[2]
                acc[idx + 3] += 255.0
    rows = []
    for py in range(size):
        row = bytearray([0])  # filter type 0
        for px in range(size):
            idx = (py * size + px) * 4
            a = acc[idx + 3] / (SS * SS)
            if a == 0:
                row += bytes((0, 0, 0, 0))
            else:
                row += bytes(
                    (
                        round(acc[idx + 0] / (SS * SS)),
                        round(acc[idx + 1] / (SS * SS)),
                        round(acc[idx + 2] / (SS * SS)),
                        round(a),
                    )
                )
        rows.append(bytes(row))
    return encode_png(size, size, b''.join(rows))


def encode_png(w: int, h: int, raw: bytes) -> bytes:
    def chunk(t: bytes, d: bytes) -> bytes:
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)  # RGBA
    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', ihdr)
        + chunk(b'IDAT', zlib.compress(raw, 9))
        + chunk(b'IEND', b'')
    )


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = os.path.join(OUT, f'icon-{size}.png')
        with open(path, 'wb') as f:
            f.write(render(size))
        print(f'[+] {path} ({os.path.getsize(path)} bytes)')


if __name__ == '__main__':
    main()
