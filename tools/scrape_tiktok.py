"""Scrape all posts (videos + photo carousels) of TikTok accounts.

Usage: python scrape_tiktok.py OUT_DIR user1 [user2 ...]

For each post saves: post.json (caption, hashtags, music, stats), the video
(mp4) or carousel images (jpg), and the audio track. Requires yt-dlp[curl-cffi].
"""
import json, re, subprocess, sys, time
from pathlib import Path
from curl_cffi import requests

S = requests.Session(impersonate="chrome")


def rehydration(url):
    html = S.get(url).text
    m = re.search(r'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>', html, re.S)
    return json.loads(m.group(1))["__DEFAULT_SCOPE__"] if m else {}


def list_ids(user):
    out = subprocess.run(["yt-dlp", "--impersonate", "chrome", "--flat-playlist", "-J",
                          f"https://www.tiktok.com/@{user}"], capture_output=True, text=True).stdout
    return [e["id"] for e in json.loads(out).get("entries", [])] if out else []


def fetch(url, path):
    if path.exists():
        return
    r = S.get(url)
    r.raise_for_status()
    path.write_bytes(r.content)


def scrape_post(user, vid, out):
    d = out / vid
    d.mkdir(parents=True, exist_ok=True)
    scope = rehydration(f"https://www.tiktok.com/@{user}/video/{vid}")
    item = scope.get("webapp.video-detail", {}).get("itemInfo", {}).get("itemStruct", {})
    if not item:  # photo posts sometimes only resolve under /photo/
        scope = rehydration(f"https://www.tiktok.com/@{user}/photo/{vid}")
        item = scope.get("webapp.video-detail", {}).get("itemInfo", {}).get("itemStruct", {})
    if not item:
        print("  no data for", vid)
        return
    images = item.get("imagePost", {}).get("images", [])
    music = item.get("music", {})
    post = {
        "id": vid,
        "url": f"https://www.tiktok.com/@{user}/video/{vid}",
        "created": time.strftime("%Y-%m-%d %H:%M", time.gmtime(int(item.get("createTime", 0)))),
        "type": "carousel" if images else "video",
        "desc": item.get("desc"),
        "hashtags": [c["hashtagName"] for c in item.get("challenges", []) if c.get("hashtagName")],
        "text_extra": [t.get("hashtagName") or t.get("userUniqueId") for t in item.get("textExtra", [])],
        "duration": item.get("video", {}).get("duration"),
        "n_images": len(images),
        "music": {k: music.get(k) for k in ("title", "authorName", "original", "duration", "playUrl")},
        "stats": item.get("statsV2") or item.get("stats"),
        "subtitles": [s.get("LanguageCodeName") for s in item.get("video", {}).get("subtitleInfos", [])],
        "anchors": [a.get("keyword") for a in item.get("anchors", [])],
        "sticker_text": [t for s in item.get("stickersOnItem", []) for t in s.get("stickerText", [])],
    }
    (d / "post.json").write_text(json.dumps(post, ensure_ascii=False, indent=2))
    (d / "raw_item.json").write_text(json.dumps(item, ensure_ascii=False, indent=2))
    for i, img in enumerate(images, 1):
        urls = img.get("imageURL", {}).get("urlList", [])
        for u in urls:
            try:
                fetch(u, d / f"img_{i:02d}.jpg"); break
            except Exception as e:
                print("  img fail", e)
    if music.get("playUrl"):
        try: fetch(music["playUrl"], d / "audio.mp3")
        except Exception as e: print("  audio fail", e)
    if not images and not any(d.glob("video.*")):
        subprocess.run(["yt-dlp", "--impersonate", "chrome", "-q", "--write-subs", "--sub-langs", "all",
                        "-o", str(d / "video.%(ext)s"), post["url"]])
    print(f"  {vid} {post['type']} imgs={len(images)} {post['desc'][:60]!r}")


if __name__ == "__main__":
    out = Path(sys.argv[1])
    for user in sys.argv[2:]:
        prof = rehydration(f"https://www.tiktok.com/@{user}").get("webapp.user-detail", {})
        if prof.get("statusCode"):
            print(f"@{user}: not found (status {prof.get('statusCode')})"); continue
        (out / user).mkdir(parents=True, exist_ok=True)
        (out / user / "profile.json").write_text(json.dumps(prof.get("userInfo"), ensure_ascii=False, indent=2))
        ids = list_ids(user)
        print(f"@{user}: {len(ids)} posts")
        for vid in ids:
            scrape_post(user, vid, out / user)
