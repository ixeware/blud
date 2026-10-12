#!/usr/bin/env python3
"""Launch the blud carousel studio locally.

    python run.py            # http://127.0.0.1:8000
    python run.py --port 9000 --host 0.0.0.0

First time: pip install -r requirements.txt, then open the page and go to "Подключение"
to point blud at your local LLM (Ollama / LM Studio / llama.cpp) or any OpenAI-compatible API.
"""
import argparse
import webbrowser

import uvicorn


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-open", action="store_true", help="don't open the browser")
    ap.add_argument("--reload", action="store_true")
    a = ap.parse_args()
    url = f"http://{'127.0.0.1' if a.host == '0.0.0.0' else a.host}:{a.port}"
    print(f"blud studio → {url}")
    if not a.no_open and not a.reload:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    uvicorn.run("app.server:app", host=a.host, port=a.port, reload=a.reload)


if __name__ == "__main__":
    main()
