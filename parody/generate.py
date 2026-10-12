"""Generate parody "looksmaxxing guide" carousel scripts with Claude, then render them.

Usage:
  python generate.py "heightmaxxing via standing next to short people" [--n 3] [--trends trends.md]
  python generate.py --ideas 5            # let Claude pick the topics too

Writes scripts/<slug>.json and renders out/<slug>/slide_XX.png + caption.txt.
Needs Anthropic credentials (ANTHROPIC_API_KEY or an `ant auth login` profile).
"""
import argparse, json, re
from pathlib import Path
from typing import List, Literal, Optional

import anthropic
from pydantic import BaseModel, Field

import render

HERE = Path(__file__).parent
MOOD_NAMES = list(json.loads((HERE / "moods.json").read_text()))
Mood = Literal[tuple(MOOD_NAMES)]


class Slide(BaseModel):
    kicker: str = Field(description='tiny line above the title, e.g. "guide" or "working guide to"')
    title: str = Field(description="topic in caps, same on every slide, e.g. HEIGHTMAXXING")
    subtitle: str
    bullets: Optional[List[str]] = None
    steps: Optional[List[str]] = None
    body: Optional[str] = None
    wojaks: List[Mood] = Field(description="1-2 wojak moods that react to the slide")


class Carousel(BaseModel):
    slug: str = Field(description="snake_case file name")
    caption: str
    hashtags: List[str]
    sound: str = Field(description="what kind of sound to put under it")
    slides: List[Slide]


class Batch(BaseModel):
    carousels: List[Carousel]


SYSTEM = f"""You write PARODY TikTok photo carousels that make fun of the "looksmaxxing / heightmaxxing / \
iqmaxxing guide" niche. The format copies those accounts: 4-6 slides, a tiny kicker ("guide"), the same red \
caps TITLE on every slide, a black subtitle ("How do it right", "What we need:", "Application areas", \
"CONCLUSION"), then 3-5 bullets/steps or a short body paragraph, plus 1-2 wojak reactions.

The joke: deadpan pseudo-scientific tone + completely absurd, harmless "protocols" (sleeping in a wardrobe, \
reading terms & conditions for IQ, chewing on your decisions for jawline, looking into spoons for symmetry). \
Fake stats and fake sources ("Journal of Mogging Studies, 2026", "trust me bro et al.") are welcome. The last \
slide is a CONCLUSION where the protocol obviously failed or backfired in a funny way.

Hard rules - the audience is teenagers, and every protocol must be something nobody could copy to hurt \
themselves:
- No real drugs, medications, peptides, hormones, supplements, or "stacks" of anything ingestible.
- No real or imitated medical/cosmetic procedures, nothing applied to bones, joints, skin, eyes or nose, \
no hitting/pressing/stretching/hanging the body, no tools on the body.
- No dieting, fasting, purging, dehydration, sleep deprivation, or extreme exercise.
- No insults about real ethnic groups, religions, disabilities, or real private people.
- No "DM for source", selling, or links.
If a topic can only be funny by breaking these rules, pick a different angle.

Inline color markup: {{r:red words}} for "bad" things, {{g:green words}} for "results", {{b:blue words}} for \
names. Keep each slide short enough to read in 3 seconds (body under 45 words, bullets under 9 words). \
Write in English unless asked otherwise, in the lowercase-gen-z voice of the niche (mog, ascend, aura, \
mewing, cope, it's over, we're so back). Hashtags: niche tags + "satire".

Wojak moods available: {", ".join(MOOD_NAMES)}."""


def generate(topics, n, trends, lang):
    client = anthropic.Anthropic()
    ask = (f"Write {n} carousel(s)." + (f" Topics: {'; '.join(topics)}." if topics else
           " Pick the topics yourself: parody the niche's most common 'guides'.")
           + (f" Language: {lang}." if lang != "en" else ""))
    if trends:
        ask += f"\n\nCurrent TikTok trends/slang/sounds to weave in where they fit:\n{trends}"
    resp = client.messages.parse(
        model="claude-opus-5-5",
        max_tokens=16000,
        system=SYSTEM,
        output_config={"effort": "medium"},
        messages=[{"role": "user", "content": ask}],
        output_format=Batch,
    )
    if resp.stop_reason == "refusal":
        raise SystemExit(f"refused: {resp.stop_details}")
    return resp.parsed_output.carousels


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("topics", nargs="*")
    ap.add_argument("--ideas", type=int, help="number of carousels on topics Claude picks")
    ap.add_argument("--n", type=int, help="carousels per run (default: one per topic)")
    ap.add_argument("--trends", help="markdown/text file with current trends to weave in")
    ap.add_argument("--lang", default="en")
    ap.add_argument("--handle", default="", help="faint watermark on slides")
    a = ap.parse_args()
    n = a.n or a.ideas or max(1, len(a.topics))
    trends = Path(a.trends).read_text() if a.trends else ""
    (HERE / "scripts").mkdir(exist_ok=True)
    for c in generate(a.topics, n, trends, a.lang):
        data = c.model_dump(exclude_none=True)
        data["slug"] = re.sub(r"\W+", "_", data["slug"]).strip("_").lower()
        data["handle"] = a.handle
        path = HERE / "scripts" / f"{data['slug']}.json"
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2))
        print(render.render(path, HERE / "out"))
