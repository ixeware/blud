"""blud - local carousel studio. Run: python run.py"""
import hashlib, json, random, re, urllib.request
from pathlib import Path

from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import llm, prompts, store

app = FastAPI(title="blud")
STATIC = store.APP / "static"
WOJAKS = store.LIBRARY / "wojaks"
IMG_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


# ---------- wojak library ----------
def library():
    """{mood: [url, ...]} from the bundled library + the optional full dump in userdata/library."""
    moods = json.loads((WOJAKS / "moods.json").read_text())
    out = {m: [f"/library/wojaks/{m}/{f}" for f in files] for m, files in moods.items()}
    extra = store.EXTRA_LIBRARY / "wojaks"
    if extra.exists():
        for d in sorted(p for p in extra.rglob("*") if p.is_dir()):
            files = sorted(f for f in d.iterdir() if f.suffix.lower() in IMG_EXT)
            if files:
                key = "all/" + str(d.relative_to(extra)).replace("\\", "/")
                out[key] = [f"/userlib/wojaks/{f.relative_to(extra).as_posix()}" for f in files]
    return out


def pick(mood, avoid=None, rng=random):
    lib = library()
    mood = (mood or "").lower().strip()
    pool = lib.get(mood) or next((v for k, v in lib.items() if mood and mood in k), None) or lib["wojak"]
    choices = [u for u in pool if u != avoid] or pool
    return rng.choice(choices)


def is_card(src):
    """Photos (jpg) get a frame; transparent cut-outs (png) float on the slide."""
    return Path(src.split("?")[0]).suffix.lower() in (".jpg", ".jpeg", ".webp")


def resolve_images(project):
    rng = random.Random()
    def fix(img):
        if isinstance(img, str):
            img = {"wojak": img}
        if not isinstance(img, dict):
            return None
        if not img.get("src"):
            img["src"] = pick(img.get("wojak") or "wojak", rng=rng)
        img.setdefault("card", is_card(img["src"]))
        return img
    for s in project.get("slides", []):
        s["images"] = [i for i in (fix(x) for x in s.get("images") or []) if i]
        for it in s.get("items") or []:
            if it.get("image"):
                it["image"] = fix(it["image"])
    return project


def validate_project(data):
    if not isinstance(data.get("slides"), list) or not data["slides"]:
        raise ValueError('"slides" must be a non-empty list')
    for s in data["slides"]:
        if not isinstance(s, dict):
            raise ValueError("each slide must be an object")
        s.setdefault("layout", "text")
        for k in ("bullets", "steps"):
            if isinstance(s.get(k), str):
                s[k] = [x.strip("-• ").strip() for x in s[k].splitlines() if x.strip()]
    data["hashtags"] = [h.lstrip("#") for h in data.get("hashtags") or []]
    return data


def validate_style(data):
    if not isinstance(data.get("vars"), dict):
        raise ValueError('"vars" must be an object')
    data.setdefault("texture", [])
    data.setdefault("css", "")
    return data


# ---------- API ----------
@app.get("/api/state")
def state():
    return {"settings": store.get_settings(), "styles": store.list_styles(),
            "projects": store.list_projects(), "library": library()}


@app.put("/api/settings")
def put_settings(data: dict = Body(...)):
    return store.save_settings(data)


@app.post("/api/llm/test")
def llm_test(cfg: dict = Body(...)):
    try:
        out = llm.chat(cfg, "Reply with one short sentence.", "Say hi and name the model you are.")
        return {"ok": True, "reply": out.strip()[:300]}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _llm_call(system, user, validate):
    cfg = store.get_settings()["llm"]
    try:
        return llm.ask_json(cfg, system, user, validate)
    except llm.LLMError as e:
        raise HTTPException(502, str(e))
    except Exception as e:  # provider SDK errors etc.
        raise HTTPException(502, f"{type(e).__name__}: {e}")


@app.post("/api/generate")
def generate(req: dict = Body(...)):
    s = store.get_settings()
    style = store.get_style(req.get("style") or s["default_style"]) or {}
    lib = [m for m in library() if not m.startswith("all/")]
    system = prompts.generate_system(lib, style, s["instructions"], req.get("language") or s["language"])
    project = _llm_call(system, prompts.generate_user(req["prompt"], req.get("slides")), validate_project)
    project["style"] = style.get("id")
    project["prompt"] = req["prompt"]
    return store.save_project(resolve_images(project))


@app.post("/api/edit")
def edit(req: dict = Body(...)):
    s = store.get_settings()
    project = req["project"]
    lib = [m for m in library() if not m.startswith("all/")]
    system = prompts.edit_system(lib, s["instructions"], s["language"])
    new = _llm_call(system, prompts.edit_user(project, req["instruction"]), validate_project)
    for k in ("id", "style", "prompt", "handle", "size"):
        if k in project:
            new[k] = project[k]
    return store.save_project(resolve_images(new))


@app.post("/api/styles/ai")
def style_ai(req: dict = Body(...)):
    new = _llm_call(prompts.style_system(), prompts.style_user(req["style"], req["instruction"]), validate_style)
    if req.get("as_new"):
        new["id"] = store.slugify(new.get("name") or "custom") + "-" + hashlib.md5(json.dumps(new).encode()).hexdigest()[:4]
    else:
        new["id"] = req["style"]["id"]
    return new  # not saved until the user presses Save


@app.put("/api/styles")
def put_style(style: dict = Body(...)):
    return store.save_style(validate_style(style))


@app.delete("/api/styles/{sid}")
def del_style(sid: str):
    return {"deleted": store.delete_style(sid), "styles": store.list_styles()}


@app.get("/api/projects/{pid}")
def get_project(pid: str):
    p = store.get_project(pid)
    if not p:
        raise HTTPException(404)
    return p


@app.put("/api/projects")
def put_project(project: dict = Body(...)):
    return store.save_project(resolve_images(project))


@app.delete("/api/projects/{pid}")
def del_project(pid: str):
    store.delete_project(pid)
    return store.list_projects()


@app.get("/api/wojak")
def random_wojak(mood: str, avoid: str = ""):
    src = pick(mood, avoid)
    return {"src": src, "wojak": mood, "card": is_card(src)}


def _save_upload(data, ext):
    name = hashlib.sha1(data).hexdigest()[:16] + ext
    (store.UPLOADS / name).write_bytes(data)
    return {"src": f"/uploads/{name}", "card": is_card(name)}


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in IMG_EXT:
        raise HTTPException(400, "image files only")
    return _save_upload(await file.read(), ".jpg" if ext == ".jpeg" else ext)


@app.post("/api/fetch-image")
def fetch_image(req: dict = Body(...)):
    url = req["url"]
    if not re.match(r"https?://", url):
        raise HTTPException(400, "http(s) URL expected")
    r = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30)
    ctype = r.headers.get("Content-Type", "")
    ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}.get(ctype.split(";")[0])
    if not ext:
        raise HTTPException(400, f"not an image ({ctype})")
    return _save_upload(r.read(25_000_000), ext)


# ---------- static ----------
app.mount("/static", StaticFiles(directory=STATIC), name="static")
app.mount("/library", StaticFiles(directory=store.LIBRARY), name="library")
app.mount("/uploads", StaticFiles(directory=store.UPLOADS), name="uploads")
store.EXTRA_LIBRARY.mkdir(parents=True, exist_ok=True)
app.mount("/userlib", StaticFiles(directory=store.EXTRA_LIBRARY), name="userlib")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")
