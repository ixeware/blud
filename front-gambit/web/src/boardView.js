// 3D strategic board view (top-down tilted camera).
import * as THREE from 'three';
import { TILE, sqToWorld, worldToSq } from './rng.js';
import { unitModel, makeTree, makeFactory, makeDrone, TEAM_COLORS, mat } from './models.js';
import { FX } from './fx.js';
import { UNITS, territory, supplyMap, rc } from './rules.js';

const HL_COLORS = {
  move: 0x4cff6a, capture: 0xff3b30, rail: 0x3fb6ff, ability: 0xffc93c, target: 0xffc93c, select: 0xffffff, last: 0xffe9a0,
};

export class BoardView {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9cc3d9);
    this.scene.fog = new THREE.Fog(0x9cc3d9, 70, 140);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
    this.fx = new FX(this.scene);
    this.viewSide = 'w';
    this.camTarget = new THREE.Vector3(0, 0, 1);
    this.camDist = 48;
    this.camAz = 0;
    this.camPitch = 0.95;
    this.pieceMeshes = new Map();
    this.highlights = [];
    this.lastFx = 0;
    this.time = 0;
    this.droneSnap = null;
    this.build();
  }

  build() {
    const s = this.scene;
    const hemi = new THREE.HemisphereLight(0xdfefff, 0x5a5040, 1.1);
    s.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
    sun.position.set(20, 40, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 100;
    s.add(sun);
    this.sun = sun;

    // ground
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), mat(0x58703c));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.4;
    ground.receiveShadow = true;
    s.add(ground);
    // board base
    const base = new THREE.Mesh(new THREE.BoxGeometry(8 * TILE + 1.2, 0.8, 8 * TILE + 1.2), mat(0x3d3a32));
    base.position.y = -0.2;
    base.receiveShadow = true;
    s.add(base);
    // tiles
    const tg = new THREE.BoxGeometry(TILE * 0.98, 0.3, TILE * 0.98);
    this.tiles = new THREE.InstancedMesh(tg, new THREE.MeshLambertMaterial({ color: 0xffffff }), 64);
    this.tiles.receiveShadow = true;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 64; i++) {
      const w = sqToWorld(i);
      dummy.position.set(w.x, 0.15, w.z);
      dummy.updateMatrix();
      this.tiles.setMatrixAt(i, dummy.matrix);
      this.tiles.setColorAt(i, new THREE.Color(0xffffff));
    }
    s.add(this.tiles);
    // highlight planes
    const hg = new THREE.PlaneGeometry(TILE * 0.92, TILE * 0.92);
    this.hlMeshes = [];
    for (let i = 0; i < 64; i++) {
      const m = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false }));
      const w = sqToWorld(i);
      m.rotation.x = -Math.PI / 2;
      m.position.set(w.x, 0.33, w.z);
      m.visible = false;
      s.add(m);
      this.hlMeshes.push(m);
    }
    // coordinates labels
    for (let c = 0; c < 8; c++) {
      for (const [r, zOff] of [[0, 1], [7, -1]]) {
        const w = sqToWorld(r * 8 + c);
        const sp = this.labelSprite('abcdefgh'[c]);
        sp.position.set(w.x, 0.3, w.z + zOff * (TILE / 2 + 0.45));
        s.add(sp);
      }
    }
    for (let r = 0; r < 8; r++) {
      const w = sqToWorld(r * 8);
      const sp = this.labelSprite(String(r + 1));
      sp.position.set(w.x - TILE / 2 - 0.45, 0.3, w.z);
      s.add(sp);
      const sp2 = this.labelSprite(String(r + 1));
      sp2.position.set(-w.x + TILE / 2 + 0.45, 0.3, w.z);
      s.add(sp2);
    }
    // trees around
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 26 + Math.random() * 40;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(z) > 16 && Math.abs(z) < 30 && Math.abs(x) < 26) continue; // rear zones
      const t = makeTree(0.9 + Math.random() * 1.2);
      t.position.set(x, -0.4, z);
      s.add(t);
    }
    // rear zones (factories + supply railway)
    this.factoryGroups = { w: new THREE.Group(), b: new THREE.Group() };
    for (const side of ['w', 'b']) {
      const dir = side === 'w' ? 1 : -1;
      const zone = new THREE.Mesh(new THREE.PlaneGeometry(52, 12), mat(0x6d6a55));
      zone.rotation.x = -Math.PI / 2;
      zone.position.set(0, -0.38, dir * 23.5);
      zone.receiveShadow = true;
      s.add(zone);
      // main supply line along the rear
      this.trackLine(-24, dir * 18.5, 24, dir * 18.5, -0.35);
      s.add(this.factoryGroups[side]);
    }
    this.factoryMeshes = { w: [], b: [] };
    this.railGroup = new THREE.Group();
    s.add(this.railGroup);
    this.frontGroup = new THREE.Group();
    s.add(this.frontGroup);
    this.mineGroup = new THREE.Group();
    s.add(this.mineGroup);
    this.trains = [];
  }

  labelSprite(txt) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.font = 'bold 40px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(txt, 32, 34);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false }));
    sp.scale.set(0.9, 0.9, 1);
    return sp;
  }

  trackLine(x1, z1, x2, z2, y = 0.31, parent = this.scene) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const g = new THREE.Group();
    const ang = Math.atan2(z2 - z1, x2 - x1);
    for (const off of [-0.35, 0.35]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.08), mat(0x8a8a8a));
      rail.position.set(0, 0.1, off);
      g.add(rail);
    }
    const n = Math.max(1, Math.floor(len / 0.6));
    for (let i = 0; i < n; i++) {
      const sl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 1.1), mat(0x5a3d22));
      sl.position.set(-len / 2 + (i + 0.5) * (len / n), 0.03, 0);
      g.add(sl);
    }
    g.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
    g.rotation.y = -ang;
    parent.add(g);
    return g;
  }

  setViewSide(side) {
    this.viewSide = side;
    this.camAz = side === 'w' ? 0 : Math.PI;
    this.camTarget.set(0, 0, side === 'w' ? 1 : -1);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // fit board on narrow screens
    const fit = w / h < 1.2 ? 64 : 48;
    if (!this.userZoomed) this.camDist = fit;
  }

  updateCamera() {
    if (this.droneSnap) {
      const d = this.droneSnap;
      const fx = Math.cos(d.yaw), fz = Math.sin(d.yaw);
      this.camera.fov = 80;
      this.camera.updateProjectionMatrix();
      this.camera.position.set(d.x - fx * 2.6, d.y + 0.9, d.z - fz * 2.6);
      this.camera.lookAt(d.x + fx * 6, d.y - 0.6 - d.pitch * 6, d.z + fz * 6);
      this.camera.rotateZ(-d.roll * 0.8);
      return;
    }
    if (this.camera.fov !== 45) { this.camera.fov = 45; this.camera.updateProjectionMatrix(); }
    const t = this.camTarget;
    const h = Math.sin(this.camPitch) * this.camDist;
    const back = Math.cos(this.camPitch) * this.camDist;
    this.camera.position.set(t.x + Math.sin(this.camAz) * back, h, t.z + Math.cos(this.camAz) * back);
    this.camera.lookAt(t);
  }

  pan(dx, dy) {
    const k = this.camDist / 600;
    const ca = Math.cos(this.camAz), sa = Math.sin(this.camAz);
    this.camTarget.x -= (dx * ca + dy * sa) * k;
    this.camTarget.z -= (-dx * sa + dy * ca) * k;
    this.camTarget.x = Math.max(-20, Math.min(20, this.camTarget.x));
    this.camTarget.z = Math.max(-22, Math.min(22, this.camTarget.z));
  }

  zoom(f) {
    this.userZoomed = true;
    this.camDist = Math.max(16, Math.min(85, this.camDist * f));
  }

  rotate(d) { this.camAz += d; }

  pick(ndcX, ndcY) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const objs = [];
    for (const [, e] of this.pieceMeshes) objs.push(e.group);
    const hits = ray.intersectObjects(objs, true);
    if (hits.length) {
      let o = hits[0].object;
      while (o && !o.userData.sq && o.userData.sq !== 0) o = o.parent;
      if (o) return o.userData.sq;
    }
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.3);
    const p = new THREE.Vector3();
    if (ray.ray.intersectPlane(plane, p)) return worldToSq(p.x, p.z);
    return -1;
  }

  setHighlights(list) {
    // list: [{sq, kind}]
    for (const m of this.hlMeshes) m.visible = false;
    for (const h of list) {
      const m = this.hlMeshes[h.sq];
      m.visible = true;
      m.material.color.setHex(HL_COLORS[h.kind] || 0xffffff);
      m.material.opacity = h.kind === 'select' ? 0.55 : h.kind === 'last' ? 0.25 : 0.42;
      m.userData.kind = h.kind;
    }
  }

  statusSprite(entry, p, supplied) {
    const key = `${p.hp}|${p.maxHp}|${p.stun}|${p.dug}|${supplied}|${p.cd}|${p.t}`;
    if (entry.statusKey === key) return;
    entry.statusKey = key;
    const c = entry.canvas || (entry.canvas = document.createElement('canvas'));
    c.width = 128; c.height = 64;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 128, 64);
    const col = TEAM_COLORS[p.s].hex;
    // glyph badge
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.beginPath(); g.arc(22, 26, 20, 0, Math.PI * 2); g.fill();
    g.fillStyle = col;
    g.font = 'bold 30px serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(UNITS[p.t].glyph, 22, 28);
    // hp bar
    const f = Math.max(0, p.hp / p.maxHp);
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(46, 18, 78, 14);
    g.fillStyle = f > 0.6 ? '#5ce65c' : f > 0.3 ? '#f2c94c' : '#ff4d4d';
    g.fillRect(48, 20, 74 * f, 10);
    let x = 48;
    g.font = '18px sans-serif';
    g.textAlign = 'left';
    if (!supplied) { g.fillText('⛔', x, 48); x += 22; }
    if (p.stun > 0) { g.fillText('💫', x, 48); x += 22; }
    if (p.dug) { g.fillText('🛡', x, 48); x += 22; }
    if (p.cd > 0) { g.fillStyle = '#ddd'; g.font = 'bold 16px sans-serif'; g.fillText('⏳' + p.cd, x, 48); }
    if (!entry.sprite) {
      entry.tex = new THREE.CanvasTexture(c);
      entry.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: entry.tex, depthTest: false, transparent: true }));
      entry.sprite.scale.set(3, 1.5, 1);
      entry.sprite.renderOrder = 5;
      entry.group.add(entry.sprite);
    } else entry.tex.needsUpdate = true;
    entry.sprite.position.y = p.t === 'Q' ? 4.6 : p.t === 'K' ? 4.0 : p.t === 'R' ? 3.0 : 3.0;
  }

  sync(state, viewer) {
    this.state = state;
    const terr = territory(state);
    const sup = supplyMap(state, terr);
    // tile colors
    const col = new THREE.Color();
    for (let i = 0; i < 64; i++) {
      const [r, c] = rc(i);
      col.setHex((r + c) % 2 ? 0x8d9a62 : 0x6f7d4a);
      if (terr[i]) col.lerp(new THREE.Color(TEAM_COLORS[terr[i]].main), 0.28);
      this.tiles.setColorAt(i, col);
    }
    this.tiles.instanceColor.needsUpdate = true;
    // pieces
    const seen = new Set();
    state.board.forEach((p, i) => {
      if (!p) return;
      seen.add(p.id);
      let e = this.pieceMeshes.get(p.id);
      const w = sqToWorld(i);
      if (!e || e.t !== p.t) {
        if (e) this.scene.remove(e.group);
        const group = new THREE.Group();
        const model = unitModel(p.t, p.s, 'board');
        const scale = p.t === 'R' ? 0.95 : p.t === 'Q' ? 0.85 : p.t === 'K' ? 1 : 1.45;
        model.scale.setScalar(scale);
        group.add(model);
        // team base disc
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.08, 20), mat(TEAM_COLORS[p.s].main));
        disc.position.y = 0.32;
        group.add(disc);
        const sandbags = new THREE.Group();
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const b = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 5), mat(0xa39468));
          b.scale.set(1, 0.5, 0.7);
          b.position.set(Math.cos(a) * 1.55, 0.45, Math.sin(a) * 1.55);
          b.rotation.y = -a + Math.PI / 2;
          sandbags.add(b);
        }
        sandbags.visible = false;
        group.add(sandbags);
        model.position.y = 0.32;
        group.position.set(w.x, 0, w.z);
        const face = p.s === 'w' ? Math.PI / 2 : -Math.PI / 2; // face enemy
        model.rotation.y = face;
        group.userData.sq = i;
        this.scene.add(group);
        e = { group, model, t: p.t, sandbags, face };
        this.pieceMeshes.set(p.id, e);
        if (p.t !== 'K') model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      }
      e.group.userData.sq = i;
      e.target = new THREE.Vector3(w.x, 0, w.z);
      e.sandbags.visible = !!p.dug;
      this.statusSprite(e, p, sup[p.s][i]);
    });
    for (const [id, e] of this.pieceMeshes) {
      if (!seen.has(id)) { this.scene.remove(e.group); this.pieceMeshes.delete(id); }
    }
    // factories
    for (const side of ['w', 'b']) {
      const list = this.factoryMeshes[side];
      while (list.length < state.factories[side]) {
        const f = makeFactory(side);
        const k = list.length;
        const dir = side === 'w' ? 1 : -1;
        f.position.set(-15 + k * 10, -0.38, dir * 24);
        if (side === 'b') f.rotation.y = Math.PI;
        this.factoryGroups[side].add(f);
        list.push(f);
        // spur track toward main line
        const tr = this.trackLine(f.position.x + 3, dir * 22, f.position.x + 3, dir * 18.5, -0.35, this.factoryGroups[side]);
        f.userData.track = tr;
      }
      while (list.length > state.factories[side]) {
        const f = list.pop();
        this.factoryGroups[side].remove(f);
        this.factoryGroups[side].remove(f.userData.track);
      }
    }
    // rails
    const railKey = state.rails.join(',');
    if (railKey !== this.railKey) {
      this.railKey = railKey;
      this.railGroup.clear();
      for (let i = 0; i < 64; i++) {
        const o = state.rails[i];
        if (!o) continue;
        const w = sqToWorld(i);
        const [r, c] = rc(i);
        let any = false;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nr = r + dr, nc = c + dc;
          const homeEdge = (o === 'w' && nr === -1) || (o === 'b' && nr === 8);
          if (!homeEdge && (nr < 0 || nr > 7 || nc < 0 || nc > 7)) continue;
          if (!homeEdge && state.rails[nr * 8 + nc] !== o) continue;
          any = true;
          const ex = w.x + dc * TILE / 2, ez = w.z - dr * TILE / 2;
          this.trackLine(w.x, w.z, ex, ez, 0.31, this.railGroup);
        }
        if (!any) this.trackLine(w.x, w.z - TILE / 2.5, w.x, w.z + TILE / 2.5, 0.31, this.railGroup);
        const marker = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat(TEAM_COLORS[o].main));
        marker.position.set(w.x + TILE * 0.36, 0.55, w.z - TILE * 0.36);
        this.railGroup.add(marker);
      }
    }
    // mines (only visible to owner)
    this.mineGroup.clear();
    state.mines.forEach((o, i) => {
      if (!o || (viewer && !viewer.includes(o))) return;
      const w = sqToWorld(i);
      const mm = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.18, 10), mat(0x3a3a2a));
      mm.position.set(w.x, 0.38, w.z);
      this.mineGroup.add(mm);
      const pin = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[o].main }));
      pin.position.set(w.x, 0.52, w.z);
      this.mineGroup.add(pin);
    });
    // front line
    this.frontGroup.clear();
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9 });
    this.frontMat = lineMat;
    for (let i = 0; i < 64; i++) {
      const [r, c] = rc(i);
      const w = sqToWorld(i);
      if (c < 7) {
        const j = i + 1;
        if (terr[i] !== terr[j] && (terr[i] && terr[j] ? true : (terr[i] || terr[j]))) {
          const seg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, TILE), lineMat);
          seg.position.set(w.x + TILE / 2, 0.36, w.z);
          this.frontGroup.add(seg);
        }
      }
      if (r < 7) {
        const j = i + 8;
        if (terr[i] !== terr[j] && (terr[i] || terr[j])) {
          const seg = new THREE.Mesh(new THREE.BoxGeometry(TILE, 0.12, 0.18), lineMat);
          seg.position.set(w.x, 0.36, w.z - TILE / 2);
          this.frontGroup.add(seg);
        }
      }
    }
    // effects
    for (const e of state.fx) {
      if (e.id <= this.lastFx) continue;
      this.lastFx = e.id;
      this.playFx(e);
    }
  }

  skipFx(state) {
    for (const e of state.fx) this.lastFx = Math.max(this.lastFx, e.id);
  }

  wpos(i, y = 1) {
    const w = sqToWorld(i);
    return new THREE.Vector3(w.x, y, w.z);
  }

  playFx(e) {
    const F = this.fx;
    const S = this.onSound || (() => {});
    switch (e.k) {
      case 'boom': { const p = this.wpos(e.sq, 0.4); F.explosion(p.x, p.y, p.z, e.big ? 2.2 : 1.3); S('boom'); break; }
      case 'mine': { const p = this.wpos(e.sq, 0.4); F.explosion(p.x, p.y, p.z, 1.6); S('boom'); break; }
      case 'dmg': { const p = this.wpos(e.sq, 3.5); F.text(p.x, p.y, p.z, '-' + e.v); break; }
      case 'arty': {
        const a = this.wpos(e.from, 2), b = this.wpos(e.to, 0.4);
        S('arty');
        for (let k = 0; k < 3; k++) {
          const off = new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3);
          setTimeout(() => F.arc(a, b.clone().add(off), 14, 0.9, 0x333333, () => { F.explosion(b.x + off.x, 0.4, b.z + off.z, 1.4); S('boom'); }), k * 180);
        }
        break;
      }
      case 'shell': {
        const a = this.wpos(e.from, 1.5), b = this.wpos(e.to, 1);
        S('cannon');
        F.muzzle(a.x, a.y, a.z, 0.8);
        F.arc(a, b, 0.6, 0.25, 0xffcc66, () => F.explosion(b.x, 0.5, b.z, 1.2), 0.25);
        break;
      }
      case 'rockets': {
        const a = this.wpos(e.from, 3), b = this.wpos(e.to, 0.5);
        for (let k = 0; k < 4; k++) {
          const off = new THREE.Vector3((Math.random() - 0.5) * 3.5, 0, (Math.random() - 0.5) * 3.5);
          setTimeout(() => { S('rocket'); F.arc(a, b.clone().add(off), 1.5, 0.45, 0xff8844, () => { F.explosion(b.x + off.x, 0.4, b.z + off.z, 1.0); S('boom'); }, 0.2); }, k * 110);
        }
        break;
      }
      case 'raid': { const p = this.wpos(e.to, 0); F.ring(p.x, p.z, 0xffffff, 2.5); F.text(p.x, 4, p.z, 'ОГЛУШЁН', '#ffe14d'); S('dash'); break; }
      case 'spawn': case 'promo': case 'build': case 'dig': { const p = this.wpos(e.sq, 0); F.ring(p.x, p.z, 0x9dff7a, 2.4); S('build'); break; }
      case 'rail': {
        const a = this.wpos(e.from, 0), b = this.wpos(e.to, 0);
        F.ring(a.x, a.z, 0x3fb6ff, 2.4); F.ring(b.x, b.z, 0x3fb6ff, 2.4);
        S('train');
        break;
      }
      case 'air': {
        const t = this.wpos(e.sq, 0);
        S('jet');
        const jet = new THREE.Group();
        const body = new THREE.Mesh(new THREE.ConeGeometry(0.6, 4, 6), mat(0x555a60));
        body.rotation.z = -Math.PI / 2;
        jet.add(body);
        const wing = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 4.5), mat(0x4a4f55));
        jet.add(wing);
        const dir = e.side === 'w' ? -1 : 1;
        const from = new THREE.Vector3(t.x - 40, 12, t.z + dir * 10), to = new THREE.Vector3(t.x + 40, 12, t.z - dir * 10);
        F.add(jet, 2.2, (m, k) => { m.position.lerpVectors(from, to, 1 - k); m.lookAt(to); m.rotateY(-Math.PI / 2); });
        for (let k = 0; k < 9; k++) {
          const off = new THREE.Vector3(((k % 3) - 1) * TILE, 0, (Math.floor(k / 3) - 1) * TILE);
          setTimeout(() => { F.explosion(t.x + off.x + (Math.random() - 0.5), 0.4, t.z + off.z + (Math.random() - 0.5), 1.4); S('boom'); }, 900 + k * 90);
        }
        break;
      }
      case 'factory': S('build'); break;
      case 'factoryBoom': {
        const list = this.factoryMeshes[e.side];
        const dir = e.side === 'w' ? 1 : -1;
        const x = list.length ? list[list.length - 1].position.x : -15;
        F.explosion(x, 1, dir * 24, 3);
        S('boom');
        break;
      }
    }
  }

  update(dt) {
    this.time += dt;
    for (const [, e] of this.pieceMeshes) {
      if (e.target) {
        const g = e.group;
        const d = e.target.clone().sub(g.position);
        const dist = d.length();
        if (dist > 0.01) {
          const step = Math.min(dist, dt * (e.t === 'Q' ? 18 : 12));
          g.position.addScaledVector(d.normalize(), step);
          if (dist > 0.5) e.model.rotation.y = Math.atan2(-d.z, d.x);
          if (e.t !== 'Q' && dist > 0.3) g.position.y = Math.abs(Math.sin(this.time * 18)) * 0.15;
        } else {
          g.position.y = 0;
          e.model.rotation.y += (e.face - e.model.rotation.y) * Math.min(1, dt * 3);
        }
      }
      const ud = e.model.userData;
      if (ud.rotor) ud.rotor.rotation.y += dt * 25;
      if (ud.bob) ud.bob.position.y = 2.4 + Math.sin(this.time * 2 + e.group.position.x) * 0.15;
      if (ud.flag) ud.flag.rotation.y = Math.sin(this.time * 3) * 0.3;
    }
    // factory smoke
    this.smokeT = (this.smokeT || 0) - dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.35;
      for (const side of ['w', 'b']) {
        for (const f of this.factoryMeshes[side]) {
          const c = f.userData.chimneys[Math.floor(Math.random() * 2)].clone();
          f.localToWorld(c);
          this.fx.smoke(c.x, c.y - 0.38, c.z, 0x6e6a66, 0.5);
        }
      }
    }
    // hidden: front line pulsing
    if (this.frontMat) this.frontMat.opacity = 0.55 + Math.sin(this.time * 4) * 0.35;
    for (const m of this.hlMeshes) {
      if (m.visible && m.userData.kind !== 'last') m.position.y = 0.33 + Math.sin(this.time * 5) * 0.02;
    }
    // drone
    if (this.droneSnap) {
      if (!this.droneMesh) {
        this.droneMesh = makeDrone(this.droneSide || 'w');
        this.scene.add(this.droneMesh);
      }
      const d = this.droneSnap;
      this.droneMesh.position.set(d.x, d.y, d.z);
      this.droneMesh.rotation.set(0, -d.yaw, 0);
      this.droneMesh.rotateX(d.roll);
      this.droneMesh.rotateZ(-d.pitch);
      for (const p of this.droneMesh.userData.props) p.rotation.y += dt * 40;
      this.droneMesh.visible = !d.over;
    } else if (this.droneMesh) {
      this.scene.remove(this.droneMesh);
      this.droneMesh = null;
    }
    this.fx.update(dt);
    this.updateCamera();
  }
}
