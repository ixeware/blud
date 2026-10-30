#!/usr/bin/env python3
"""Generate game art with the OpenAI Images API and convert it to clean pixel art.

Usage: OPENAI_API_KEY=... python3 tools/gen_assets.py [--only id1,id2] [--force] [--process-only]
Raw images are cached in RAW_DIR so processing can be re-run without new API calls.
"""
import base64, json, os, subprocess, sys, tempfile, time, random
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image, ImageEnhance

sys.path.insert(0, os.path.dirname(__file__))
from assets_manifest import ICONS, ABILITIES, PORTRAITS, CARDS, EVENTS, BGS, TEXTURES, PTEX

ROOT = os.path.join(os.path.dirname(__file__), '..', 'web', 'assets')
RAW_DIR = os.environ.get('RAW_DIR', os.path.join(os.path.dirname(__file__), '..', '.raw_assets'))
MODEL = 'gpt-image-2'

STYLE_ICON = ("Pixel art game icon: {s}. Single object centered with generous margin, chunky clearly visible pixels "
              "(like a 32x32 sprite scaled up), bold dark outline, saturated vibrant colors, soft top-left lighting, "
              "16-bit retro military strategy game style. Flat solid pure magenta #FF00FF background around the object. "
              "No text, no letters, no numbers, no frame.")
STYLE_PORTRAIT = ("Pixel art character portrait: head and shoulders of {s}. Chunky visible pixels (like a 64x64 sprite "
                  "scaled up), bold dark outline, saturated vibrant colors, 16-bit retro military game style, three-quarter "
                  "view. Flat solid pure magenta #FF00FF background. No text.")
STYLE_SCENE = ("Pixel art illustration for a military strategy game: {s}. Chunky visible pixels (like a 192x128 image "
               "scaled up), saturated vibrant colors, dramatic lighting, 16-bit retro style, full scene edge to edge. "
               "No text, no letters, no frame, no border.")
STYLE_TEX = ("Seamless tileable texture: {s}. Stylized game texture, even lighting, fills the whole image, "
             "no objects, no text.")
STYLE_PTEX = ("Seamless tileable pixel art texture: {s}. Chunky pixels (like a 32x32 tile scaled up), muted dark tones, "
              "16-bit game UI background, fills the whole image. No text.")

JOBS = []  # (id, folder, prompt, size, quality, kind, target)
for i, s in ICONS:
    JOBS.append((i, 'icons', STYLE_ICON.format(s=s), '1024x1024', 'low', 'icon', 40))
for i, s in ABILITIES:
    JOBS.append((i, 'ab', STYLE_ICON.format(s=s), '1024x1024', 'low', 'icon', 40))
for i, s in PORTRAITS:
    JOBS.append((i, 'por', STYLE_PORTRAIT.format(s=s), '1024x1024', 'medium', 'portrait', 72))
for i, s in CARDS:
    JOBS.append((i, 'cards', STYLE_SCENE.format(s=s), '1536x1024', 'medium', 'scene', 192))
for i, s in EVENTS:
    JOBS.append((i, 'ev', STYLE_SCENE.format(s=s), '1536x1024', 'medium', 'scene', 192))
for i, s in BGS:
    kind = 'icon' if i == 'emblem' else 'scene'
    prompt = STYLE_ICON.format(s=s) if i == 'emblem' else STYLE_SCENE.format(s=s).replace('192x128', '320x213')
    JOBS.append((i, 'bg', prompt, '1024x1024' if i == 'emblem' else '1536x1024', 'high', kind, 96 if i == 'emblem' else 320))
for i, s in TEXTURES:
    JOBS.append((i, 'tex', STYLE_TEX.format(s=s), '1024x1024', 'medium', 'tex', 512))
for i, s in PTEX:
    JOBS.append((i, 'ui', STYLE_PTEX.format(s=s), '1024x1024', 'low', 'ptex', 48))


def generate(job, force=False):
    i, folder, prompt, size, quality, kind, target = job
    raw = os.path.join(RAW_DIR, folder, i + '.png')
    if os.path.exists(raw) and not force:
        return raw
    os.makedirs(os.path.dirname(raw), exist_ok=True)
    body = json.dumps({'model': MODEL, 'prompt': prompt, 'size': size, 'quality': quality, 'n': 1})
    for attempt in range(12):
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
            f.write(body)
            bf = f.name
        try:
            out = subprocess.run(['curl', '-sS', '--max-time', '240', 'https://api.openai.com/v1/images/generations',
                                  '-H', 'Authorization: Bearer ' + os.environ['OPENAI_API_KEY'],
                                  '-H', 'Content-Type: application/json', '--data-binary', '@' + bf],
                                 capture_output=True, text=True).stdout
        finally:
            os.unlink(bf)
        try:
            d = json.loads(out)
            if 'data' in d:
                with open(raw, 'wb') as fh:
                    fh.write(base64.b64decode(d['data'][0]['b64_json']))
                print('gen', folder, i, flush=True)
                return raw
            msg = d.get('error', {}).get('message', out[:200])
            if 'Rate limit' in msg:
                time.sleep(8 + random.random() * 10)
                continue
            print('ERR', i, msg, flush=True)
            if 'safety' in out or 'rejected' in out:
                return None
        except Exception as e:  # noqa
            print('ERR', i, e, out[:200], flush=True)
    return None


def magenta_mask(a):
    r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
    return (r > 150) & (b > 150) & (g < 110) & (np.abs(r - b) < 90)


def period(profile, lo=6, hi=64):
    p = profile - profile.mean()
    n = len(p)
    best, bp = 0, None
    for k in range(lo, hi):
        c = float(np.dot(p[:-k], p[k:])) / (n - k)
        if c > best:
            best, bp = c, k
    if bp is None:
        return None
    # refine with harmonics: prefer the smallest period whose multiples score well
    return bp


def detect_grid(arr):
    g = arr[..., :3].astype(int)
    dx = np.abs(np.diff(g, axis=1)).sum(axis=2).sum(axis=0).astype(float)
    dy = np.abs(np.diff(g, axis=0)).sum(axis=2).sum(axis=1).astype(float)
    px, py = period(dx), period(dy)
    if not px or not py:
        return None
    p = (px + py) / 2
    # fine search for fractional period & phase maximizing edge alignment
    best = (-1, p, 0, 0)
    for pp in np.arange(p - 1.5, p + 1.5, 0.1):
        for ox in range(0, int(pp)):
            pos = np.arange(ox, len(dx), pp).astype(int)
            sx = dx[np.clip(pos, 0, len(dx) - 1)].sum()
            if sx > best[0]:
                best = (sx, pp, ox, best[3])
    _, pp, ox, _ = best
    besty = (-1, 0)
    for oy in range(0, int(pp)):
        pos = np.arange(oy, len(dy), pp).astype(int)
        sy = dy[np.clip(pos, 0, len(dy) - 1)].sum()
        if sy > besty[0]:
            besty = (sy, oy)
    return pp, ox + 1, besty[1] + 1


def sample_grid(img, pp, ox, oy):
    w, h = img.size
    cols = int((w - ox) / pp)
    rows = int((h - oy) / pp)
    arr = np.array(img)
    out = np.zeros((rows, cols, arr.shape[2]), dtype=np.uint8)
    for r in range(rows):
        y0, y1 = int(oy + r * pp), int(oy + (r + 1) * pp)
        for c in range(cols):
            x0, x1 = int(ox + c * pp), int(ox + (c + 1) * pp)
            blk = arr[y0 + (y1 - y0) // 4: y1 - (y1 - y0) // 4 + 1, x0 + (x1 - x0) // 4: x1 - (x1 - x0) // 4 + 1]
            flat = blk.reshape(-1, arr.shape[2])
            # majority color of block center
            vals, counts = np.unique(flat, axis=0, return_counts=True)
            out[r, c] = vals[counts.argmax()]
    return Image.fromarray(out)


def to_pixel(path, kind, target):
    img = Image.open(path).convert('RGB')
    img = ImageEnhance.Color(img).enhance(1.15)
    arr = np.array(img)
    grid = detect_grid(arr)
    w, h = img.size
    if grid and 8 <= grid[0] <= 48:
        small = sample_grid(img, *grid)
    else:
        small = img.resize((target, int(target * h / w)), Image.NEAREST)
    if kind in ('icon', 'portrait'):
        a = np.array(small.convert('RGBA'))
        m = magenta_mask(a)
        a[m] = 0
        # remove magenta-tinted fringe pixels touching transparency
        r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
        fringe = (r > 120) & (b > 120) & (g < r - 60) & (g < b - 60)
        a[fringe] = 0
        small = Image.fromarray(a)
        bbox = small.getbbox()
        if bbox:
            small = small.crop(bbox)
        # limit size
        mx = max(small.size)
        if mx > target * 1.6:
            sc = target / mx
            small = small.resize((max(1, round(small.size[0] * sc)), max(1, round(small.size[1] * sc))), Image.NEAREST)
        # quantize colors (keep alpha)
        alpha = small.getchannel('A')
        rgb = small.convert('RGB').quantize(colors=32, method=Image.Quantize.MEDIANCUT).convert('RGB')
        small = rgb.convert('RGBA')
        small.putalpha(alpha.point(lambda v: 255 if v > 127 else 0))
    else:
        mx = small.size[0]
        if mx > target * 1.5:
            sc = target / mx
            small = small.resize((round(small.size[0] * sc), round(small.size[1] * sc)), Image.NEAREST)
        small = small.quantize(colors=64, method=Image.Quantize.MEDIANCUT).convert('RGB')
    return small


def process(job):
    i, folder, prompt, size, quality, kind, target = job
    raw = os.path.join(RAW_DIR, folder, i + '.png')
    if not os.path.exists(raw):
        return
    os.makedirs(os.path.join(ROOT, folder), exist_ok=True)
    if kind == 'tex':
        Image.open(raw).convert('RGB').resize((target, target), Image.LANCZOS).save(
            os.path.join(ROOT, folder, i + '.jpg'), quality=86)
        return
    if kind == 'ptex':
        img = Image.open(raw).convert('RGB').resize((target, target), Image.BOX)
        img = img.quantize(colors=24).convert('RGB')
        img.save(os.path.join(ROOT, folder, i + '.png'))
        return
    out = to_pixel(raw, kind, target)
    out.save(os.path.join(ROOT, folder, i + '.png'), optimize=True)


def main():
    args = sys.argv[1:]
    only = None
    if '--only' in args:
        only = set(args[args.index('--only') + 1].split(','))
    force = '--force' in args
    jobs = [j for j in JOBS if not only or j[0] in only]
    if '--process-only' not in args:
        with ThreadPoolExecutor(int(os.environ.get('PAR', '8'))) as ex:
            list(ex.map(lambda j: generate(j, force), jobs))
    for j in jobs:
        try:
            process(j)
        except Exception as e:  # noqa
            print('PROC ERR', j[0], e, flush=True)
    print('done', len(jobs), flush=True)


if __name__ == '__main__':
    main()
