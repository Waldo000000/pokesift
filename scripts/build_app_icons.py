"""Rebuild the original PokéSift app mark using only Python's standard library.

Opaque, full-bleed icons keep the mark inside the maskable central safe area.
Do not pre-round the corners: the Android/iPad launcher supplies its own shape.
"""
from pathlib import Path
import struct
import zlib

OUT = Path(__file__).resolve().parent.parent / 'dist' / 'icons'
GREEN = (40, 92, 70)
PAPER = (244, 243, 237)


def png(size):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            total = [0, 0, 0]
            for dy in (.25, .75):
                for dx in (.25, .75):
                    px, py = (x + dx) / size - .5, (y + dy) / size - .5
                    distance = px * px + py * py
                    ink = distance > .32 ** 2 or py >= 0 and distance < .282 ** 2
                    colour = GREEN if ink else PAPER
                    for i in range(3):
                        total[i] += colour[i]
            rows.extend(round(v / 4) for v in total)

    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b'')


if __name__ == '__main__':
    OUT.mkdir(exist_ok=True)
    for name, size in [('app-192.png', 192), ('app-512.png', 512), ('app-maskable-512.png', 512), ('apple-touch-icon.png', 180)]:
        target = OUT / name
        target.write_bytes(png(size))
        target.chmod(0o644)
