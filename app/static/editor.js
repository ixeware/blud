// Per-slide manual editor (modal sheet): text fields + wojak picker.
import { state, moodKeys, saveAndRender, saveProject, renderDeck, api, toast, styleById } from "/static/app.js";
import { mountScaled } from "/static/slide.js";

const LAYOUTS = [["text", "Текст"], ["cover", "Обложка"], ["items", "Список с фото"], ["compare", "Сравнение"], ["statement", "Фраза"]];

export function openSlideEditor(index) {
  const slide = state.project.slides[index];
  const backdrop = document.createElement("div"); backdrop.className = "sheet-backdrop";
  const sheet = document.createElement("div"); sheet.className = "sheet";
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  backdrop.onclick = e => { if (e.target === backdrop) close(); };
  const close = () => backdrop.remove();

  const preview = document.createElement("div"); preview.className = "preview-pane";
  const form = document.createElement("div"); form.className = "form-pane";
  const foot = document.createElement("div"); foot.className = "sheet-foot";
  sheet.append(preview, form, foot);

  const style = styleById(state.project.style) || state.styles[0];
  const draw = () => mountScaled(preview, slide, style, { scale: Math.min(360 / (style.size?.[0] || 1080), 560 / (style.size?.[1] || 1440)), handle: state.settings.handle, pageno: index + 1 });
  const rerender = () => { draw(); };

  const field = (label, value, oninput, rows = 0) => {
    const f = document.createElement("label"); f.className = "field";
    f.innerHTML = `<span>${label}</span>`;
    const el = document.createElement(rows ? "textarea" : "input");
    if (rows) el.rows = rows;
    el.value = value ?? "";
    el.oninput = () => { oninput(el.value); rerender(); };
    f.appendChild(el); return f;
  };
  const listField = (label, key) => field(label + " (по строке)", (slide[key] || []).join("\n"),
    v => slide[key] = v.split("\n").map(x => x.trim()).filter(Boolean), 4);

  // layout selector
  const lay = document.createElement("div"); lay.className = "field";
  lay.innerHTML = "<span>Тип слайда</span>";
  const chips = document.createElement("div"); chips.className = "chip-row";
  LAYOUTS.forEach(([v, name]) => { const c = document.createElement("span"); c.className = "chip" + (slide.layout === v ? " on" : ""); c.textContent = name;
    c.onclick = () => { slide.layout = v; [...chips.children].forEach(x => x.classList.toggle("on", x === c)); buildBody(); rerender(); }; chips.appendChild(c); });
  lay.appendChild(chips);

  form.append(
    lay,
    field("Надпись сверху (kicker)", slide.kicker, v => slide.kicker = v),
    field("Заголовок", slide.title, v => slide.title = v),
    field("Капсула (pill)", slide.pill, v => slide.pill = v),
    field("Подзаголовок", slide.subtitle, v => slide.subtitle = v),
  );
  const bodyWrap = document.createElement("div"); bodyWrap.style.display = "contents"; form.appendChild(bodyWrap);
  function buildBody() {
    bodyWrap.replaceChildren();
    if (slide.layout === "items") {
      bodyWrap.appendChild(itemsEditor(slide, rerender));
    } else {
      bodyWrap.append(
        field("Текст (body)", slide.body, v => slide.body = v, 3),
        listField("Пункты", "bullets"),
        listField("Шаги (нумерованные)", "steps"),
      );
    }
    bodyWrap.append(field("Сноска (source)", slide.source, v => slide.source = v), imagesEditor(slide, rerender));
  }
  buildBody();

  const cancel = document.createElement("button"); cancel.className = "btn ghost"; cancel.textContent = "Закрыть"; cancel.onclick = close;
  const save = document.createElement("button"); save.className = "btn primary"; save.textContent = "Сохранить слайд";
  save.onclick = () => { close(); saveAndRender(); };
  foot.append(cancel, save);
  requestAnimationFrame(draw);
}

function imageRow(img, onchange, onremove) {
  const row = document.createElement("div"); row.className = "img-edit";
  const im = document.createElement("img"); im.src = img.src || ""; row.appendChild(im);
  const moodSel = document.createElement("select"); moodSel.style.flex = "1";
  moodSel.innerHTML = moodKeys().map(m => `<option ${img.wojak === m ? "selected" : ""}>${m}</option>`).join("");
  const reroll = document.createElement("button"); reroll.className = "icon-btn"; reroll.title = "Другой вояк"; reroll.textContent = "🎲";
  reroll.onclick = async () => { const r = await api.get(`/api/wojak?mood=${encodeURIComponent(moodSel.value)}&avoid=${encodeURIComponent(img.src || "")}`); Object.assign(img, r); im.src = img.src; onchange(); };
  moodSel.onchange = async () => { img.wojak = moodSel.value; const r = await api.get(`/api/wojak?mood=${encodeURIComponent(moodSel.value)}`); Object.assign(img, r); im.src = img.src; onchange(); };
  row.append(moodSel, reroll);
  if (onremove) { const del = document.createElement("button"); del.className = "icon-btn danger"; del.textContent = "✕"; del.onclick = onremove; row.appendChild(del); }
  return row;
}

function imagesEditor(slide, rerender) {
  const wrap = document.createElement("div"); wrap.className = "field";
  const head = document.createElement("span"); head.innerHTML = `Картинки <button class="chip" id="addImg">＋ добавить</button>`;
  wrap.appendChild(head);
  slide.images = slide.images || [];
  const list = document.createElement("div"); list.style.display = "flex"; list.style.flexDirection = "column"; list.style.gap = "8px";
  const redraw = () => { list.replaceChildren(); slide.images.forEach((img, i) => list.appendChild(imageRow(img, rerender, () => { slide.images.splice(i, 1); redraw(); rerender(); }))); };
  redraw();
  wrap.appendChild(list);
  wrap.appendChild(uploadRow(img => { slide.images.push(img); redraw(); rerender(); }));
  head.querySelector("#addImg").onclick = async () => { const r = await api.get("/api/wojak?mood=wojak"); slide.images.push(r); redraw(); rerender(); };
  return wrap;
}

function itemsEditor(slide, rerender) {
  const wrap = document.createElement("div"); wrap.className = "field";
  const head = document.createElement("span"); head.innerHTML = `Строки списка <button class="chip" id="addRow">＋ строка</button>`;
  wrap.appendChild(head);
  slide.items = slide.items || [];
  const list = document.createElement("div"); list.style.display = "flex"; list.style.flexDirection = "column"; list.style.gap = "10px";
  const redraw = () => {
    list.replaceChildren();
    slide.items.forEach((it, i) => {
      const box = document.createElement("div"); box.style.cssText = "display:flex;flex-direction:column;gap:6px;border:1px solid var(--line);border-radius:10px;padding:8px";
      const ta = document.createElement("textarea"); ta.rows = 2; ta.value = it.text || ""; ta.oninput = () => { it.text = ta.value; rerender(); };
      it.image = it.image || { wojak: "wojak" };
      box.append(ta, imageRow(it.image, rerender, null));
      const del = document.createElement("button"); del.className = "chip"; del.textContent = "удалить строку"; del.onclick = () => { slide.items.splice(i, 1); redraw(); rerender(); };
      box.appendChild(del); list.appendChild(box);
    });
  };
  redraw(); wrap.appendChild(list);
  head.querySelector("#addRow").onclick = async () => { const r = await api.get("/api/wojak?mood=wojak"); slide.items.push({ text: "новый пункт", image: r }); redraw(); rerender(); };
  return wrap;
}

function uploadRow(onimg) {
  const row = document.createElement("div"); row.style.cssText = "display:flex;gap:8px;margin-top:6px";
  const file = document.createElement("input"); file.type = "file"; file.accept = "image/*"; file.style.flex = "1";
  file.onchange = async () => { if (!file.files[0]) return; const fd = new FormData(); fd.append("file", file.files[0]);
    const r = await fetch("/api/upload", { method: "POST", body: fd }); if (r.ok) onimg(await r.json()); else toast("Не загрузилось", true); };
  const url = document.createElement("input"); url.placeholder = "или вставь URL картинки"; url.style.flex = "1";
  url.onkeydown = async e => { if (e.key !== "Enter" || !url.value.trim()) return;
    try { onimg(await api.send("POST", "/api/fetch-image", { url: url.value.trim() })); url.value = ""; } catch (err) { toast(err.message, true); } };
  row.append(file, url); return row;
}
