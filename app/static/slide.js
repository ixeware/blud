// Slide renderer shared by the editor preview, thumbnails, style gallery and PNG export.
const MARKS = {
  check: `<svg viewBox="0 0 100 100" class="mark"><path d="M8 52 L38 80 L94 14" fill="none" stroke="#2fd14b" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" opacity=".92"/></svg>`,
  cross: `<svg viewBox="0 0 100 100" class="mark"><path d="M12 12 L88 88 M88 12 L12 88" fill="none" stroke="#ff3b3b" stroke-width="12" stroke-linecap="round" opacity=".85"/></svg>`,
};

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// {r:red} {g:green} {b:blue} **bold**
export function rich(s) {
  return esc(s)
    .replace(/\{([rgb]):([^}]*)\}/g, (_, c, t) => `<span class="hl-${c}">${t}</span>`)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
}

// Prefix every selector of a style's custom CSS with the slide scope class.
// Handles @media/@supports (prefix inside) and @keyframes/@font-face (left as is).
export function scopeCss(css, scope) {
  if (!css) return "";
  const prefix = sel => sel.split(",").map(x => {
    x = x.trim();
    if (!x) return x;
    return x.includes(".slide") ? x.replaceAll(".slide", `.slide.${scope}`) : `.slide.${scope} ${x}`;
  }).join(", ");
  let out = "", buf = "";
  const stack = [];
  for (const ch of css.replace(/\/\*[^]*?\*\//g, "")) {
    if (ch === "{") {
      const head = buf.trim();
      const inRaw = stack.includes("raw");
      let kind;
      if (inRaw) kind = "raw";
      else if (/^@(media|supports|container)/.test(head)) kind = "group";
      else if (head.startsWith("@")) kind = "raw";
      else kind = "rule";
      out += (kind === "rule" ? prefix(head) : head) + "{";
      stack.push(kind);
      buf = "";
    } else if (ch === "}") {
      out += buf + "}";
      buf = "";
      stack.pop();
    } else buf += ch;
  }
  return out + buf;
}

let styleSeq = 0;
const injected = new Map(); // style id+hash -> class

export function styleClass(style) {
  const key = style.id + "|" + (style.css || "");
  if (injected.has(key)) return injected.get(key);
  const cls = "st" + (++styleSeq);
  injected.set(key, cls);
  if (style.css) {
    const el = document.createElement("style");
    el.textContent = scopeCss(style.css, cls);
    document.head.appendChild(el);
  }
  return cls;
}

function imgHtml(img, extra = "") {
  if (!img || !img.src) return "";
  const mark = img.mark && MARKS[img.mark] ? MARKS[img.mark] : "";
  const label = img.label ? `<div class="label">${rich(img.label)}</div>` : "";
  return `<div class="img${img.card ? " card" : ""}" ${extra}>${label}<img src="${esc(img.src)}" crossorigin="anonymous" alt="">${mark}</div>`;
}

export function slideHtml(slide, opts = {}) {
  const s = slide || {};
  const parts = [];
  if (s.kicker) parts.push(`<div class="kicker">${rich(s.kicker)}</div>`);
  if (s.title) parts.push(`<h1 class="title">${rich(s.title)}</h1>`);
  if (s.pill) parts.push(`<div class="pill">${rich(s.pill)}</div>`);
  if (s.subtitle) parts.push(`<h2 class="subtitle">${rich(s.subtitle)}</h2>`);
  if (s.body) parts.push(`<p class="body">${rich(s.body)}</p>`);
  if (s.bullets?.length) parts.push(`<ul class="bullets">${s.bullets.map(b => `<li>${rich(b)}</li>`).join("")}</ul>`);
  if (s.steps?.length) parts.push(`<ol class="steps">${s.steps.map(b => `<li>${rich(b)}</li>`).join("")}</ol>`);
  const images = s.images || [];
  if (s.layout === "items" && s.items?.length) {
    parts.push(`<div class="items">${s.items.map(it => `<div class="item">${it.image?.src ? `<div class="frame"><img src="${esc(it.image.src)}" alt=""></div>` : ""}<div class="item-text">${rich(it.text)}</div></div>`).join("")}</div>`);
  } else if (s.layout === "compare" && images.length) {
    parts.push(`<div class="compare">${images.slice(0, 2).map(i => imgHtml(i)).join("")}</div>`);
  } else if (images.length) {
    parts.push(`<div class="media">${images.slice(0, 3).map(i => imgHtml(i)).join("")}</div>`);
  }
  if (s.source) parts.push(`<div class="source">${rich(s.source)}</div>`);
  const wm = opts.handle ? `<div class="watermark">${esc(opts.handle)}</div>` : "";
  const pn = opts.pageno ? `<div class="pageno">${opts.pageno}</div>` : "";
  return `<div class="content">${parts.join("")}</div>${wm}${pn}`;
}

// Build a full-size slide element (natural size, e.g. 1080x1440).
export function renderSlide(slide, style, opts = {}) {
  style = style || { id: "none", vars: {}, texture: [] };
  const [w, h] = opts.size || style.size || [1080, 1440];
  const el = document.createElement("div");
  el.className = `slide layout-${slide?.layout || "text"} ${styleClass(style)}`;
  el.style.setProperty("--w", w + "px");
  el.style.setProperty("--h", h + "px");
  for (const [k, v] of Object.entries(style.vars || {})) if (k.startsWith("--")) el.style.setProperty(k, v);
  const tex = (style.texture || []).map(t => `<div class="tx-${esc(t)}"></div>`).join("");
  el.innerHTML = `<div class="bg">${tex}</div>` + slideHtml(slide, opts);
  return el;
}

// Render scaled into a container box (keeps the natural-size slide and transforms it).
export function mountScaled(container, slide, style, opts = {}) {
  const el = renderSlide(slide, style, opts);
  const [w, h] = opts.size || style?.size || [1080, 1440];
  const box = container.getBoundingClientRect();
  const scale = opts.scale || Math.min(box.width / w, (box.height || 1e9) / h);
  const wrap = document.createElement("div");
  wrap.className = "slide-wrap";
  wrap.style.cssText = `width:${w * scale}px;height:${h * scale}px;position:relative;overflow:hidden;flex:none`;
  el.style.transform = `scale(${scale})`;
  el.style.transformOrigin = "0 0";
  el.style.position = "absolute";
  wrap.appendChild(el);
  container.replaceChildren(wrap);
  return el;
}
