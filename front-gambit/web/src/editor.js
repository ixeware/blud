// Unit workshop: build a custom piece from primitives with a gizmo, paint it, add photo textures,
// pick movement, weapon and abilities within a point budget.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { partMesh, PRIM_NAMES, TEAM_COLORS, mat } from './models.js';
import { MOVES, WEAPONS, CUSTOM_BUDGET, MAX_ACTIVES, MAX_PASSIVES, customPoints, customPrice } from './units.js';
import { ABILITIES, ACTIVE_IDS, PASSIVE_IDS, DUEL_IDS, abilityCost } from './abilities.js';
import { A, ico } from './assets.js';

const KEY = 'fg-custom';
export function loadLibrary() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
}
function saveLibrary(lib) {
  try { localStorage.setItem(KEY, JSON.stringify(lib)); return true; } catch (e) { return false; }
}

const PALETTE = ['#be4a2f', '#d77643', '#ead4aa', '#e4a672', '#b86f50', '#733e39', '#3e2731', '#a22633', '#e43b44', '#f77622', '#feae34', '#fee761',
  '#63c74d', '#3e8948', '#265c42', '#193c3e', '#124e89', '#0099db', '#2ce8f5', '#ffffff', '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
  '#262b44', '#181425', '#ff0044', '#68386c', '#b55088', '#f6757a', '#e8b796', '#c28569'];

function starter() {
  return {
    id: 'c' + Date.now().toString(36), name: '', move: 'king', hp: 140, weapon: 'rifle', air: false, vehicle: false,
    actives: ['dig'], passives: [], duel: 'd_grenade', textures: [],
    parts: [
      { g: 'box', p: [0, 0.9, 0], r: [0, 0, 0], s: [0.5, 0.8, 0.7], c: '#3e8948', team: true },
      { g: 'sphere', p: [0, 1.55, 0], r: [0, 0, 0], s: [0.45, 0.45, 0.45], c: '#e8b796' },
      { g: 'sphere', p: [0, 1.68, 0], r: [0, 0, 0], s: [0.55, 0.3, 0.55], c: '#265c42' },
      { g: 'box', p: [0, 0.3, 0.17], r: [0, 0, 0], s: [0.22, 0.6, 0.22], c: '#193c3e' },
      { g: 'box', p: [0, 0.3, -0.17], r: [0, 0, 0], s: [0.22, 0.6, 0.22], c: '#193c3e' },
      { g: 'cylinder', p: [0.45, 1.0, 0.25], r: [0, 0, Math.PI / 2], s: [0.12, 0.9, 0.12], c: '#262b44' },
    ],
  };
}

export class Workshop {
  constructor(renderer, opts) {
    this.renderer = renderer;
    this.opts = opts;
    this.active = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1c2130);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
    this.camera.position.set(3.2, 2.6, 3.6);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.2));
    const d = new THREE.DirectionalLight(0xffffff, 1.6);
    d.position.set(3, 6, 4);
    this.scene.add(d);
    const grid = new THREE.GridHelper(6, 24, 0x5a6988, 0x3a4466);
    this.scene.add(grid);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.7, 0.08, 32), mat(0x3a4466));
    disc.position.y = -0.04;
    this.scene.add(disc);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.orbit = new OrbitControls(this.camera, renderer.domElement);
    this.orbit.target.set(0, 1, 0);
    this.orbit.enabled = false;
    this.gizmo = new TransformControls(this.camera, renderer.domElement);
    this.gizmo.setSize(1.2);
    this.gizmo.enabled = false;
    this.gizmo.addEventListener('dragging-changed', (e) => { this.orbit.enabled = !e.value; });
    this.gizmo.addEventListener('objectChange', () => this.syncFromMesh());
    this.scene.add(this.gizmo.getHelper ? this.gizmo.getHelper() : this.gizmo);
    this.sel = -1;
    this.tab = 'paint';
    this.bindDom();
    window.onPhotoPicked = (url) => this.applyPhoto(url);
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  $(id) { return document.getElementById(id); }

  bindDom() {
    const $ = (id) => this.$(id);
    $('wsPrims').innerHTML = '';
    for (const [g, name] of Object.entries(PRIM_NAMES)) {
      const b = document.createElement('button');
      b.className = 'btn ghost';
      b.textContent = name;
      b.onclick = () => this.addPart(g);
      $('wsPrims').appendChild(b);
    }
    const mode = (m, id) => { this.gizmo.setMode(m); ['wsMove', 'wsRot', 'wsScale'].forEach((x) => $(x).classList.toggle('on', x === id)); this.opts.sfx('click'); };
    $('wsMove').onclick = () => mode('translate', 'wsMove');
    $('wsRot').onclick = () => mode('rotate', 'wsRot');
    $('wsScale').onclick = () => mode('scale', 'wsScale');
    $('wsDup').onclick = () => { if (this.sel < 0) return; const p = JSON.parse(JSON.stringify(this.def.parts[this.sel])); p.p[0] += 0.2; this.def.parts.push(p); this.rebuild(this.def.parts.length - 1); };
    $('wsDel').onclick = () => { if (this.sel < 0) return; this.def.parts.splice(this.sel, 1); this.rebuild(-1); };
    $('wsBack').onclick = () => this.close();
    $('wsSave').onclick = () => this.save();
    $('wsName').oninput = () => { this.def.name = $('wsName').value; this.updatePoints(); };
    $('wsFile').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => this.applyPhoto(r.result);
      r.readAsDataURL(f);
      e.target.value = '';
    };
    // tap to select parts
    let down = null;
    this.renderer.domElement.addEventListener('pointerdown', (e) => { if (this.active) down = { x: e.clientX, y: e.clientY }; });
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (!this.active || !down || this.gizmo.dragging) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), this.camera);
      const hit = ray.intersectObjects(this.root.children, false)[0];
      if (hit) this.select(this.root.children.indexOf(hit.object));
    });
  }

  open(def) {
    this.active = true;
    this.def = def ? JSON.parse(JSON.stringify(def)) : starter();
    this.$('wsName').value = this.def.name;
    this.$('workshop').classList.remove('hidden');
    this.orbit.enabled = true;
    this.gizmo.enabled = true;
    this.gizmo.setMode('translate');
    this.$('wsMove').classList.add('on');
    this.rebuild(0);
    this.renderTabs();
  }

  close() {
    this.active = false;
    this.orbit.enabled = false;
    this.gizmo.enabled = false;
    this.gizmo.detach();
    this.$('workshop').classList.add('hidden');
    this.opts.onClose();
  }

  addPart(g) {
    this.def.parts.push({ g, p: [0, 1, 0], r: [0, 0, 0], s: [0.5, 0.5, 0.5], c: '#8b9bb4' });
    this.opts.sfx('build');
    this.rebuild(this.def.parts.length - 1);
  }

  rebuild(sel = this.sel) {
    this.gizmo.detach();
    this.root.clear();
    this.def.parts.forEach((part) => this.root.add(partMesh(part, this.def, 'w')));
    this.select(Math.min(sel, this.def.parts.length - 1));
    this.updatePoints();
  }

  select(i) {
    this.sel = i;
    if (i >= 0 && this.root.children[i]) this.gizmo.attach(this.root.children[i]); else this.gizmo.detach();
    const list = this.$('wsParts');
    list.innerHTML = '';
    this.def.parts.forEach((p, k) => {
      const d = document.createElement('div');
      d.className = k === i ? 'on' : '';
      d.innerHTML = `<span style="display:inline-block;width:12px;height:12px;background:${p.team ? TEAM_COLORS.w.css : p.c};border:2px solid #141810;margin-right:4px"></span>${PRIM_NAMES[p.g]} ${k + 1}${p.tex !== undefined && p.tex !== null ? ' · фото' : ''}`;
      d.onclick = () => this.select(k);
      list.appendChild(d);
    });
    if (this.tab === 'paint') this.renderBody();
  }

  syncFromMesh() {
    const m = this.root.children[this.sel];
    if (!m) return;
    const p = this.def.parts[this.sel];
    p.p = m.position.toArray().map((v) => +v.toFixed(3));
    p.r = [m.rotation.x, m.rotation.y, m.rotation.z].map((v) => +v.toFixed(3));
    p.s = m.scale.toArray().map((v) => +Math.max(0.02, v).toFixed(3));
  }

  applyPhoto(url) {
    if (!url || this.sel < 0) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      const s = Math.min(img.width, img.height);
      g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128);
      const data = c.toDataURL('image/jpeg', 0.8);
      this.def.textures.push(data);
      this.def.parts[this.sel].tex = this.def.textures.length - 1;
      this.opts.sfx('build');
      this.rebuild(this.sel);
    };
    img.src = url;
  }

  renderTabs() {
    const tabs = [['paint', 'Окраска'], ['stats', 'Боец'], ['abil', 'Способности'], ['lib', 'Ангар']];
    const el = this.$('wsTabs');
    el.innerHTML = '';
    for (const [id, name] of tabs) {
      const b = document.createElement('button');
      b.className = 'btn ghost' + (this.tab === id ? ' on' : '');
      b.textContent = name;
      b.onclick = () => { this.tab = id; this.opts.sfx('click'); this.renderTabs(); };
      el.appendChild(b);
    }
    this.renderBody();
  }

  renderBody() {
    const body = this.$('wsBody');
    const d = this.def;
    body.innerHTML = '';
    const add = (html) => { const w = document.createElement('div'); w.innerHTML = html; body.appendChild(w); return w; };
    if (this.tab === 'paint') {
      const part = d.parts[this.sel];
      if (!part) { add('<p class="muted">Выберите деталь касанием или в списке.</p>'); return; }
      const pal = add('<label>Цвет детали</label><div class="palette"></div>').querySelector('.palette');
      for (const c of PALETTE) {
        const b = document.createElement('button');
        b.style.background = c;
        b.className = part.c === c && !part.team ? 'on' : '';
        b.onclick = () => { part.c = c; part.team = false; this.rebuild(this.sel); };
        pal.appendChild(b);
      }
      const custom = add(`<label>Свой цвет <input type="color" value="${part.c || '#888888'}"></label>`).querySelector('input');
      custom.oninput = () => { part.c = custom.value; part.team = false; this.rebuild(this.sel); };
      const team = add(`<label class="row"><input type="checkbox" ${part.team ? 'checked' : ''}> Цвет стороны (синий/красный)</label>`).querySelector('input');
      team.onchange = () => { part.team = team.checked; this.rebuild(this.sel); };
      const photo = add(`<label>Текстура из фото</label><div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn small" data-a="cam">${ico(A.icon('camera'))}Камера</button>
        <button class="btn small" data-a="gal">${ico(A.icon('image'))}Галерея</button>
        <button class="btn small red" data-a="del">${ico(A.icon('trash'))}Убрать</button></div>`);
      photo.querySelector('[data-a=cam]').onclick = () => this.pickPhoto(true);
      photo.querySelector('[data-a=gal]').onclick = () => this.pickPhoto(false);
      photo.querySelector('[data-a=del]').onclick = () => { delete part.tex; this.rebuild(this.sel); };
      add('<p class="muted">Двигайте деталь гизмо: стрелки — перемещение, кольца — поворот, кубики — размер. Вращайте камеру пальцем по пустому месту.</p>');
    } else if (this.tab === 'stats') {
      add(`<label>Как ходит</label><div class="moves">${Object.entries(MOVES).map(([k, m]) => `<button data-m="${k}" class="${d.move === k ? 'on' : ''}">${m.name} · ${m.cost}</button>`).join('')}</div>`)
        .querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => { d.move = b.dataset.m; this.renderBody(); this.updatePoints(); }; });
      const hp = add(`<label>Здоровье: <b>${d.hp}</b><input type="range" min="60" max="300" step="20" value="${d.hp}"></label>`).querySelector('input');
      hp.oninput = () => { d.hp = +hp.value; this.renderBody(); this.updatePoints(); };
      const w = add(`<label>Оружие в бою<select>${Object.entries(WEAPONS).map(([k, x]) => `<option value="${k}" ${d.weapon === k ? 'selected' : ''}>${x.name} · ${x.cost}</option>`).join('')}</select></label>`).querySelector('select');
      w.onchange = () => { d.weapon = w.value; this.updatePoints(); };
      const air = add(`<label class="row"><input type="checkbox" ${d.air ? 'checked' : ''}> Летает над укрытиями (3)</label>`).querySelector('input');
      air.onchange = () => { d.air = air.checked; this.updatePoints(); };
      const veh = add(`<label class="row"><input type="checkbox" ${d.vehicle ? 'checked' : ''}> Бронетехника: броня, давит укрытия (2)</label>`).querySelector('input');
      veh.onchange = () => { d.vehicle = veh.checked; this.updatePoints(); };
      add(`<label>Приём в бою</label><div class="ab-pick">${DUEL_IDS.map((id) => `<button data-d="${id}" class="${d.duel === id ? 'on' : ''}">${ico(A.ab(id))}${ABILITIES[id].name}<em>${abilityCost(id)}</em></button>`).join('')}</div>`)
        .querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => { d.duel = b.dataset.d; this.renderBody(); this.updatePoints(); }; });
    } else if (this.tab === 'abil') {
      const pick = (ids, key, max, title) => {
        const w = add(`<label>${title} (${d[key].length}/${max})</label><div class="ab-pick">${ids.map((id) => `<button data-a="${id}" class="${d[key].includes(id) ? 'on' : ''}" title="${ABILITIES[id].desc}">${ico(A.ab(id))}${ABILITIES[id].name}<em>${abilityCost(id)}</em></button>`).join('')}</div>`);
        w.querySelectorAll('[data-a]').forEach((b) => {
          b.onclick = () => {
            const id = b.dataset.a;
            const arr = d[key];
            if (arr.includes(id)) arr.splice(arr.indexOf(id), 1);
            else if (arr.length < max) arr.push(id);
            else { this.opts.sfx('error'); return; }
            this.opts.sfx('select');
            this.renderBody();
            this.updatePoints();
            this.$('wsHint') && (this.$('wsHint').textContent = `${ABILITIES[id].name}: ${ABILITIES[id].desc}`);
          };
        });
      };
      add('<p class="muted" id="wsHint">Активные способности тратят действие, пассивные работают всегда. Удерживайте палец на иконке, чтобы прочитать описание.</p>');
      pick(ACTIVE_IDS, 'actives', MAX_ACTIVES, 'Активные');
      pick(PASSIVE_IDS, 'passives', MAX_PASSIVES, 'Пассивные');
    } else if (this.tab === 'lib') {
      const lib = loadLibrary();
      const box = add('<div class="lib"></div>').firstChild;
      const nb = document.createElement('button');
      nb.className = 'btn small gold';
      nb.innerHTML = `${ico(A.icon('plus'))}Новый юнит`;
      nb.onclick = () => this.open();
      box.appendChild(nb);
      const ids = Object.keys(lib);
      if (!ids.length) box.insertAdjacentHTML('beforeend', '<p class="muted">Ангар пуст.</p>');
      for (const id of ids) {
        const u = lib[id];
        const row = document.createElement('div');
        row.innerHTML = `${u.thumb ? `<img src="${u.thumb}" width="36" height="36">` : ico(A.unit('C'))}<span>${u.name}<br><small class="muted">${u.points} очк. · цена ${customPrice(u.points)}</small></span>`;
        const ed = document.createElement('button'); ed.className = 'sq tiny'; ed.innerHTML = ico(A.icon('wrench')); ed.onclick = () => this.open(u);
        const del = document.createElement('button'); del.className = 'sq tiny'; del.innerHTML = ico(A.icon('trash'));
        del.onclick = () => { delete lib[id]; saveLibrary(lib); this.renderBody(); };
        row.append(ed, del);
        box.appendChild(row);
      }
    }
  }

  pickPhoto(camera) {
    if (window.AndroidBridge && window.AndroidBridge.pickPhoto) window.AndroidBridge.pickPhoto(!!camera);
    else {
      const f = this.$('wsFile');
      if (camera) f.setAttribute('capture', 'environment'); else f.removeAttribute('capture');
      f.click();
    }
  }

  points() { return customPoints(this.def, abilityCost); }

  updatePoints() {
    const p = this.points();
    const el = this.$('wsPoints');
    el.textContent = `Очки ${p}/${CUSTOM_BUDGET} · цена ${customPrice(p)}`;
    el.style.color = p > CUSTOM_BUDGET ? '#e43b44' : '';
  }

  thumbnail() {
    const prev = this.gizmo.object;
    this.gizmo.detach();
    const cam = new THREE.PerspectiveCamera(40, 1, 0.05, 50);
    const bb = new THREE.Box3().setFromObject(this.root);
    const c = bb.getCenter(new THREE.Vector3());
    const size = bb.getSize(new THREE.Vector3()).length();
    cam.position.set(c.x + size * 0.9, c.y + size * 0.5, c.z + size * 1.1);
    cam.lookAt(c);
    const rt = new THREE.WebGLRenderTarget(96, 96);
    this.renderer.setRenderTarget(rt);
    this.renderer.render(this.scene, cam);
    const buf = new Uint8Array(96 * 96 * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, 96, 96, buf);
    this.renderer.setRenderTarget(null);
    rt.dispose();
    const cv = document.createElement('canvas');
    cv.width = cv.height = 96;
    const g = cv.getContext('2d');
    const im = g.createImageData(96, 96);
    for (let y = 0; y < 96; y++) im.data.set(buf.subarray((95 - y) * 96 * 4, (96 - y) * 96 * 4), y * 96 * 4);
    g.putImageData(im, 0, 0);
    if (prev) this.gizmo.attach(prev);
    return cv.toDataURL('image/png');
  }

  save() {
    const d = this.def;
    d.name = (this.$('wsName').value || '').trim();
    if (!d.name) { this.toast('Дайте юниту название'); return; }
    if (!d.parts.length) { this.toast('Добавьте хотя бы одну деталь'); return; }
    const p = this.points();
    if (p > CUSTOM_BUDGET) { this.toast(`Перебор очков: ${p}/${CUSTOM_BUDGET}`); return; }
    if (!d.actives.length && !d.passives.length) { this.toast('Выберите хотя бы одну способность'); return; }
    d.points = p;
    d.thumb = this.thumbnail();
    const lib = loadLibrary();
    lib[d.id] = d;
    if (!saveLibrary(lib)) { this.toast('Не хватает памяти: уберите фото-текстуры'); return; }
    this.opts.sfx('rank');
    this.toast(`«${d.name}» сохранён — ищите в Штабе, вкладка «Особые»`);
  }

  toast(msg) {
    const t = this.$('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(this.tm);
    this.tm = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  update() {
    this.orbit.update();
  }
}
