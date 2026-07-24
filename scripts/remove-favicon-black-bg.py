"""Remove fundo preto opaco dos ícones EventFest (favicon / PWA)."""
from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "public"


def is_bg(r: int, g: int, b: int, a: int, thresh: int = 30) -> bool:
    return a > 200 and r <= thresh and g <= thresh and b <= thresh


def remove_black_bg(im: Image.Image, thresh: int = 30) -> Image.Image:
    px = im.convert("RGBA")
    w, h = px.size
    data = px.load()
    visited = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    for x in range(w):
        for y in (0, h - 1):
            r, g, b, a = data[x, y]
            if is_bg(r, g, b, a, thresh):
                q.append((x, y))
                visited[y][x] = True
    for y in range(h):
        for x in (0, w - 1):
            if visited[y][x]:
                continue
            r, g, b, a = data[x, y]
            if is_bg(r, g, b, a, thresh):
                q.append((x, y))
                visited[y][x] = True

    while q:
        x, y = q.popleft()
        data[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and not visited[ny][nx]:
                visited[ny][nx] = True
                r, g, b, a = data[nx, ny]
                if is_bg(r, g, b, a, thresh):
                    q.append((nx, ny))

    return px


def main() -> None:
    src512 = Image.open(ROOT / "icon-512.png")
    cleaned512 = remove_black_bg(src512, thresh=30)
    cleaned512.save(ROOT / "icon-512.png", optimize=True)

    for name, size in (("icon-192.png", (192, 192)), ("icon-app.png", (144, 144))):
        cleaned512.resize(size, Image.Resampling.LANCZOS).save(ROOT / name, optimize=True)
        print("saved", name, size)

    ico_sizes = [(16, 16), (32, 32), (48, 48)]
    ico_imgs = [cleaned512.resize(s, Image.Resampling.LANCZOS) for s in ico_sizes]
    ico_imgs[0].save(
        ROOT / "favicon.ico",
        format="ICO",
        sizes=ico_sizes,
        append_images=ico_imgs[1:],
    )
    print("saved favicon.ico", ico_sizes)

    for name in ("favicon.ico", "icon-192.png", "icon-512.png", "icon-app.png"):
        im = Image.open(ROOT / name).convert("RGBA")
        w, h = im.size
        corners = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
        print(name, im.size, [im.getpixel(c) for c in corners])


if __name__ == "__main__":
    main()
