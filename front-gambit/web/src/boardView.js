// 3D strategic board view with environment, effects and cinematic camera shots.
import * as THREE from 'three';
import { TILE, sqToWorld, worldToSq } from './rng.js';
import { unitModel, makeTree, makeFactory, makeDrone, makeKeypoint, TEAM_COLORS, mat, tex, bake } from './models.js';
import { FX } from './fx.js';
import { territory, supplyMap, rc, unitDef } from './rules.js';
import { hasPassive } from './core.js';
import { FACTORY_POS } from './drone.js';
import { A, img } from './assets.js';

const HL_COLORS = { move: 0x4cff6a, capture: 0xff3b30, rail: 0x3fb6ff, metro: 0xd64bff, target: 0xffc93c, select: 0xffffff, last: 0xffe9a0 };

export class BoardView {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
    this.fx = new FX(this.scene);
    this.viewSide = 'w';
    this.camTarget = new THREE.Vector3(0, 0, 1);
    this.camDist = 48;
    this.camAz = 0;
    this.camPitch = 0.95;
    this.pieceMeshes = new Map();
    this.lastFx = 0;
    this.time = 0;
    this.droneSnap = null;
    this.shots = [];
    this.scorches = [];
    this.map = null;
    this.onCine = () => {};
    this.build();
  }

  build() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight(0xdfefff, 0x5a5040, 1.15);
    s.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.7);
    sun.position.set(20, 40, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 110 });
    sun.shadow.bias = -0.0005;
    s.add(sun);
    this.sun = sun;
    this.envGroup = new THREE.Group();
    s.add(this.envGroup);
    // board base frame
    const base = new THREE.Mesh(new THREE.BoxGeometry(8 * TILE + 1.6, 1.0, 8 * TILE + 1.6), mat(0x3d3a32, { map: tex('tex_concrete', 4) }));
    base.position.y = -0.3;
    base.receiveShadow = true;
    s.add(base);
    // tiles
    const tg = new THREE.BoxGeometry(TILE * 0.98, 0.3, TILE * 0.98);
    this.tileMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex('tex_dirt', 1) });
    this.tiles = new THREE.InstancedMesh(tg, this.tileMat, 64);
    this.tiles.receiveShadow = true;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 64; i++) {
      const w = sqToWorld(i);
      dummy.position.set(w.x, 0.15, w.z);
      dummy.rotation.y = ((i * 7) % 4) * Math.PI / 2;
      dummy.updateMatrix();
      this.tiles.setMatrixAt(i, dummy.matrix);
      this.tiles.setColorAt(i, new THREE.Color(0xffffff));
    }
    s.add(this.tiles);
    const hg = new THREE.PlaneGeometry(TILE * 0.92, TILE * 0.92);
    this.hlMeshes = [];
    for (let i = 0; i < 64; i++) {
      const m = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false }));
      const w = sqToWorld(i);
      m.rotation.x = -Math.PI / 2;
      m.position.set(w.x, 0.34, w.z);
      m.visible = false;
      s.add(m);
      this.hlMeshes.push(m);
    }
    for (let c = 0; c < 8; c++) for (const [r, zOff] of [[0, 1], [7, -1]]) {
      const w = sqToWorld(r * 8 + c);
      const sp = this.labelSprite('abcdefgh'[c]);
      sp.position.set(w.x, 0.3, w.z + zOff * (TILE / 2 + 0.5));
      s.add(sp);
    }
    for (let r = 0; r < 8; r++) {
      const w = sqToWorld(r * 8);
      for (const x of [w.x - TILE / 2 - 0.5, -w.x + TILE / 2 + 0.5]) {
        const sp = this.labelSprite(String(r + 1));
        sp.position.set(x, 0.3, w.z);
        s.add(sp);
      }
    }
    this.factoryGroups = { w: new THREE.Group(), b: new THREE.Group() };
    s.add(this.factoryGroups.w, this.factoryGroups.b);
    this.factoryMeshes = { w: [], b: [] };
    for (const name of ['railGroup', 'frontGroup', 'mineGroup', 'terrainGroup', 'kpGroup', 'sqfxGroup', 'lootGroup']) {
      this[name] = new THREE.Group();
      s.add(this[name]);
    }
    this.snow = null;
  }

  // environment differs per map
  buildEnvironment(map) {
    if (this.map === map) return;
    this.map = map;
    const g = this.envGroup;
    g.clear();
    const city = map === 'city';
    this.scene.background = new THREE.Color(city ? 0x8fa3b3 : 0x9cc8e0);
    this.scene.fog = new THREE.Fog(this.scene.background, 75, 150);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), mat(city ? 0xb0b0b0 : 0x86a066, { map: tex(city ? 'tex_asphalt' : 'tex_grass', 40) }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.4;
    ground.receiveShadow = true;
    g.add(ground);
    this.tileMat.map = tex(city ? 'tex_cobble' : 'tex_dirt', 1);
    this.tileMat.needsUpdate = true;
    // rear zones with the main supply line
    for (const dir of [1, -1]) {
      const zone = new THREE.Mesh(new THREE.PlaneGeometry(54, 12), mat(0xffffff, { map: tex('tex_concrete', 6) }));
      zone.rotation.x = -Math.PI / 2;
      zone.position.set(0, -0.38, dir * 23.5);
      zone.receiveShadow = true;
      g.add(zone);
      this.trackLine(-26, dir * 18.6, 26, dir * 18.6, -0.35, g);
      // parked wagons
      for (let k = 0; k < 3; k++) {
        const wag = new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 1.3), mat(k % 2 ? 0x6b4a3a : 0x55603d));
        wag.position.set(16 + k * 3.3, 0.4, dir * 18.6);
        wag.castShadow = true;
        g.add(wag);
      }
    }
    // trenches, hedgehogs and wire along the board sides
    for (const sx of [-1, 1]) {
      for (let z = -12; z <= 12; z += 3) {
        const hh = new THREE.Group();
        for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.12), mat(0x3a3a3a)); b.rotation.set(k * 1.05, k * 0.8, 0.6); hh.add(b); }
        hh.position.set(sx * 19, 0.2, z + (Math.random() - 0.5));
        g.add(bake(hh));
      }
      const wire = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.03, 4, 10), mat(0x777777));
      for (let z = -14; z <= 14; z += 0.6) { const w = wire.clone(); w.position.set(sx * 20.5, 0.25, z); w.rotation.y = Math.PI / 2; g.add(w); }
    }
    if (city) {
      // apartment blocks and streets around the board
      for (let i = 0; i < 46; i++) {
        const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 40;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (Math.abs(z) < 30 && Math.abs(x) < 28) continue;
        const h = 4 + Math.random() * 12;
        const b = new THREE.Mesh(new THREE.BoxGeometry(5 + Math.random() * 4, h, 5 + Math.random() * 4), mat([0xc8c0b4, 0xa8b0b8, 0xd8c8a8][i % 3], { map: tex(i % 2 ? 'tex_concrete' : 'tex_brick', 2) }));
        b.position.set(x, h / 2 - 0.4, z);
        b.castShadow = true;
        b.receiveShadow = true;
        g.add(b);
      }
      for (const z of [-30, 30]) {
        for (let x = -24; x <= 24; x += 8) {
          const lamp = new THREE.Group();
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4, 6), mat(0x333333)); pole.position.y = 1.6; lamp.add(pole);
          const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.3), mat(0xffeeaa, { emissive: 0x665522 })); head.position.set(0.3, 3.6, 0); lamp.add(head);
          lamp.position.set(x, -0.4, z);
          g.add(lamp);
        }
      }
    } else {
      for (let i = 0; i < 110; i++) {
        const a = Math.random() * Math.PI * 2, r = 26 + Math.random() * 45;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (Math.abs(z) > 16 && Math.abs(z) < 31 && Math.abs(x) < 28) continue;
        const t = makeTree(0.9 + Math.random() * 1.3);
        t.position.set(x, -0.4, z);
        g.add(t);
      }
      // river with a bridge on the east flank
      const river = new THREE.Mesh(new THREE.PlaneGeometry(7, 260), new THREE.MeshLambertMaterial({ color: 0x3f7fb3, transparent: true, opacity: 0.85 }));
      river.rotation.x = -Math.PI / 2;
      river.position.set(34, -0.35, 0);
      g.add(river);
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(9, 0.4, 4), mat(0x7a6a55, { map: tex('tex_wood', 2) }));
      bridge.position.set(34, 0, 0);
      g.add(bridge);
      // farmhouses and hay
      for (const [x, z] of [[-34, 8], [-38, -14], [42, 22]]) {
        const h = new THREE.Group();
        const w = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 4), mat(0xd8c8a8, { map: tex('tex_brick', 1) })); w.position.y = 1.1; h.add(w);
        const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 3.4, 2, 4), mat(0x8a3b2a, { map: tex('tex_roof', 1) })); roof.position.y = 3.6; roof.rotation.y = Math.PI / 4; h.add(roof);
        h.position.set(x, -0.4, z);
        h.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        g.add(h);
      }
      for (let i = 0; i < 12; i++) {
        const hay = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1, 10), mat(0xd9b45a));
        hay.rotation.z = Math.PI / 2;
        hay.position.set(-30 - Math.random() * 15, 0.25, -30 + Math.random() * 60);
        hay.castShadow = true;
        g.add(hay);
      }
    }
  }

  labelSprite(txt) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.font = 'bold 40px "Press Start 2P", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(txt, 32, 34);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false }));
    sp.scale.set(0.9, 0.9, 1);
    return sp;
  }

  trackLine(x1, z1, x2, z2, y = 0.31, parent = this.scene) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const g = new THREE.Group();
    const ang = Math.atan2(z2 - z1, x2 - x1);
    for (const off of [-0.35, 0.35]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.08), mat(0x9a9a9a));
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
    parent.add(bake(g));
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
    if (!this.userZoomed) this.camDist = w / h < 1.2 ? 64 : 48;
  }

  // ---------- cinematic shots ----------
  // shot: {pos:Vector3, look:Vector3, dur, fov?}
  cinematic(shots) {
    if (!this.cineEnabled) return;
    const now = this.time;
    if (this.shots.length > 4) return;
    let t = this.shots.length ? this.shots[this.shots.length - 1].end : now;
    for (const sh of shots) {
      this.shots.push({ ...sh, start: t, end: t + sh.dur });
      t += sh.dur;
    }
  }

  orbitShot(target, dist = 14, height = 8, dur = 1.6, az = null) {
    const a = az ?? (this.camAz + (Math.random() - 0.5) * 1.2);
    return {
      pos: new THREE.Vector3(target.x + Math.sin(a) * dist, height, target.z + Math.cos(a) * dist),
      pos2: new THREE.Vector3(target.x + Math.sin(a + 0.35) * dist * 0.8, height * 0.85, target.z + Math.cos(a + 0.35) * dist * 0.8),
      look: target.clone(), dur,
    };
  }

  updateCamera() {
    if (this.droneSnap) {
      const d = this.droneSnap;
      const fx = Math.cos(d.yaw), fz = Math.sin(d.yaw);
      if (this.camera.fov !== 80) { this.camera.fov = 80; this.camera.updateProjectionMatrix(); }
      this.camera.position.set(d.x - fx * 2.6, d.y + 0.9, d.z - fz * 2.6);
      this.camera.lookAt(d.x + fx * 6, d.y - 0.6 - d.pitch * 6, d.z + fz * 6);
      this.camera.rotateZ(-d.roll * 0.8);
      return;
    }
    if (this.camera.fov !== 45) { this.camera.fov = 45; this.camera.updateProjectionMatrix(); }
    while (this.shots.length && this.shots[0].end < this.time) this.shots.shift();
    const shot = this.shots.find((sh) => sh.start <= this.time);
    this.onCine(!!shot);
    this.cineOn = !!shot;
    if (shot) {
      const k = (this.time - shot.start) / shot.dur;
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const p = shot.pos2 ? shot.pos.clone().lerp(shot.pos2, e) : shot.pos;
      this.camera.position.lerp(p, shot.cut ? 1 : 0.18);
      const look = shot.look2 ? shot.look.clone().lerp(shot.look2, e) : shot.look;
      this.lookCur = this.lookCur ? this.lookCur.lerp(look, 0.2) : look.clone();
      this.camera.lookAt(this.lookCur);
      return;
    }
    const t = this.camTarget;
    const h = Math.sin(this.camPitch) * this.camDist;
    const back = Math.cos(this.camPitch) * this.camDist;
    const want = new THREE.Vector3(t.x + Math.sin(this.camAz) * back, h, t.z + Math.cos(this.camAz) * back);
    if (this.lookCur) {
      this.camera.position.lerp(want, 0.15);
      this.lookCur.lerp(t, 0.15);
      this.camera.lookAt(this.lookCur);
      if (this.camera.position.distanceTo(want) < 0.05) this.lookCur = null;
    } else {
      this.camera.position.copy(want);
      this.camera.lookAt(t);
    }
  }

  pan(dx, dy) {
    const k = this.camDist / 600;
    const ca = Math.cos(this.camAz), sa = Math.sin(this.camAz);
    this.camTarget.x -= (dx * ca + dy * sa) * k;
    this.camTarget.z -= (-dx * sa + dy * ca) * k;
    this.camTarget.x = Math.max(-20, Math.min(20, this.camTarget.x));
    this.camTarget.z = Math.max(-26, Math.min(26, this.camTarget.z));
  }

  zoom(f) { this.userZoomed = true; this.camDist = Math.max(14, Math.min(85, this.camDist * f)); }
  rotate(d) { this.camAz += d; }

  pick(ndcX, ndcY) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const objs = [];
    for (const [, e] of this.pieceMeshes) objs.push(e.group);
    const hits = ray.intersectObjects(objs, true);
    if (hits.length) {
      let o = hits[0].object;
      while (o && o.userData.sq === undefined) o = o.parent;
      if (o) return o.userData.sq;
    }
    const p = new THREE.Vector3();
    if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.3), p)) return worldToSq(p.x, p.z);
    return -1;
  }

  setHighlights(list) {
    for (const m of this.hlMeshes) m.visible = false;
    for (const h of list) {
      const m = this.hlMeshes[h.sq];
      m.visible = true;
      m.material.color.setHex(HL_COLORS[h.kind] || 0xffffff);
      m.material.opacity = h.kind === 'select' ? 0.55 : h.kind === 'last' ? 0.22 : 0.45;
      m.userData.kind = h.kind;
    }
  }

  statusSprite(entry, p, supplied, state) {
    const key = `${p.hp}|${p.maxHp}|${p.stun}|${p.dug}|${supplied}|${p.rank}|${p.t}|${p.s}|${JSON.stringify(p.st)}|${this.iconsReady}`;
    if (entry.statusKey === key) return;
    entry.statusKey = key;
    const c = entry.canvas || (entry.canvas = document.createElement('canvas'));
    c.width = 96; c.height = 48;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 96, 48);
    const col = TEAM_COLORS[p.s].css;
    // class badge
    g.fillStyle = '#141810'; g.fillRect(0, 2, 22, 22);
    g.fillStyle = col; g.fillRect(1, 3, 20, 20);
    g.fillStyle = '#141810'; g.fillRect(3, 5, 16, 16);
    const ui = img(A.unit(p.t));
    if (ui.complete && ui.naturalWidth) {
      const sc = Math.min(16 / ui.naturalWidth, 16 / ui.naturalHeight);
      g.drawImage(ui, 3 + (16 - ui.naturalWidth * sc) / 2, 5 + (16 - ui.naturalHeight * sc) / 2, ui.naturalWidth * sc, ui.naturalHeight * sc);
    }
    // hp bar in pixel blocks
    const f = Math.max(0, p.hp / p.maxHp);
    g.fillStyle = '#141810'; g.fillRect(24, 6, 70, 12);
    const blocks = 10, filled = Math.ceil(f * blocks);
    for (let i = 0; i < blocks; i++) {
      g.fillStyle = i < filled ? (f > 0.6 ? '#63c74d' : f > 0.3 ? '#feae34' : '#e43b44') : '#3a4466';
      g.fillRect(26 + i * 6.7, 8, 5.5, 8);
    }
    // rank chevrons
    for (let r = 0; r < p.rank; r++) {
      g.fillStyle = '#fee761';
      g.fillRect(26 + r * 8, 20, 6, 2); g.fillRect(27 + r * 8, 22, 4, 2);
    }
    // status icons
    const icons = [];
    if (!supplied) icons.push('st_nosupply');
    if (p.stun > 0) icons.push('st_stun');
    if (p.dug) icons.push('st_dug');
    if (p.st.shield > 0) icons.push('st_shield');
    if (p.st.marked > 0) icons.push('st_marked');
    if (p.st.stealth > 0 || hasPassive(state, p, 'stealth')) icons.push('st_stealth');
    if (p.st.buff > 0) icons.push('st_buff');
    if (p.st.overwatch > 0) icons.push('st_overwatch');
    icons.slice(0, 5).forEach((id, k) => {
      const im = img(A.icon(id));
      if (im.complete && im.naturalWidth) g.drawImage(im, 24 + k * 14, 28, 13, 13);
    });
    if (!entry.sprite) {
      entry.tex = new THREE.CanvasTexture(c);
      entry.tex.magFilter = THREE.NearestFilter;
      entry.tex.minFilter = THREE.NearestFilter;
      entry.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: entry.tex, depthTest: false, transparent: true }));
      entry.sprite.scale.set(3.2, 1.6, 1);
      entry.sprite.renderOrder = 5;
      entry.group.add(entry.sprite);
    } else entry.tex.needsUpdate = true;
    const d = unitDef(state, p);
    entry.sprite.position.y = p.t === 'Q' || d.air ? 4.8 : p.t === 'K' ? 4.1 : ['R', 'A', 'L', 'T'].includes(p.t) ? 3.2 : 3.1;
  }

  sync(state, viewer) {
    this.state = state;
    this.buildEnvironment(state.map);
    const terr = territory(state);
    const sup = supplyMap(state, terr);
    const col = new THREE.Color();
    const city = state.map === 'city';
    for (let i = 0; i < 64; i++) {
      const [r, c] = rc(i);
      col.setHex(city ? ((r + c) % 2 ? 0xcfcac0 : 0xa8a49a) : ((r + c) % 2 ? 0xd6e0a0 : 0xa8b878));
      if (terr[i]) col.lerp(new THREE.Color(TEAM_COLORS[terr[i]].main), 0.3);
      if (state.effects && state.effects.mud > 0 && !city) col.lerp(new THREE.Color(0x5a4228), 0.35);
      this.tiles.setColorAt(i, col);
    }
    this.tiles.instanceColor.needsUpdate = true;
    this.syncTerrain(state);
    // pieces
    const seen = new Set();
    state.board.forEach((p, i) => {
      if (!p) return;
      seen.add(p.id);
      let e = this.pieceMeshes.get(p.id);
      const w = sqToWorld(i);
      if (!e || e.t !== p.t || e.s !== p.s) {
        if (e) this.scene.remove(e.group);
        const group = new THREE.Group();
        const def = p.t === 'C' ? state.customDefs[p.cid] : null;
        const model = unitModel(p.t, p.s, 'board', def);
        const vehicle = ['R', 'A', 'L', 'T'].includes(p.t);
        model.scale.setScalar(vehicle ? 0.95 : p.t === 'Q' ? 0.85 : p.t === 'K' ? 1 : p.t === 'C' ? 1.1 : 1.45);
        group.add(model);
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
        if (e) group.position.copy(e.group.position); else group.position.set(w.x, 0, w.z);
        const face = p.s === 'w' ? Math.PI / 2 : p.s === 'b' ? -Math.PI / 2 : 0;
        model.rotation.y = face;
        group.userData.sq = i;
        this.scene.add(group);
        e = { group, model, t: p.t, s: p.s, sandbags, face };
        this.pieceMeshes.set(p.id, e);
      }
      e.group.userData.sq = i;
      e.target = new THREE.Vector3(w.x, 0, w.z);
      e.sandbags.visible = !!p.dug;
      this.statusSprite(e, p, p.s === 'n' || sup[p.s][i], state);
    });
    for (const [id, e] of this.pieceMeshes) if (!seen.has(id)) { this.scene.remove(e.group); this.pieceMeshes.delete(id); }
    // factories
    for (const side of ['w', 'b']) {
      const list = this.factoryMeshes[side];
      const n = state.factories[side].length;
      while (list.length < n) {
        const f = makeFactory(side);
        const k = list.length;
        const pos = FACTORY_POS(side, k);
        f.position.set(pos.x, -0.38, pos.z);
        if (side === 'b') f.rotation.y = Math.PI;
        this.factoryGroups[side].add(f);
        list.push(f);
        f.userData.track = this.trackLine(pos.x + 3, pos.z - Math.sign(pos.z) * 2, pos.x + 3, Math.sign(pos.z) * 18.6, -0.35, this.factoryGroups[side]);
      }
      while (list.length > n) {
        const f = list.pop();
        this.factoryGroups[side].remove(f);
        this.factoryGroups[side].remove(f.userData.track);
      }
    }
    this.syncRails(state);
    // mines (owner, radar owner or revealed)
    this.mineGroup.clear();
    state.mines.forEach((o, i) => {
      if (!o) return;
      const radar = viewer && state.keypoints.some((k) => k.type === 'radar' && viewer.includes(k.owner));
      if (viewer && !viewer.includes(o) && !state.revealed[i] && !radar) return;
      const w = sqToWorld(i);
      const mm = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.18, 10), mat(0x3a3a2a));
      mm.position.set(w.x - 1.1, 0.38, w.z + 1.1);
      this.mineGroup.add(mm);
      const pin = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[o].main }));
      pin.position.set(w.x - 1.1, 0.52, w.z + 1.1);
      this.mineGroup.add(pin);
    });
    // loot caches
    this.lootGroup.clear();
    state.loot.forEach((v, i) => {
      if (!v) return;
      const w = sqToWorld(i);
      const cr = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 0.8), mat(0x9b7b4d, { map: tex('tex_wood', 1) }));
      cr.position.set(w.x + 1, 0.7, w.z - 1);
      cr.castShadow = true;
      this.lootGroup.add(cr);
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 0.7), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
      glow.position.set(w.x + 1, 1.12, w.z - 1);
      this.lootGroup.add(glow);
    });
    this.syncSqfx(state);
    this.syncFront(terr);
    this.updateLighting(state);
    for (const e of state.fx) {
      if (e.id <= this.lastFx) continue;
      this.lastFx = e.id;
      this.playFx(e, state);
    }
  }

  syncTerrain(state) {
    const key = state.map + state.terrain.join(',') + state.keypoints.map((k) => k.owner).join(',');
    if (key === this.terrainKey) return;
    this.terrainKey = key;
    this.terrainGroup.clear();
    this.kpGroup.clear();
    this.kpModels = [];
    state.terrain.forEach((t, i) => {
      if (!t) return;
      const w = sqToWorld(i);
      const g = new THREE.Group();
      g.position.set(w.x, 0.3, w.z);
      if (t === 'bld') {
        // walls of a ruined apartment block around the tile edges, open in the middle
        const wallM = mat(0xd0c4ae, { map: tex('tex_brick', 1) });
        for (const [x, z, ww, dd, h] of [[-1.75, 0, 0.3, 3.8, 2.6], [1.75, -0.9, 0.3, 2, 1.8], [0, -1.75, 3.8, 0.3, 2.2], [-0.9, 1.75, 2, 0.3, 1.5]]) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(ww, h, dd), wallM);
          m.position.set(x, h / 2, z);
          m.castShadow = true; m.receiveShadow = true;
          g.add(m);
          for (let k = 0; k < 2; k++) {
            const win = new THREE.Mesh(new THREE.BoxGeometry(ww > 1 ? 0.5 : 0.32, 0.45, dd > 1 ? 0.5 : 0.32), mat(0x2a3540));
            win.position.set(x + (ww > 1 ? (k - 0.5) * 1.2 : 0), h * 0.6, z + (dd > 1 ? (k - 0.5) * 1.2 : 0));
            g.add(win);
          }
        }
      } else if (t === 'ruin') {
        for (let k = 0; k < 7; k++) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(0.5 + Math.random() * 0.8, 0.3 + Math.random() * 0.5, 0.5 + Math.random() * 0.8), mat(0xb0a690));
          m.position.set((Math.random() - 0.5) * 3, 0.2, (Math.random() - 0.5) * 3);
          m.rotation.set(Math.random(), Math.random(), Math.random());
          g.add(m);
        }
      } else if (t === 'metro') {
        const pav = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 1.2), mat(0x8a8a90));
        pav.position.set(1.3, 0.7, 1.3);
        g.add(pav);
        const sign = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 0.7), new THREE.MeshBasicMaterial({ color: 0xe43b44 }));
        sign.position.set(1.3, 1.9, 1.3);
        g.add(sign);
        const mm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, 0.35), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        mm.position.set(1.36, 1.9, 1.3);
        g.add(mm);
      }
      this.terrainGroup.add(g);
    });
    for (const kp of state.keypoints) {
      const w = sqToWorld(kp.sq);
      const m = makeKeypoint(kp.type);
      m.position.set(w.x - 1.1, 0.3, w.z - 1.1);
      m.scale.setScalar(0.65);
      this.kpGroup.add(m);
      this.kpModels.push(m);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2, 5), mat(0xdddddd));
      pole.position.set(w.x + 1.5, 1.3, w.z - 1.5);
      this.kpGroup.add(pole);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.04), mat(kp.owner ? TEAM_COLORS[kp.owner].main : 0xdddddd));
      flag.position.set(w.x + 1.85, 2.05, w.z - 1.5);
      this.kpGroup.add(flag);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.75, 1.92, 4, 1), new THREE.MeshBasicMaterial({ color: kp.owner ? TEAM_COLORS[kp.owner].main : 0xffd23f, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.rotation.z = Math.PI / 4;
      ring.position.set(w.x, 0.33, w.z);
      this.kpGroup.add(ring);
    }
  }

  syncRails(state) {
    const railKey = state.rails.join(',');
    if (railKey === this.railKey) return;
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
        this.trackLine(w.x, w.z, w.x + dc * TILE / 2, w.z - dr * TILE / 2, 0.31, this.railGroup);
      }
      if (!any) this.trackLine(w.x, w.z - TILE / 2.5, w.x, w.z + TILE / 2.5, 0.31, this.railGroup);
      const marker = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.4), mat(TEAM_COLORS[o].main));
      marker.position.set(w.x + TILE * 0.38, 0.55, w.z - TILE * 0.38);
      this.railGroup.add(marker);
    }
  }

  syncSqfx(state) {
    const key = JSON.stringify(state.sqfx);
    if (key === this.sqfxKey) return;
    this.sqfxKey = key;
    this.sqfxGroup.clear();
    this.fires = [];
    state.sqfx.forEach((f, i) => {
      if (!f) return;
      const w = sqToWorld(i);
      if (f.smoke) for (let k = 0; k < 4; k++) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshLambertMaterial({ color: 0xd8d8d8, transparent: true, opacity: 0.45, depthWrite: false }));
        p.position.set(w.x + (Math.random() - 0.5) * 2.5, 1 + Math.random(), w.z + (Math.random() - 0.5) * 2.5);
        p.scale.setScalar(1 + Math.random() * 0.6);
        this.sqfxGroup.add(p);
      }
      if (f.gas) for (let k = 0; k < 3; k++) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshLambertMaterial({ color: 0x9be64d, transparent: true, opacity: 0.35, depthWrite: false }));
        p.position.set(w.x + (Math.random() - 0.5) * 2.5, 0.7, w.z + (Math.random() - 0.5) * 2.5);
        p.scale.set(1.4, 0.6, 1.4);
        this.sqfxGroup.add(p);
      }
      if (f.fire) {
        for (let k = 0; k < 4; k++) {
          const c = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.2, 6), new THREE.MeshBasicMaterial({ color: k % 2 ? 0xff8a1c : 0xffd23f, transparent: true, opacity: 0.85 }));
          c.position.set(w.x + (Math.random() - 0.5) * 2.6, 0.9, w.z + (Math.random() - 0.5) * 2.6);
          this.sqfxGroup.add(c);
          this.fires.push(c);
        }
      }
    });
  }

  syncFront(terr) {
    this.frontGroup.clear();
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9 });
    this.frontMat = lineMat;
    for (let i = 0; i < 64; i++) {
      const [r, c] = rc(i);
      const w = sqToWorld(i);
      if (c < 7 && terr[i] !== terr[i + 1] && (terr[i] || terr[i + 1])) {
        const seg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, TILE), lineMat);
        seg.position.set(w.x + TILE / 2, 0.37, w.z);
        this.frontGroup.add(seg);
      }
      if (r < 7 && terr[i] !== terr[i + 8] && (terr[i] || terr[i + 8])) {
        const seg = new THREE.Mesh(new THREE.BoxGeometry(TILE, 0.14, 0.2), lineMat);
        seg.position.set(w.x, 0.37, w.z - TILE / 2);
        this.frontGroup.add(seg);
      }
    }
  }

  updateLighting(state) {
    const night = state.effects && state.effects.blackout > 0;
    this.night = night;
    this.sun.intensity = night ? 0.35 : 1.7;
    this.hemi.intensity = night ? 0.35 : 1.15;
    if (state.effects && state.effects.blizzard > 0 && !this.snow) {
      const n = 900;
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 80; pos[i * 3 + 1] = Math.random() * 30; pos[i * 3 + 2] = (Math.random() - 0.5) * 80; }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.snow = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.25 }));
      this.scene.add(this.snow);
    } else if ((!state.effects || !state.effects.blizzard) && this.snow) { this.scene.remove(this.snow); this.snow = null; }
  }

  skipFx(state) { for (const e of state.fx) this.lastFx = Math.max(this.lastFx, e.id); }

  wpos(i, y = 1) { const w = sqToWorld(i); return new THREE.Vector3(w.x, y, w.z); }

  scorch(x, z, size) {
    const sc = new THREE.Mesh(new THREE.CircleGeometry(1, 10), new THREE.MeshBasicMaterial({ color: 0x15110d, transparent: true, opacity: 0.55, depthWrite: false }));
    sc.rotation.x = -Math.PI / 2;
    sc.position.set(x, 0.32, z);
    sc.scale.setScalar(size);
    this.scene.add(sc);
    this.scorches.push(sc);
    if (this.scorches.length > 40) this.scene.remove(this.scorches.shift());
  }

  boom(p, size) { this.fx.explosion(p.x, p.y, p.z, size); this.scorch(p.x, p.z, size * 1.1); (this.onSound || (() => {}))('boom'); }

  playFx(e, state) {
    const F = this.fx;
    const S = this.onSound || (() => {});
    const W = (i, y) => this.wpos(i, y);
    switch (e.k) {
      case 'boom': this.boom(W(e.sq, 0.4), e.big ? 2.2 : 1.3); break;
      case 'mine': this.boom(W(e.sq, 0.4), 1.6); this.cinematic([this.orbitShot(W(e.sq, 0), 10, 6, 1.2)]); break;
      case 'dmg': { const p = W(e.sq, 3.6); F.text(p.x, p.y, p.z, '-' + e.v); break; }
      case 'heal': { const p = W(e.sq, 3.6); F.text(p.x, p.y, p.z, '+' + e.v, '#63c74d'); F.ring(p.x, p.z, 0x63c74d, 2); S('heal'); break; }
      case 'cash': { const p = W(e.sq, 3.6); F.text(p.x, p.y, p.z, '+' + e.v, '#fee761'); S('cash'); break; }
      case 'arty': {
        const b = W(e.to, 0.4);
        const a = e.from >= 0 ? W(e.from, 2) : b.clone().add(new THREE.Vector3(0, 30, this.viewSide === 'w' ? 30 : -30));
        S('arty');
        this.cinematic([this.orbitShot(b, 13, 9, 2.2)]);
        for (let k = 0; k < 3; k++) {
          const off = new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3);
          setTimeout(() => F.arc(a, b.clone().add(off), 14, 0.9, 0x333333, () => this.boom(b.clone().add(off), 1.4)), k * 200);
        }
        break;
      }
      case 'grad': case 'barrage': {
        const a = W(e.from, 2.5), b = W(e.to, 0.4);
        this.cinematic([{ pos: a.clone().add(new THREE.Vector3(0, 6, this.viewSide === 'w' ? 8 : -8)), look: b, dur: 0.8 }, this.orbitShot(b, 15, 10, 1.8)]);
        const n = e.k === 'grad' ? 9 : 5;
        for (let k = 0; k < n; k++) {
          const off = e.k === 'grad' ? new THREE.Vector3(((k % 3) - 1) * TILE, 0, (Math.floor(k / 3) - 1) * TILE) : new THREE.Vector3((k - 2) * TILE, 0, 0);
          off.x += (Math.random() - 0.5) * 1.5; off.z += (Math.random() - 0.5) * 1.5;
          setTimeout(() => { S('rocket'); F.arc(a, b.clone().add(off), 9, 0.7, 0xff8844, () => this.boom(b.clone().add(off), 1.2), 0.22); }, k * 90);
        }
        break;
      }
      case 'shell': case 'snipe': {
        const a = W(e.from, 1.6), b = W(e.to, 1.2);
        S(e.k === 'snipe' ? 'sniper' : 'cannon');
        F.muzzle(a.x, a.y, a.z, e.k === 'snipe' ? 0.4 : 0.9);
        F.tracer(a, b, e.k === 'snipe' ? 0xffffff : 0xffcc66);
        if (e.k === 'shell') setTimeout(() => this.boom(b, 1.1), 120); else F.spark(b.x, b.y, b.z, 0xff4444);
        break;
      }
      case 'rockets': {
        const a = W(e.from, 3), b = W(e.to, 0.5);
        this.cinematic([this.orbitShot(b, 12, 7, 1.6)]);
        for (let k = 0; k < 4; k++) {
          const off = new THREE.Vector3((Math.random() - 0.5) * 3.5, 0, (Math.random() - 0.5) * 3.5);
          setTimeout(() => { S('rocket'); F.arc(a, b.clone().add(off), 1.5, 0.45, 0xff8844, () => this.boom(b.clone().add(off), 1.0), 0.2); }, k * 110);
        }
        break;
      }
      case 'raid': case 'terror': case 'hack': { const p = W(e.to ?? e.sq, 0); F.ring(p.x, p.z, e.k === 'hack' ? 0x2ce8f5 : 0xffffff, 2.5); F.text(p.x, 4, p.z, e.k === 'hack' ? 'ВЗЛОМ' : 'ОГЛУШЁН', '#fee761'); S('dash'); break; }
      case 'emp': { const p = W(e.sq, 0); F.ring(p.x, p.z, 0x2ce8f5, 7, 1); F.ring(p.x, p.z, 0x2ce8f5, 4, 0.7); S('emp'); this.cinematic([this.orbitShot(p, 12, 9, 1.4)]); break; }
      case 'spawn': case 'promo': case 'build': case 'dig': case 'fortify': case 'repair': case 'ring': {
        const p = W(e.sq, 0);
        const c = e.c === 'gold' ? 0xffd23f : e.c === 'red' ? 0xe43b44 : e.c === 'green' ? 0x63c74d : e.c === 'white' ? 0xffffff : 0x9dff7a;
        F.ring(p.x, p.z, c, 2.4);
        if (e.k === 'spawn') { F.dropIn(this.pieceAt(e.sq)); S('build'); } else S(e.k === 'dig' ? 'dig' : 'build');
        if (e.k === 'promo') { F.text(p.x, 4.5, p.z, 'ВЕРТОЛЁТ!', '#fee761'); this.cinematic([this.orbitShot(p, 9, 5, 1.6)]); }
        break;
      }
      case 'rankup': { const p = W(e.sq, 0); F.ring(p.x, p.z, 0xfee761, 3, 1); F.text(p.x, 4.8, p.z, 'ЗВАНИЕ!', '#fee761'); S('rank'); break; }
      case 'rail': case 'metro': {
        const a = W(e.from, 0), b = W(e.to, 0);
        F.ring(a.x, a.z, e.k === 'metro' ? 0xd64bff : 0x3fb6ff, 2.4);
        F.ring(b.x, b.z, e.k === 'metro' ? 0xd64bff : 0x3fb6ff, 2.4);
        if (e.k === 'rail') { this.trainRun(a, b, e.side || 'w'); S('train'); } else S('metro');
        break;
      }
      case 'trainArrive': { const b = W(e.sq, 0); this.trainRun(b.clone().add(new THREE.Vector3(-20, 0, 0)), b, e.side); this.cinematic([this.orbitShot(b, 12, 6, 2)]); S('train'); break; }
      case 'para': {
        const b = W(e.to, 0);
        const chute = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x63c74d));
        F.add(chute, 1.4, (m, k) => { m.position.set(b.x, 1 + k * 10, b.z); });
        S('para');
        break;
      }
      case 'air': {
        const t = W(e.sq, 0);
        S('jet');
        const jet = this.jetModel(0x555a60);
        const dir = e.side === 'w' ? -1 : 1;
        const from = new THREE.Vector3(t.x - 40, 12, t.z + dir * 10), to = new THREE.Vector3(t.x + 40, 12, t.z - dir * 10);
        F.add(jet, 2.2, (m, k) => { m.position.lerpVectors(from, to, 1 - k); m.lookAt(to); });
        this.cinematic([{ pos: from.clone().add(new THREE.Vector3(0, 6, 8)), pos2: t.clone().add(new THREE.Vector3(0, 14, 14)), look: from, look2: t, dur: 1.1 }, this.orbitShot(t, 16, 10, 1.6)]);
        for (let k = 0; k < 9; k++) {
          const off = new THREE.Vector3(((k % 3) - 1) * TILE, 0, (Math.floor(k / 3) - 1) * TILE);
          setTimeout(() => this.boom(t.clone().add(off).setY(0.4), 1.4), 900 + k * 90);
        }
        break;
      }
      case 'b2': {
        const t = W(e.sq, 0);
        S('b2');
        const b2 = this.b2Model();
        const from = new THREE.Vector3(t.x - 50, 16, t.z), to = new THREE.Vector3(t.x + 50, 16, t.z);
        F.add(b2, 3.2, (m, k) => { m.position.lerpVectors(from, to, 1 - k); m.lookAt(to); });
        this.cinematic([
          { pos: new THREE.Vector3(t.x - 30, 10, t.z + 10), look: new THREE.Vector3(t.x - 40, 16, t.z), look2: new THREE.Vector3(t.x - 10, 16, t.z), dur: 1.4 },
          { pos: new THREE.Vector3(t.x, 22, t.z + 22), look: t, dur: 2.2 },
        ]);
        for (let k = 0; k < 10; k++) {
          const x = t.x + (k / 9 - 0.5) * 5 * TILE;
          setTimeout(() => this.boom(new THREE.Vector3(x, 0.4, t.z + (Math.random() - 0.5) * 2), 1.8), 1300 + k * 110);
        }
        break;
      }
      case 'napalm': {
        const b = W(e.to, 0.4);
        S('fire');
        for (let k = -1; k <= 1; k++) setTimeout(() => F.fireBurst(b.x + k * TILE, b.z), 150 + (k + 1) * 120);
        break;
      }
      case 'gas': { const b = W(e.sq, 0.5); F.cloud(b.x, b.z, 0x9be64d); S('gas'); break; }
      case 'smoke': { const b = W(e.sq, 0.5); F.cloud(b.x, b.z, 0xe0e0e0); S('smoke'); break; }
      case 'flak': case 'broadside': {
        const a = W(e.sq, 2);
        S('flak');
        for (let k = 0; k < 10; k++) setTimeout(() => F.flakBurst(a.x + (Math.random() - 0.5) * 18, 6 + Math.random() * 6, a.z + (Math.random() - 0.5) * 18), k * 80);
        if (e.k === 'broadside') this.cinematic([this.orbitShot(a, 12, 6, 1.4)]);
        break;
      }
      case 'kamikaze': break;
      case 'shield': case 'shieldhit': { const p = W(e.sq, 1.5); F.bubble(p.x, p.y, p.z, 0x2ce8f5); S('shield'); break; }
      case 'mark': { const p = W(e.sq, 0); F.ring(p.x, p.z, 0xe43b44, 2.2, 1.2); S('lock'); break; }
      case 'recon': { const b = W(e.to, 0); F.ring(b.x, b.z, 0x2ce8f5, 10, 1.4); S('radar'); break; }
      case 'ew': { const p = e.sq !== undefined ? W(e.sq, 0) : new THREE.Vector3(0, 0, 0); F.ring(p.x, p.z, 0xb55088, 8, 1.2); S('ew'); break; }
      case 'inspire': case 'hospital': case 'supply': {
        const p = e.sq !== undefined ? W(e.sq, 0) : new THREE.Vector3(0, 0, e.side === 'w' ? 10 : -10);
        F.ring(p.x, p.z, e.k === 'inspire' ? 0xfee761 : 0x63c74d, 5, 1);
        S(e.k === 'inspire' ? 'rally' : 'heal');
        break;
      }
      case 'swap': case 'hook': case 'ram': { const p = W(e.to, 0); F.ring(p.x, p.z, 0xffffff, 2); S(e.k === 'ram' ? 'cannon' : 'dash'); break; }
      case 'overdrive': { const p = W(e.sq, 0); F.ring(p.x, p.z, 0xf77622, 3); S('engine'); break; }
      case 'drop': { const p = W(e.sq, 0); F.ring(p.x, p.z, 0x63c74d, 2); S('para'); break; }
      case 'convert': case 'propaganda': {
        const p = W(e.sq ?? e.to, 0);
        F.ring(p.x, p.z, 0xb55088, 3, 1);
        F.text(p.x, 4.5, p.z, 'ПЕРЕБЕЖЧИК', '#f6757a');
        S('radio');
        this.cinematic([this.orbitShot(p, 9, 5, 1.5)]);
        break;
      }
      case 'dictator': {
        const p = W(e.sq, 0);
        F.ring(p.x, p.z, 0x444444, 6, 1.5);
        F.text(p.x, 5, p.z, 'ДИКТАТОР', '#c0cbdc');
        this.cinematic([this.orbitShot(p, 8, 4, 2.5)]);
        S('alarm');
        break;
      }
      case 'capture': { const p = W(e.sq, 0); F.ring(p.x, p.z, TEAM_COLORS[e.side] ? TEAM_COLORS[e.side].main : 0xffffff, 3, 1); S('capture'); break; }
      case 'collapse': { const p = W(e.sq, 0.5); this.boom(p, 2); F.cloud(p.x, p.z, 0xb0a690); S('collapse'); break; }
      case 'blitz': {
        S('blitz');
        const dir = e.side === 'w' ? -1 : 1;
        for (let k = 0; k < 5; k++) {
          const t = unitModel('R', e.side, 'board');
          t.scale.setScalar(0.8);
          const x0 = -14 + k * 7;
          F.add(t, 2.6, (m, kk) => { m.position.set(x0, 0, -dir * 26 + dir * (1 - kk) * 52); m.rotation.y = dir > 0 ? -Math.PI / 2 : Math.PI / 2; });
        }
        this.cinematic([{ pos: new THREE.Vector3(24, 10, 0), look: new THREE.Vector3(0, 0, 0), dur: 2.2 }]);
        break;
      }
      case 'sabotage': {
        const en = e.side === 'w' ? 'b' : 'w';
        const pos = FACTORY_POS(en, Math.max(0, (state.factories[en].length || 1) - 1));
        this.nightFlash = 1.6;
        this.cinematic([{ pos: new THREE.Vector3(pos.x + 8, 6, pos.z + (en === 'b' ? 10 : -10)), look: new THREE.Vector3(pos.x, 1, pos.z), dur: 2 }]);
        S('sneak');
        break;
      }
      case 'factory': {
        const pos = FACTORY_POS(e.side, e.idx || 0);
        this.cinematic([{ pos: new THREE.Vector3(pos.x + 6, 7, pos.z + (e.side === 'w' ? 10 : -10)), look: new THREE.Vector3(pos.x, 1, pos.z), dur: 1.5 }]);
        S('build');
        break;
      }
      case 'factoryHit': case 'factoryBoom': {
        const pos = FACTORY_POS(e.side, e.idx || 0);
        this.boom(new THREE.Vector3(pos.x, 1, pos.z), e.k === 'factoryBoom' ? 3.2 : 1.6);
        if (e.k === 'factoryBoom') this.cinematic([{ pos: new THREE.Vector3(pos.x + 8, 8, pos.z + (e.side === 'w' ? 12 : -12)), look: new THREE.Vector3(pos.x, 1, pos.z), dur: 1.8 }]);
        break;
      }
      case 'decoy': { const p = W(e.sq, 0); F.text(p.x, 4, p.z, 'ЛОЖНАЯ ЦЕЛЬ', '#c0cbdc'); break; }
      case 'resist': { const p = W(e.sq, 3); F.text(p.x, p.y, p.z, 'НЕ СЛОМЛЕН', '#c0cbdc'); break; }
      case 'card': S('card'); break;
      case 'b2ready': S('alarm'); break;
      case 'duel': {
        const a = W(e.from, 1.5), b = W(e.to, 1.5);
        const mid = a.clone().lerp(b, 0.5);
        const side = new THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(7);
        this.cinematic([{ pos: mid.clone().add(side).setY(4), pos2: mid.clone().add(side.multiplyScalar(0.6)).setY(3), look: a, look2: b, dur: 1.3 }]);
        break;
      }
    }
  }

  pieceAt(i) { for (const [, e] of this.pieceMeshes) if (e.group.userData.sq === i) return e.model; return null; }

  jetModel(color) {
    const jet = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.6, 4, 6), mat(color));
    body.rotation.x = Math.PI / 2;
    jet.add(body);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.1, 1.4), mat(color - 0x0b0b0b));
    jet.add(wing);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.8), mat(color));
    tail.position.set(0, 0.5, -1.6);
    jet.add(tail);
    return jet;
  }

  b2Model() {
    const g = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(0, 3); shape.lineTo(7, -1.5); shape.lineTo(5.5, -2.2); shape.lineTo(3.5, -1.2); shape.lineTo(2, -2.2);
    shape.lineTo(0, -1.2); shape.lineTo(-2, -2.2); shape.lineTo(-3.5, -1.2); shape.lineTo(-5.5, -2.2); shape.lineTo(-7, -1.5); shape.lineTo(0, 3);
    const wing = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false }), mat(0x1f2328));
    wing.rotation.x = -Math.PI / 2;
    g.add(wing);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  trainRun(a, b, side) {
    const loco = unitModel('T', side || 'w', 'board');
    loco.scale.setScalar(0.8);
    const from = a.clone(), to = b.clone();
    const ang = Math.atan2(to.z - from.z, to.x - from.x);
    this.fx.add(loco, 1.2, (m, k) => {
      m.position.lerpVectors(from, to, 1 - k);
      m.position.y = 0.32;
      m.rotation.y = -ang;
      if (Math.random() < 0.3) this.fx.smoke(m.position.x, 2, m.position.z, 0x555555, 0.4);
    });
  }

  update(dt) {
    this.time += dt;
    for (const [, e] of this.pieceMeshes) {
      if (e.target) {
        const g = e.group;
        const d = e.target.clone().sub(g.position);
        const dist = d.length();
        if (dist > 0.01) {
          g.position.addScaledVector(d.normalize(), Math.min(dist, dt * (e.t === 'Q' ? 18 : 12)));
          if (dist > 0.5) e.model.rotation.y = Math.atan2(-d.z, d.x);
          if (e.t !== 'Q' && dist > 0.3) g.position.y = Math.abs(Math.sin(this.time * 18)) * 0.15;
        } else {
          g.position.y = 0;
          e.model.rotation.y += (e.face - e.model.rotation.y) * Math.min(1, dt * 3);
        }
      }
      const ud = e.model.userData;
      if (ud.rotor) ud.rotor.rotation.y += dt * 25;
      if (ud.tailRotor) ud.tailRotor.rotation.z += dt * 40;
      if (ud.bob) ud.bob.position.y = 2.4 + Math.sin(this.time * 2 + e.group.position.x) * 0.15;
      if (ud.flag) ud.flag.rotation.y = Math.sin(this.time * 3) * 0.3;
      if (ud.dish) ud.dish.rotation.y += dt * 2;
      if (ud.aim && e.t === 'R') ud.aim.rotation.y = Math.sin(this.time * 0.4 + e.group.position.x) * 0.35;
      if (ud.legs) { const b = Math.sin(this.time * 2 + e.group.position.z) * 0.03; ud.aim.rotation.z = b; }
    }
    if (this.kpModels) for (const m of this.kpModels) {
      if (m.userData.beam) m.userData.beam.rotation.z = Math.sin(this.time * 2) * 0.35;
      if (m.userData.dish) m.userData.dish.rotation.y += dt * 1.5;
    }
    if (this.fires) for (const f of this.fires) { f.scale.y = 0.7 + Math.random() * 0.6; f.material.opacity = 0.6 + Math.random() * 0.4; }
    if (this.fires && Math.random() < dt * 8 && this.fires.length) { const f = this.fires[Math.floor(Math.random() * this.fires.length)]; this.fx.smoke(f.position.x, 1.6, f.position.z, 0x333333, 0.5); }
    if (this.snow) {
      const p = this.snow.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) { let y = p.getY(i) - dt * 6; if (y < 0) y = 30; p.setY(i, y); p.setX(i, p.getX(i) + dt * 3); if (p.getX(i) > 40) p.setX(i, -40); }
      p.needsUpdate = true;
    }
    if (this.nightFlash > 0) {
      this.nightFlash -= dt;
      this.sun.intensity = this.night ? 0.35 : this.nightFlash > 0 ? 0.25 : 1.7;
      this.hemi.intensity = this.night ? 0.35 : this.nightFlash > 0 ? 0.3 : 1.15;
    }
    this.smokeT = (this.smokeT || 0) - dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.35;
      for (const side of ['w', 'b']) for (const f of this.factoryMeshes[side]) {
        const c = f.userData.chimneys[Math.floor(Math.random() * 2)].clone();
        f.localToWorld(c);
        this.fx.smoke(c.x, c.y, c.z, 0x6e6a66, 0.5);
      }
      for (const [, e] of this.pieceMeshes) if (e.t === 'T' && Math.random() < 0.5) { const p = e.group.position; this.fx.smoke(p.x + 1, 2.2, p.z, 0x555555, 0.35); }
    }
    if (this.frontMat) this.frontMat.opacity = 0.55 + Math.sin(this.time * 4) * 0.35;
    for (const m of this.hlMeshes) if (m.visible && m.userData.kind !== 'last') m.position.y = 0.34 + Math.sin(this.time * 5) * 0.02;
    const hideSprites = !!this.droneSnap || this.cineOn;
    if (hideSprites !== this.spritesHidden) {
      this.spritesHidden = hideSprites;
      for (const [, e] of this.pieceMeshes) if (e.sprite) e.sprite.visible = !hideSprites;
    }
    if (this.droneSnap) {
      if (!this.droneMesh) { this.droneMesh = makeDrone(this.droneSide || 'w'); this.scene.add(this.droneMesh); }
      const d = this.droneSnap;
      this.droneMesh.position.set(d.x, d.y, d.z);
      this.droneMesh.rotation.set(0, -d.yaw, 0);
      this.droneMesh.rotateX(d.roll);
      this.droneMesh.rotateZ(-d.pitch);
      for (const p of this.droneMesh.userData.props) p.rotation.y += dt * 40;
      this.droneMesh.visible = !d.over;
    } else if (this.droneMesh) { this.scene.remove(this.droneMesh); this.droneMesh = null; }
    this.fx.update(dt);
    this.updateCamera();
  }
}
