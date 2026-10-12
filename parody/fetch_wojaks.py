"""Download wojak images from wojakland.com and Pinterest into assets/wojaks/.

Usage: python fetch_wojaks.py [--pinterest-only | --wojakland-only]

Builds assets/wojaks/index.json: [{path, source, category, name}], used by
render.py to pick a wojak by tag (category or filename words).
"""
import asyncio, json, re, sys
from pathlib import Path
from curl_cffi import requests
from PIL import Image

ROOT = Path(__file__).parent / "assets" / "wojaks"
S = requests.Session(impersonate="chrome")

WOJAKLAND_CATEGORIES = [
    "chads", "crying", "doomers", "bloomers", "zoomers", "boomers", "brainlets", "big-brain",
    "npc", "soyjaks", "gym", "rage", "wojak-pointing", "cobson", "grug", "pepe", "apu-apustaja",
    "chudjak", "full-body", "templates", "new-wojaks", "miscellaneous", "masks", "craig",
]
PINTEREST_QUERIES = [
    "wojak png", "wojak looksmax", "chad wojak", "crying wojak", "soyjak pointing",
    "doomer wojak", "wojak meme transparent", "gigachad", "mewing wojak", "wojak gym",
]


def save(url, path):
    if path.exists():
        return True
    r = S.get(url)
    if r.status_code != 200 or len(r.content) < 1000:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(r.content)
    return True


def has_alpha(path):
    try:
        return Image.open(path).convert("RGBA").getextrema()[3][0] < 255
    except Exception:
        return False


def wojakland(index):
    for cat in WOJAKLAND_CATEGORIES:
        html = S.get(f"https://wojakland.com/{cat}").text
        urls = set(re.findall(r'https://wojakland\.com/wp-content/grand-media/image/(?:thumb/)?([^"\'\s)/]+\.(?:png|jpe?g|webp))', html))
        n = 0
        for name in sorted(urls):
            path = ROOT / "wojakland" / cat / name
            if save(f"https://wojakland.com/wp-content/grand-media/image/{name}", path):
                index.append({"path": str(path.relative_to(ROOT)), "source": "wojakland", "category": cat,
                              "name": Path(name).stem, "alpha": has_alpha(path)})
                n += 1
        print(f"wojakland/{cat}: {n}")


async def pinterest_urls(query, scrolls=10):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/opt/pw-browsers/chromium", args=["--no-sandbox"])
        pg = await b.new_page(user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                                         "(KHTML, like Gecko) Chrome/140.0 Safari/537.36")
        await pg.goto(f"https://www.pinterest.com/search/pins/?q={query}", wait_until="domcontentloaded", timeout=60000)
        await pg.wait_for_timeout(4000)
        seen = set()
        for _ in range(scrolls):
            for s in await pg.eval_on_selector_all("img", "els => els.map(e => e.src)"):
                m = re.match(r"https://i\.pinimg\.com/\d+x/(.+)$", s)
                if m:
                    seen.add(m.group(1))
            await pg.mouse.wheel(0, 3000)
            await pg.wait_for_timeout(1500)
        await b.close()
        return seen


def pinterest(index):
    for q in PINTEREST_QUERIES:
        slug = re.sub(r"\W+", "-", q).strip("-")
        n = 0
        for rest in sorted(asyncio.run(pinterest_urls(q))):
            path = ROOT / "pinterest" / slug / rest.replace("/", "_")
            # originals first, 736x as fallback (some pins have no original)
            if save(f"https://i.pinimg.com/originals/{rest}", path) or save(f"https://i.pinimg.com/736x/{rest}", path):
                index.append({"path": str(path.relative_to(ROOT)), "source": "pinterest", "category": slug,
                              "name": slug, "alpha": has_alpha(path)})
                n += 1
        print(f"pinterest/{slug}: {n}")


if __name__ == "__main__":
    ROOT.mkdir(parents=True, exist_ok=True)
    index = []
    if "--pinterest-only" not in sys.argv:
        wojakland(index)
    if "--wojakland-only" not in sys.argv:
        pinterest(index)
    (ROOT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1))
    print("total", len(index))
