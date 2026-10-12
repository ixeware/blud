import { renderSlide, mountScaled, rich } from "/static/slide.js";
import { exportProject } from "/static/export.js";
import { openSlideEditor } from "/static/editor.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const api = {
  async get(u) { return handle(await fetch(u)); },
  async send(m, u, body) { return handle(await fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })); },
};
async function handle(r) {
  if (!r.ok) { let d; try { d = (await r.json()).detail; } catch {} throw new Error(d || `${r.status} ${r.statusText}`); }
  return r.status === 204 ? null : r.json();
}

export const state = { settings: null, styles: [], projects: [], library: {}, project: null };
export const styleById = id => state.styles.find(s => s.id === id);
export const moodKeys = () => Object.keys(state.library).filter(k => !k.startsWith("all/"));

let toastT;
export function toast(msg, isErr) {
  const t = $("#toast"); t.textContent = msg; t.className = "toast" + (isErr ? " err" : ""); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), isErr ? 6000 : 3000);
}
export function busy(on, text) { const o = $("#overlay"); if (text) $("#overlayText").textContent = text; o.hidden = !on; }

// ---------- boot ----------
async function boot() {
  Object.assign(state, await api.get("/api/state"));
  fillStyleSelect();
  renderSettings();
  updateBadge();
  bindTabs();
  bindCreate();
  if (state.projects[0]) await loadProject(state.projects[0].id);
}

function updateBadge() {
  const l = state.settings.llm;
  const b = $("#llmBadge");
  b.textContent = l.model ? `${l.model}` : "модель не задана";
  b.classList.toggle("off", !l.model || !l.base_url);
}

function bindTabs() {
  $$(".tab").forEach(t => t.onclick = () => {
    $$(".tab").forEach(x => x.classList.toggle("active", x === t));
    $$(".view").forEach(v => v.hidden = v.id !== "view-" + t.dataset.view);
    if (t.dataset.view === "styles") renderStyleGallery();
    if (t.dataset.view === "projects") renderProjects();
  });
}

// ---------- create / deck ----------
function fillStyleSelect() {
  const sel = $("#styleSelect");
  sel.innerHTML = state.styles.map(s => `<option value="${s.id}">${s.name}</option>`).join("");
  sel.value = state.project?.style || state.settings.default_style;
}

function bindCreate() {
  $("#genBtn").onclick = generate;
  $("#editBtn").onclick = editProject;
  $("#exportBtn").onclick = () => state.project && exportProject(state.project, styleById(state.project.style), state.settings.handle);
  $("#saveBtn").onclick = saveProject;
  $("#restyleBtn").onclick = async () => {
    if (!state.project) return;
    state.project.style = $("#styleSelect").value;
    await saveProject(); renderDeck();
  };
  const pn = $("#projName");
  pn.onclick = () => { if (state.project) { pn.contentEditable = "true"; pn.focus(); } };
  pn.onblur = () => { pn.contentEditable = "false"; if (state.project) { state.project.name = pn.textContent.trim(); saveProject(); } };
  for (const [id, key] of [["capText", "caption"], ["capTags", "hashtags"], ["capSound", "sound"]])
    $("#" + id).onchange = e => { if (!state.project) return; state.project[key] = key === "hashtags" ? e.target.value.split(/\s+/).filter(Boolean).map(h => h.replace(/^#/, "")) : e.target.value; saveProject(); };
}

async function generate() {
  const prompt = $("#prompt").value.trim();
  if (!prompt) return toast("Напиши, что сгенерировать", true);
  busy(true, "Генерирую карусель…");
  try {
    const p = await api.send("POST", "/api/generate", {
      prompt, style: $("#styleSelect").value,
      slides: Number($("#slideCount").value) || 0,
      language: state.settings.language,
    });
    setProject(p); await refreshProjects();
    toast("Готово — " + p.slides.length + " слайдов");
  } catch (e) { toast(e.message, true); } finally { busy(false); }
}

async function editProject() {
  if (!state.project) return toast("Сначала создай карусель", true);
  const instruction = $("#editText").value.trim();
  if (!instruction) return;
  busy(true, "Применяю правку…");
  try {
    const p = await api.send("POST", "/api/edit", { project: state.project, instruction });
    setProject(p); $("#editText").value = ""; await refreshProjects();
    toast("Готово");
  } catch (e) { toast(e.message, true); } finally { busy(false); }
}

export function setProject(p) {
  state.project = p;
  $("#projName").textContent = p.name || "Без названия";
  $("#styleSelect").value = p.style || state.settings.default_style;
  $("#capText").value = p.caption || "";
  $("#capTags").value = (p.hashtags || []).map(h => "#" + h).join(" ");
  $("#capSound").value = p.sound || "";
  $("#captionBox").hidden = false;
  renderDeck();
}

export function renderDeck() {
  const deck = $("#deck"); const p = state.project;
  if (!p) return;
  const style = styleById(p.style) || state.styles[0];
  deck.replaceChildren();
  p.slides.forEach((slide, i) => deck.appendChild(slideCard(slide, i, style)));
  const add = document.createElement("button");
  add.className = "add-slide"; add.textContent = "＋ слайд";
  add.onclick = () => { p.slides.push({ layout: "text", title: p.slides[0]?.title || "", subtitle: "", body: "" }); saveAndRender(); openSlide(p.slides.length - 1); };
  deck.appendChild(add);
}

function slideCard(slide, i, style) {
  const card = document.createElement("div"); card.className = "slide-card";
  const prev = document.createElement("div"); prev.className = "preview";
  card.appendChild(prev);
  requestAnimationFrame(() => mountScaled(prev, slide, style, { scale: 300 / (style.size?.[0] || 1080), handle: state.settings.handle, pageno: i + 1 }));
  prev.onclick = () => openSlide(i);
  const bar = document.createElement("div"); bar.className = "bar";
  bar.innerHTML = `<span class="idx">#${i + 1}</span>`;
  const mk = (icon, title, fn) => { const b = document.createElement("button"); b.className = "icon-btn"; b.title = title; b.textContent = icon; b.onclick = fn; return b; };
  bar.append(
    mk("✎", "Редактировать", () => openSlide(i)),
    mk("⧉", "Дублировать", () => { state.project.slides.splice(i + 1, 0, structuredClone(slide)); saveAndRender(); }),
    mk("↑", "Выше", () => move(i, -1)),
    mk("↓", "Ниже", () => move(i, 1)),
    mk("🗑", "Удалить", () => { state.project.slides.splice(i, 1); saveAndRender(); }),
  );
  card.appendChild(bar);
  return card;
}

function move(i, d) { const s = state.project.slides; const j = i + d; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; saveAndRender(); }
function openSlide(i) { openSlideEditor(i); }

export function saveAndRender() { renderDeck(); saveProject(); }

export async function saveProject() {
  if (!state.project) return;
  try { state.project = await api.send("PUT", "/api/projects", state.project); }
  catch (e) { toast("Не сохранилось: " + e.message, true); }
}

async function refreshProjects() { state.projects = await api.get("/api/projects/").catch(() => state.projects); }
async function loadProject(id) { try { setProject(await api.get("/api/projects/" + id)); } catch {} }

// ---------- settings ----------
const PRESETS = {
  "Ollama": { provider: "openai", base_url: "http://localhost:11434/v1", model: "llama3.1", api_key: "" },
  "LM Studio": { provider: "openai", base_url: "http://localhost:1234/v1", model: "local-model", api_key: "" },
  "llama.cpp": { provider: "openai", base_url: "http://localhost:8080/v1", model: "local", api_key: "" },
  "OpenRouter": { provider: "openai", base_url: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.1-70b-instruct", api_key: "" },
  "DeepSeek": { provider: "openai", base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", api_key: "" },
  "Groq": { provider: "openai", base_url: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", api_key: "" },
  "Anthropic": { provider: "anthropic", base_url: "", model: "claude-opus-4-8", api_key: "" },
};

function renderSettings() {
  const s = state.settings, l = s.llm;
  $("#setProvider").value = l.provider; $("#setBaseUrl").value = l.base_url; $("#setModel").value = l.model;
  $("#setApiKey").value = l.api_key || ""; $("#setTemp").value = l.temperature; $("#setJson").checked = l.json_mode !== false;
  $("#setInstr").value = s.instructions || ""; $("#setLang").value = s.language || "Russian"; $("#setHandle").value = s.handle || "";
  const box = $("#presets"); box.innerHTML = "<span class='muted' style='align-self:center'>Пресеты:</span>";
  for (const name of Object.keys(PRESETS)) {
    const b = document.createElement("button"); b.className = "btn sm"; b.textContent = name;
    b.onclick = () => { Object.assign(PRESETS[name]); const p = PRESETS[name];
      $("#setProvider").value = p.provider; $("#setBaseUrl").value = p.base_url; $("#setModel").value = p.model; $("#setApiKey").value = p.api_key; };
    box.appendChild(b);
  }
  $("#testBtn").onclick = testLlm;
  $("#saveSetBtn").onclick = saveSettings;
}

function readSettings() {
  return {
    ...state.settings,
    llm: { provider: $("#setProvider").value, base_url: $("#setBaseUrl").value.trim(), model: $("#setModel").value.trim(),
      api_key: $("#setApiKey").value, temperature: Number($("#setTemp").value) || 0.9, json_mode: $("#setJson").checked },
    instructions: $("#setInstr").value, language: $("#setLang").value.trim() || "Russian", handle: $("#setHandle").value.trim(),
  };
}

async function testLlm() {
  const r = $("#testResult"); r.textContent = "Проверяю…"; r.className = "test-result";
  try {
    const res = await api.send("POST", "/api/llm/test", readSettings().llm);
    r.textContent = res.ok ? "✓ " + res.reply : "✕ " + res.error;
    r.className = "test-result " + (res.ok ? "ok" : "err");
  } catch (e) { r.textContent = "✕ " + e.message; r.className = "test-result err"; }
}

async function saveSettings() {
  state.settings = await api.send("PUT", "/api/settings", readSettings());
  updateBadge(); fillStyleSelect();
  toast("Настройки сохранены");
}

// ---------- styles view ----------
let selStyle = null;
function renderStyleGallery() {
  selStyle = selStyle || state.styles[0]?.id;
  const g = $("#styleGallery"); g.replaceChildren();
  const sample = { layout: "text", kicker: "guide", title: "HEIGHTMAXXING", subtitle: "How do it right",
    bullets: ["{r:wear} 3 pairs of socks", "stand next to {g:shorter} friends", "photos from the floor"],
    images: [{ wojak: "crying" }] };
  for (const st of state.styles) {
    const tile = document.createElement("div"); tile.className = "style-tile" + (st.id === selStyle ? " sel" : "");
    const thumb = document.createElement("div"); thumb.className = "thumb";
    tile.innerHTML = `<div class="meta"><b>${st.name}</b><small>${st.description || ""}</small></div>`;
    tile.prepend(thumb);
    if (!st.builtin) thumb.insertAdjacentHTML("beforeend", `<span class="tag">мой</span>`);
    requestAnimationFrame(() => { const s = { ...sample }; if (st.id === "ixe-cover") s.layout = "cover"; mountScaled(thumb, s, st, { scale: 210 / (st.size?.[0] || 1080) }); });
    tile.onclick = () => { selStyle = st.id; renderStyleGallery(); renderStyleEditor(st.id); };
    g.appendChild(tile);
  }
  renderStyleEditor(selStyle);
}

async function renderStyleEditor(id) {
  const { buildStyleEditor } = await import("/static/styleedit.js");
  buildStyleEditor($("#styleEditor"), styleById(id));
}

// ---------- projects view ----------
function renderProjects() {
  const g = $("#projectsGrid"); g.replaceChildren();
  if (!state.projects.length) { g.innerHTML = "<p class='muted'>Пока нет проектов.</p>"; return; }
  for (const meta of state.projects) {
    const tile = document.createElement("div"); tile.className = "proj-tile";
    const thumb = document.createElement("div"); thumb.className = "thumb";
    tile.appendChild(thumb);
    api.get("/api/projects/" + meta.id).then(p => {
      const st = styleById(p.style) || state.styles[0];
      requestAnimationFrame(() => mountScaled(thumb, p.slides[0], st, { scale: 230 / (st.size?.[0] || 1080), handle: state.settings.handle }));
      thumb.onclick = () => { setProject(p); $$(".tab").forEach(x => x.classList.toggle("active", x.dataset.view === "create")); $$(".view").forEach(v => v.hidden = v.id !== "view-create"); };
    });
    const meta2 = document.createElement("div"); meta2.className = "meta";
    meta2.innerHTML = `<b>${meta.name}</b><span class="muted">${meta.slides}</span>`;
    const del = document.createElement("button"); del.className = "icon-btn danger"; del.textContent = "🗑";
    del.onclick = async () => { state.projects = await api.send("DELETE", "/api/projects/" + meta.id); renderProjects(); };
    meta2.appendChild(del);
    tile.appendChild(meta2);
    g.appendChild(tile);
  }
}

export { api };
boot().catch(e => { console.error(e); toast("Ошибка загрузки: " + e.message, true); });
