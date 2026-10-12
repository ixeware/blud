"""Render a parody carousel script (JSON) into TikTok-ready slide PNGs.

Usage: python render.py scripts/heightmaxx_wardrobe.json [--out out/] [--seed N]

Script format (see scripts/*.json):
{
  "slug": "heightmaxx_wardrobe",
  "handle": "@yourhandle",            # faint watermark, optional
  "caption": "...", "hashtags": ["..."], "sound": "...",
  "slides": [{
     "kicker": "guide",                 # small line above the title
     "title": "HEIGHTMAXXING",          # big red caps
     "subtitle": "Vertical sleep",      # black, large
     "bullets": ["..."] | "steps": ["..."] | "body": "...",
     "wojaks": ["chad", "crying"]      # moods from moods.json, or 'category[:word]', or a file path
  }]
}
Inline colors in any text: {r:red words}, {g:green words}, {b:blue words}.
"""
import argparse, json, random, re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).parent
WOJAKS = HERE / "assets" / "wojaks"
W, H = 1080, 1440
MARGIN = 72
RED, GREEN, BLUE, INK = (232, 28, 28), (24, 190, 60), (30, 90, 220), (20, 20, 20)
COLORS = {"r": RED, "g": GREEN, "b": BLUE}
FONT_DIR = Path("/usr/share/fonts/opentype/inter")


def font(weight, size):
    return ImageFont.truetype(str(FONT_DIR / f"Inter-{weight}.otf"), size)


def background():
    bg = Image.new("RGB", (W, H), (233, 233, 233))
    d = ImageDraw.Draw(bg)
    for x in range(0, W, 54):
        d.line([(x, 0), (x, H)], fill=(214, 214, 214), width=2)
    for y in range(0, H, 54):
        d.line([(0, y), (W, y)], fill=(214, 214, 214), width=2)
    # soft light spot in the middle, like the originals' crumpled-paper glow
    glow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(glow).ellipse([-200, 100, W + 200, H - 100], fill=90)
    glow = glow.filter(ImageFilter.GaussianBlur(220))
    return Image.composite(Image.new("RGB", (W, H), (250, 250, 250)), bg, glow)


def tokens(text, base):
    """Split '{r:foo bar}, baz' into [[(word_part, color), ...], ...] - one entry per word.

    A word can mix colors when a span is glued to punctuation ('{r:5'7},' -> red 5'7 + black comma).
    """
    words, glue = [], False
    for m in re.finditer(r"\{([rgb]):([^}]*)\}|([^{]+)", text):
        chunk = m.group(2) if m.group(1) else m.group(3)
        color = COLORS[m.group(1)] if m.group(1) else base
        parts = chunk.split()
        if not parts:
            glue = False
            continue
        if glue and not chunk[0].isspace() and words:
            words[-1].append((parts.pop(0), color))
        words += [[(w, color)] for w in parts]
        glue = not chunk[-1].isspace()
    return words


def wrap(toks, fnt, width):
    lines, line, lw = [], [], 0
    space = fnt.getlength(" ")
    for w in toks:
        wl = sum(fnt.getlength(t) for t, _ in w)
        if line and lw + space + wl > width:
            lines.append(line); line, lw = [], 0
        lw += (space if line else 0) + wl
        line.append(w)
    if line:
        lines.append(line)
    return lines


def draw_rich(d, x, y, text, fnt, width, base=INK, spacing=1.32):
    """Draw wrapped, inline-colored text; return y below it."""
    lh = int(fnt.size * spacing)
    for line in wrap(tokens(text, base), fnt, width):
        cx = x
        for w in line:
            for t, c in w:
                d.text((cx, y), t, font=fnt, fill=c)
                cx += fnt.getlength(t)
            cx += fnt.getlength(" ")
        y += lh
    return y


def fit_font(text, weight, size, width, min_size=40):
    while size > min_size and font(weight, size).getlength(text) > width:
        size -= 4
    return font(weight, size)


# Skip ethnic / religious / political / military / disability / NSFW themed wojaks:
# random picks from those turn a joke into something nobody asked for.
BLOCKED = re.compile(
    r"jesus|jew|israel|palestin|jihad|islam|muslim|arab|turban|christ|orthodox|catholic|monk|mason|crusad|"
    r"black|asian|africa|india|pakistan|native|mexic|chinese|japan|korea|russia|ukrain|polish|poljak|"
    r"romania|caucasus|central_asian|nordic|anglo|slav|nazi|hitler|wehrmacht|\bss\b|ww[12]|soldier|"
    r"military|brigade|army|isis|cia|centrist|politic|trump|biden|trans|gay|cerebral|palsy|autis|"
    r"retard|ahegao|coomer|nude|maid|thicc|cig|smok|drunk|beer|vodka|gun|knife|blood|suicid",
    re.I,
)


MOODS = json.loads((HERE / "moods.json").read_text()) if (HERE / "moods.json").exists() else {}


def load_index():
    p = WOJAKS / "index.json"
    return json.loads(p.read_text()) if p.exists() else []


def pick_wojak(tag, index, rng):
    """tag: 'category', 'category:word' (name filter inside category), 'word', or a file path."""
    if (HERE / tag).is_file():
        return HERE / tag
    if tag in MOODS:  # hand-picked classics, see moods.json
        pool = [e for e in index if e["name"] in MOODS[tag] or e["category"] in MOODS[tag]]
        if pool:
            return WOJAKS / rng.choice(pool)["path"]
    tag, _, word = tag.lower().replace(" ", "-").partition(":")
    index = [e for e in index if not BLOCKED.search(e["name"])]
    exact = [e for e in index if e["category"] == tag and word in e["name"].lower()]
    fuzzy = [e for e in index if tag.replace("-", "_") in e["name"].lower() or tag in e["name"].lower()]
    pool = exact or fuzzy or index
    if not pool:
        return None
    # transparent cut-outs look cleaner on the grid; opaque pins only when nothing else matches
    clear = [e for e in pool if e.get("alpha", True)]
    return WOJAKS / rng.choice(clear or pool)["path"]


def paste_image(canvas, path, box):
    """Fit image into box (x0, y0, x1, y1), bottom-centered. Opaque images get a white card."""
    x0, y0, x1, y1 = box
    im = Image.open(path).convert("RGBA")
    if (bbox := im.getchannel("A").getbbox()):  # drop empty margins so small cut-outs fill the box
        im = im.crop(bbox)
    k = min((x1 - x0) / im.width, (y1 - y0) / im.height, 3.0)  # cap upscaling to avoid mush
    im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS)
    px, py = x0 + (x1 - x0 - im.width) // 2, y1 - im.height
    opaque = im.getextrema()[3][0] == 255
    if opaque:
        pad = 10
        shadow = Image.new("RGBA", (im.width + 2 * pad + 20, im.height + 2 * pad + 20), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rectangle([10, 10, shadow.width - 10, shadow.height - 10], fill=(0, 0, 0, 60))
        canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(8)), (px - pad - 6, py - pad - 4))
        canvas.alpha_composite(Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), "white"), (px - pad, py - pad))
    canvas.alpha_composite(im, (px, py))


def render_slide(s, handle, index, rng):
    canvas = background().convert("RGBA")
    d = ImageDraw.Draw(canvas)
    tw = W - 2 * MARGIN
    y = 130
    if s.get("kicker"):
        d.text((MARGIN, y), s["kicker"], font=font("Medium", 40), fill=INK); y += 56
    if s.get("title"):
        f = fit_font(s["title"], "Bold", 88, tw)
        d.text((MARGIN, y), s["title"], font=f, fill=RED); y += int(f.size * 1.35)
    if s.get("subtitle"):
        y = draw_rich(d, MARGIN, y + 20, s["subtitle"], font("SemiBold", 64), tw, spacing=1.15) + 18
    body_f = font("Regular", 38)
    if s.get("body"):
        y = draw_rich(d, MARGIN, y, s["body"], body_f, tw)
    for i, item in enumerate(s.get("steps") or s.get("bullets") or [], 1):
        mark = f"{i}." if s.get("steps") else "•"
        d.text((MARGIN + 6, y), mark, font=body_f, fill=INK)
        y = draw_rich(d, MARGIN + 52, y, item, body_f, tw - 52) + 6

    tags = s.get("wojaks", [])
    top, bottom = max(y + 30, 640), H - 90
    if tags and bottom - top > 200:
        n = len(tags)
        gap = 30
        cw = (W - 2 * MARGIN - gap * (n - 1)) // n
        for k, tag in enumerate(tags):
            path = pick_wojak(tag, index, rng)
            if path:
                x0 = MARGIN + k * (cw + gap)
                paste_image(canvas, path, (x0, top, x0 + cw, bottom))

    if handle:  # faint watermark like the originals
        wm = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        f = font("Bold", 150)
        ImageDraw.Draw(wm).text(((W - f.getlength(handle)) / 2, H * 0.58), handle, font=f, fill=(255, 255, 255, 70))
        canvas.alpha_composite(wm)
    return canvas.convert("RGB")


def render(script_path, out_dir, seed=None):
    script = json.loads(Path(script_path).read_text())
    slug = script.get("slug") or Path(script_path).stem
    rng = random.Random(seed if seed is not None else slug)
    index = load_index()
    out = Path(out_dir) / slug
    out.mkdir(parents=True, exist_ok=True)
    for i, s in enumerate(script["slides"], 1):
        render_slide(s, script.get("handle"), index, rng).save(out / f"slide_{i:02d}.png")
    tags = " ".join("#" + t.lstrip("#") for t in script.get("hashtags", []))
    (out / "caption.txt").write_text(f"{script.get('caption', '')} {tags}\n\nsound: {script.get('sound', '')}\n")
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("scripts", nargs="+")
    ap.add_argument("--out", default=str(HERE / "out"))
    ap.add_argument("--seed", type=int)
    a = ap.parse_args()
    for sp in a.scripts:
        print(render(sp, a.out, a.seed))
