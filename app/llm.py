"""Pluggable LLM backends.

- "openai": any OpenAI-compatible /chat/completions server: Ollama, LM Studio, llama.cpp server,
  vLLM, OpenRouter, OpenAI, Groq, DeepSeek, Together...
- "anthropic": Claude via the official Anthropic SDK.

All callers go through ask_json(), which returns a parsed JSON object and retries once
with the parse error when a model returns broken JSON (common with small local models).
"""
import json, re, urllib.error, urllib.request


class LLMError(Exception):
    pass


def _openai_chat(cfg, system, user, want_json):
    url = cfg["base_url"].rstrip("/") + "/chat/completions"
    body = {
        "model": cfg["model"],
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": float(cfg.get("temperature", 0.9)),
    }
    if want_json and cfg.get("json_mode", True):
        body["response_format"] = {"type": "json_object"}
    headers = {"Content-Type": "application/json"}
    if cfg.get("api_key"):
        headers["Authorization"] = f"Bearer {cfg['api_key']}"
    req = urllib.request.Request(url, json.dumps(body).encode(), headers)
    try:
        with urllib.request.urlopen(req, timeout=900) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:500]
        if e.code == 400 and "response_format" in detail and body.pop("response_format", None):
            # some servers don't support JSON mode - retry without it
            return _openai_chat({**cfg, "json_mode": False}, system, user, want_json)
        raise LLMError(f"HTTP {e.code} from {url}: {detail}")
    except urllib.error.URLError as e:
        raise LLMError(f"Can't reach {url}: {e.reason}. Is the server running?")
    try:
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError):
        raise LLMError(f"Unexpected response: {str(data)[:300]}")


def _anthropic_chat(cfg, system, user, want_json):
    import anthropic

    client = anthropic.Anthropic(api_key=cfg.get("api_key") or None, base_url=cfg.get("base_url") or None)
    try:
        resp = client.messages.create(
            model=cfg.get("model") or "claude-opus-5-5",
            max_tokens=16000,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
    except anthropic.APIConnectionError as e:
        raise LLMError(f"Can't reach Anthropic API: {e}")
    except anthropic.APIStatusError as e:
        raise LLMError(f"Anthropic API error {e.status_code}: {e.message}")
    if resp.stop_reason == "refusal":
        raise LLMError("The model declined this request.")
    return "".join(b.text for b in resp.content if b.type == "text")


def chat(cfg, system, user, want_json=False):
    provider = cfg.get("provider", "openai")
    if provider == "anthropic":
        return _anthropic_chat(cfg, system, user, want_json)
    return _openai_chat(cfg, system, user, want_json)


def extract_json(text):
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)  # reasoning models (deepseek-r1, qwq...)
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("no JSON object found")
    return json.loads(text[start:end + 1])


def ask_json(cfg, system, user, validate=None):
    """Ask for a JSON object; one repair round if parsing or validation fails."""
    raw = chat(cfg, system, user, want_json=True)
    for attempt in range(2):
        try:
            data = extract_json(raw)
            return validate(data) if validate else data
        except (ValueError, KeyError, TypeError) as e:
            if attempt:
                raise LLMError(f"Model returned invalid JSON twice ({e}). Try a bigger model or simpler request.\n\n{raw[:600]}")
            raw = chat(cfg, system, f"{user}\n\nYour previous answer was invalid ({e}):\n{raw[:3000]}\n\n"
                                    "Answer again with ONLY the corrected JSON object.", want_json=True)
