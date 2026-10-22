"""Compares each page's screenshot with the Nagma export of its capture (run-fixtures.cjs output).

    python3 compare.py <out dir> [name …]

Prints, per page, the share of pixels that differ visibly (any channel off by more than 48) and
the mean difference, and writes <name>.compare.png: the page, the import and their difference
side by side, at half size.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops

out = Path(sys.argv[1])
names = sys.argv[2:] or sorted(p.name[: -len(".source.png")] for p in out.glob("*.source.png"))
results = {}
for name in names:
    src_path, dst_path = out / f"{name}.source.png", out / f"{name}.nagma.png"
    if not src_path.exists() or not dst_path.exists():
        continue
    src = Image.open(src_path).convert("RGB")
    dst = Image.open(dst_path).convert("RGB")
    # The page shot's area (a long page shot only to its first screen compares that screen).
    w, h = src.width, src.height
    a = Image.new("RGB", (w, h), "white")
    a.paste(src, (0, 0))
    b = Image.new("RGB", (w, h), "white")
    b.paste(dst.crop((0, 0, min(dst.width, w), min(dst.height, h))), (0, 0))
    diff = ImageChops.difference(a, b)
    gray = diff.convert("L")
    hist = gray.histogram()
    total = w * h
    off = sum(hist[49:]) / total
    mean = sum(i * n for i, n in enumerate(hist)) / total
    results[name] = {"differing": round(off * 100, 2), "mean": round(mean, 2), "size": [src.width, src.height], "import": [dst.width, dst.height]}
    sheet = Image.new("RGB", (w * 3, h), "white")
    sheet.paste(a, (0, 0))
    sheet.paste(b, (w, 0))
    sheet.paste(ImageChops.invert(diff), (w * 2, 0))
    sheet = sheet.resize((sheet.width // 2, sheet.height // 2))
    sheet.save(out / f"{name}.compare.png")
    print(f"{name:12} differing {results[name]['differing']:6.2f}%  mean {results[name]['mean']:5.2f}  page {src.width}x{src.height}  import {dst.width}x{dst.height}")
(out / "compare.json").write_text(json.dumps(results, indent=2))
