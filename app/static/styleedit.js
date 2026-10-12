// Style editor panel: live color/var controls, "ask the LLM to restyle", save / duplicate / reset.
import { state, api, toast, renderDeck, busy } from "/static/app.js";
import { mountScaled } from "/static/slide.js";

const COLOR_VARS = [
  ["--bg", "Фон"], ["--text", "Текст"], ["--accent", "Акцент {r}"], ["--good", "Зелёный {g}"],
  ["--info", "Синий {b}"], ["--muted", "Приглушённый"], ["--title-color", "Цвет заголовка"], ["--sub-color", "Подзаголовок"],
];
const NUM_VARS = [["--title-size", "Заголовок, px"], ["--sub-size", "Подзаголовок, px"], ["--body-size", "Текст, px"], ["--kicker-size", "Kicker, px"]];
const FONTS = ["'Inter', sans-serif", "'Archivo Black', sans-serif", "'Anton', sans-serif", "'Unbounded', sans-serif",
  "'Oswald', sans-serif", "'Space Grotesk', sans-serif", "'JetBrains Mono', monospace", "'Playfair Display', serif"];
const TEXTURES = ["grid", "paper", "noise", "scanlines", "halftone", "glow", "vignette", "stars", "lines"];

let working = null; // live copy being edited

export function buildStyleEditor(panel, style) {
  if (!style) { panel.innerHTML = "<p class='muted'>Выбери стиль.</p>"; return; }
  working = structuredClone(style);
  panel.replaceChildren();

  const h = document.createElement("div");
  h.innerHTML = `<h3 style="margin:0 0 2px">${style.name}</h3><p class="muted" style="margin:0 0 6px;font-size:13px">${style.builtin ? "встроенный" : "мой стиль"}${style.overrides_builtin ? " (изменён)" : ""}</p>`;
  panel.appendChild(h);

  const prev = document.createElement("div");
  prev.style.cssText = "width:100%;aspect-ratio:3/4;background:#000;border-radius:12px;overflow:hidden;position:relative;margin-bottom:6px";
  panel.appendChild(prev);
  const sample = { layout: "text", kicker: "guide", title: working.name.toUpperCase().slice(0, 14) || "GUIDE", subtitle: "How do it right",
    bullets: ["{r:accent} words pop", "{g:results} are green", "readable in 3s"], images: [{ wojak: "crying" }], source: "source: trust me bro" };
  const redraw = () => requestAnimationFrame(() => mountScaled(prev, sample, working, { scale: (panel.clientWidth - 40) / (working.size?.[0] || 1080) }));
  redraw();

  // AI restyle
  const ai = document.createElement("div"); ai.className = "field";
  ai.innerHTML = "<span>Попросить LLM изменить стиль</span>";
  const aiRow = document.createElement("div"); aiRow.className = "ai-row";
  const aiInput = document.createElement("input"); aiInput.placeholder = "например: сделай фон глубокий фиолетовый, заголовок с неоном";
  const aiBtn = document.createElement("button"); aiBtn.className = "btn"; aiBtn.textContent = "Применить";
  aiBtn.onclick = async () => {
    if (!aiInput.value.trim()) return;
    busy(true, "LLM меняет стиль…");
    try {
      const res = await api.send("POST", "/api/styles/ai", { style: working, instruction: aiInput.value.trim() });
      working = res; redraw(); buildVarControls(); aiInput.value = "";
      toast("Стиль обновлён в предпросмотре — не забудь «Сохранить»");
    } catch (e) { toast(e.message, true); } finally { busy(false); }
  };
  aiRow.append(aiInput, aiBtn); ai.appendChild(aiRow); panel.appendChild(ai);

  // texture toggles
  const tex = document.createElement("div"); tex.className = "field";
  tex.innerHTML = "<span>Текстуры фона</span>";
  const texChips = document.createElement("div"); texChips.className = "chip-row";
  TEXTURES.forEach(t => { const c = document.createElement("span"); c.className = "chip" + ((working.texture || []).includes(t) ? " on" : ""); c.textContent = t;
    c.onclick = () => { working.texture = working.texture || []; const i = working.texture.indexOf(t); i < 0 ? working.texture.push(t) : working.texture.splice(i, 1); c.classList.toggle("on"); redraw(); }; texChips.appendChild(c); });
  tex.appendChild(texChips); panel.appendChild(tex);

  // font pickers
  const fontWrap = document.createElement("details"); fontWrap.className = "collapse"; fontWrap.innerHTML = "<summary>Шрифты</summary>";
  for (const [v, label] of [["--font-title", "Заголовок"], ["--font-body", "Текст"], ["--font-kicker", "Kicker"], ["--font-subtitle", "Подзаголовок"]]) {
    const row = document.createElement("div"); row.className = "var-row";
    const sel = document.createElement("select"); sel.innerHTML = FONTS.map(f => `<option value="${f}" ${(working.vars[v] || "") === f ? "selected" : ""}>${f.split(",")[0].replace(/'/g, "")}</option>`).join("");
    sel.onchange = () => { working.vars[v] = sel.value; redraw(); };
    row.innerHTML = `<label>${label}</label>`; row.appendChild(sel); fontWrap.appendChild(row);
  }
  panel.appendChild(fontWrap);

  const varBox = document.createElement("div"); panel.appendChild(varBox);
  function buildVarControls() {
    varBox.replaceChildren();
    for (const [v, label] of COLOR_VARS) varBox.appendChild(colorRow(v, label, redraw));
    for (const [v, label] of NUM_VARS) varBox.appendChild(numRow(v, label, redraw));
    const adv = document.createElement("details"); adv.className = "collapse"; adv.innerHTML = "<summary>Все переменные (CSS)</summary>";
    const ta = document.createElement("textarea"); ta.rows = 8; ta.value = JSON.stringify(working.vars, null, 1);
    ta.oninput = () => { try { working.vars = JSON.parse(ta.value); redraw(); } catch {} };
    adv.appendChild(ta);
    const cssTa = document.createElement("textarea"); cssTa.rows = 4; cssTa.placeholder = "доп. CSS (.slide …)"; cssTa.value = working.css || "";
    cssTa.oninput = () => { working.css = cssTa.value; };
    adv.appendChild(document.createElement("br")); adv.appendChild(cssTa);
    varBox.appendChild(adv);
  }
  buildVarControls();

  // actions
  const acts = document.createElement("div"); acts.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:8px";
  const save = document.createElement("button"); save.className = "btn primary"; save.textContent = "Сохранить";
  save.onclick = async () => { await persist(working); toast("Стиль сохранён"); };
  const dup = document.createElement("button"); dup.className = "btn"; dup.textContent = "Сохранить как новый";
  dup.onclick = async () => { const copy = structuredClone(working); copy.id = (copy.id || "style") + "-copy"; copy.name = working.name + " копия"; delete copy.builtin; delete copy.overrides_builtin; await persist(copy); toast("Создан новый стиль"); };
  const reset = document.createElement("button"); reset.className = "btn danger"; reset.textContent = style.builtin ? "Сбросить" : "Удалить";
  reset.onclick = async () => {
    const r = await api.send("DELETE", "/api/styles/" + style.id); state.styles = r.styles;
    toast(style.builtin ? "Сброшено к стандартному" : "Удалено");
    document.querySelector('.tab[data-view="styles"]').click();
  };
  acts.append(save, dup, reset); panel.appendChild(acts);
}

async function persist(style) {
  const saved = await api.send("PUT", "/api/styles", style);
  const i = state.styles.findIndex(s => s.id === saved.id);
  if (i >= 0) state.styles[i] = saved; else state.styles.push(saved);
  if (state.project?.style === saved.id) renderDeck();
  document.querySelector('.tab[data-view="styles"]').click();
}

function colorRow(v, label, redraw) {
  const row = document.createElement("div"); row.className = "var-row";
  const cur = working.vars[v] || "";
  const box = document.createElement("div"); box.className = "var-input";
  const color = document.createElement("input"); color.type = "color"; color.value = hexOf(cur);
  const text = document.createElement("input"); text.value = cur; text.placeholder = "CSS";
  color.oninput = () => { working.vars[v] = color.value; text.value = color.value; redraw(); };
  text.oninput = () => { working.vars[v] = text.value; if (/^#[0-9a-f]{6}$/i.test(text.value)) color.value = text.value; redraw(); };
  box.append(color, text);
  row.innerHTML = `<label title="${v}">${label}</label>`; row.appendChild(box); return row;
}
function numRow(v, label, redraw) {
  const row = document.createElement("div"); row.className = "var-row";
  const inp = document.createElement("input"); inp.value = working.vars[v] || "";
  inp.oninput = () => { working.vars[v] = inp.value; redraw(); };
  row.innerHTML = `<label title="${v}">${label}</label>`; row.appendChild(inp); return row;
}
function hexOf(css) { const m = /#([0-9a-f]{6})/i.exec(css || ""); return m ? "#" + m[1] : "#888888"; }
