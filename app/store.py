"""File-based storage: settings, projects, styles, uploads. Everything user-made lives in userdata/."""
import json, re, time, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
USER = ROOT / "userdata"
LIBRARY = ROOT / "library"
BUILTIN_STYLES = APP / "styles"
USER_STYLES = USER / "styles"
PROJECTS = USER / "projects"
UPLOADS = USER / "uploads"
EXTRA_LIBRARY = USER / "library"  # tools/fetch_wojaks.py puts the full wojak dump here

for d in (USER_STYLES, PROJECTS, UPLOADS):
    d.mkdir(parents=True, exist_ok=True)

DEFAULT_SETTINGS = {
    "llm": {
        "provider": "openai",              # "openai" = any OpenAI-compatible server, or "anthropic"
        "base_url": "http://localhost:11434/v1",
        "api_key": "",
        "model": "llama3.1",
        "temperature": 0.9,
        "json_mode": True,
    },
    "instructions": "",                    # your niche / voice / rules, added to every generation
    "language": "English",
    "handle": "",
    "default_style": "ixe-grid",
}


def _read(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _write(path, data):
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def slugify(s, fallback="item"):
    s = re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")
    return s[:48] or fallback


# ---- settings ----
def get_settings():
    s = _read(USER / "settings.json", {})
    merged = {**DEFAULT_SETTINGS, **s}
    merged["llm"] = {**DEFAULT_SETTINGS["llm"], **s.get("llm", {})}
    return merged


def save_settings(data):
    _write(USER / "settings.json", data)
    return get_settings()


# ---- styles ----
def list_styles():
    styles = {}
    for p in sorted(BUILTIN_STYLES.glob("[!_]*.json")):
        st = _read(p)
        if st:
            st["builtin"] = True
            styles[st["id"]] = st
    for p in sorted(USER_STYLES.glob("*.json")):
        st = _read(p)
        if st:
            st["builtin"] = False
            st["overrides_builtin"] = st["id"] in styles and styles[st["id"]].get("builtin", False)
            styles[st["id"]] = st
    order = _read(BUILTIN_STYLES / "_order.json", [])
    return sorted(styles.values(), key=lambda s: (order.index(s["id"]) if s["id"] in order else 999, s["name"]))


def get_style(style_id):
    return next((s for s in list_styles() if s["id"] == style_id), None)


def save_style(style):
    style = {k: v for k, v in style.items() if k not in ("builtin", "overrides_builtin")}
    style["id"] = slugify(style.get("id") or style.get("name"), "style")
    _write(USER_STYLES / f"{style['id']}.json", style)
    return get_style(style["id"])


def delete_style(style_id):
    """Deletes a user style, or resets a modified built-in back to default."""
    p = USER_STYLES / f"{slugify(style_id)}.json"
    if p.exists():
        p.unlink()
        return True
    return False


# ---- projects ----
def list_projects():
    out = []
    for p in PROJECTS.glob("*.json"):
        d = _read(p)
        if d:
            out.append({"id": d["id"], "name": d.get("name", d["id"]), "updated": d.get("updated", 0),
                        "style": d.get("style"), "slides": len(d.get("slides", []))})
    return sorted(out, key=lambda x: -x["updated"])


def get_project(pid):
    return _read(PROJECTS / f"{slugify(pid)}.json")


def save_project(project):
    project["id"] = slugify(project.get("id") or uuid.uuid4().hex[:10])
    project["updated"] = time.time()
    _write(PROJECTS / f"{project['id']}.json", project)
    return project


def delete_project(pid):
    p = PROJECTS / f"{slugify(pid)}.json"
    if p.exists():
        p.unlink()
