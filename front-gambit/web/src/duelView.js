// 3D view of a real-time duel arena.
import * as THREE from 'three';
import { unitModel, makeObstacle, makeTree, TEAM_COLORS, mat, tex } from './models.js';
import { FX } from './fx.js';
import { genArena, ARENA } from './duel.js';

const THEME = {
  field: { ground: 'tex_grass', tint: 0x86a066, sky: 0xa8cde0, dirt: 0x6b5a3c },
  desert: { ground: 'tex_sand', tint: 0xffffff, sky: 0xe6d5b0, dirt: 0xb08f58 },
  winter: { ground: 'tex_snow', tint: 0xffffff, sky: 0xc5d3dc, dirt: 0xa9b4ba },
  ruins: { ground: 'tex_dirt', tint: 0xb0aaa0, sky: 0x9aa3a8, dirt: 0x55524a },
  city: { ground: 'tex_asphalt', tint: 0xd0d0d0, sky: 0x9fb0bf, dirt: 0x55524a },
};

export class DuelView {
  constructor(renderer) {
    this.renderer = renderer;
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
    this.scene = null;
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.narrow = w / h < 1.2;
  }

  start(rt, localTeam, sound, customDefs = {}) {
    this.rt = rt;
    this.localTeam = localTeam;
    this.sound = sound || (() => {});
    this.customDefs = customDefs;
    const hasTrain = rt.att.t === 'T' || rt.def.t === 'T';
    const arena = genArena(rt.seed, { urban: rt.urban, train: hasTrain });
    this.theme = arena.theme;
    const T = THEME[arena.theme];
    const s = new THREE.Scene();
    this.scene = s;
    const night = !!rt.night;
    s.background = new THREE.Color(night ? 0x0b1020 : T.sky);
    s.fog = new THREE.Fog(s.background, night ? 20 : 40, night ? 60 : 90);
    s.add(new THREE.HemisphereLight(night ? 0x405080 : 0xffffff, 0x332211, night ? 0.35 : 1.0));
    const sun = new THREE.DirectionalLight(night ? 0x8090ff : 0xfff0d0, night ? 0.35 : 1.7);
    sun.position.set(-12, 30, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 18, bottom: -18, near: 1, far: 80 });
    s.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA.w + 60, ARENA.d + 60), mat(T.tint, { map: tex(T.ground, 12) }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    s.add(ground);
    for (let i = 0; i < 16; i++) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(0.8 + Math.random() * 1.6, 10), mat(0xc8b8a0, { map: tex('tex_dirt', 1), transparent: true, opacity: 0.85 }));
      p.rotation.x = -Math.PI / 2;
      p.position.set((Math.random() - 0.5) * ARENA.w, 0.02, (Math.random() - 0.5) * ARENA.d);
      p.receiveShadow = true;
      s.add(p);
    }
    if (arena.theme === 'city') {
      for (const z of [-4, 4]) for (let x = -ARENA.w / 2; x < ARENA.w / 2; x += 4) {
        const l = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.2), mat(0xeeeeee));
        l.rotation.x = -Math.PI / 2; l.position.set(x, 0.03, z);
        s.add(l);
      }
    }
    if (hasTrain) {
      for (const off of [-0.6, 0.6]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(ARENA.w + 10, 0.1, 0.1), mat(0x9a9a9a));
        r.position.set(0, 0.08, off); s.add(r);
      }
      for (let x = -ARENA.w / 2 - 5; x < ARENA.w / 2 + 5; x += 0.8) {
        const sl = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.06, 1.8), mat(0x5a3d22));
        sl.position.set(x, 0.03, 0); s.add(sl);
      }
    }
    const fenceMat = mat(0x5a4a35, { map: tex('tex_wood', 1) });
    for (const z of [-ARENA.d / 2 - 0.3, ARENA.d / 2 + 0.3]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(ARENA.w + 0.6, 0.8, 0.25), fenceMat);
      f.position.set(0, 0.4, z); s.add(f);
    }
    for (const x of [-ARENA.w / 2 - 0.3, ARENA.w / 2 + 0.3]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.8, ARENA.d + 0.6), fenceMat);
      f.position.set(x, 0.4, 0); s.add(f);
    }
    for (const [team, x] of [['att', -ARENA.w / 2 + 1.5], ['def', ARENA.w / 2 - 1.5]]) {
      const side = rt[team].s;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.5, 5), mat(0xcccccc));
      pole.position.set(x, 1.75, -ARENA.d / 2 + 1.5); s.add(pole);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 0.05), mat(TEAM_COLORS[side].main));
      flag.position.set(x + 0.65, 3.0, -ARENA.d / 2 + 1.5); s.add(flag);
    }
    this.obsMeshes = new Map();
    for (const o of arena.obs) {
      const m = makeObstacle(o, arena.theme);
      m.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
      s.add(m);
      this.obsMeshes.set(o.id, m);
      if (night && o.kind === 'house') {
        const l = new THREE.PointLight(0xffc870, 6, 7);
        l.position.set(o.x, 2.2, o.z + o.d / 2 + 0.5);
        s.add(l);
      }
    }
    for (const d of arena.deco) {
      if (arena.theme === 'city') {
        const h = 6 + Math.random() * 8;
        const b = new THREE.Mesh(new THREE.BoxGeometry(5, h, 4), mat(0xffffff, { map: tex('tex_brick', 2) }));
        b.position.set(d.x, h / 2, d.z + Math.sign(d.z) * 3);
        s.add(b);
      } else {
        const t = makeTree(d.s * 1.3, arena.theme === 'winter', arena.theme === 'desert');
        t.position.set(d.x, 0, d.z);
        s.add(t);
      }
    }
    this.fx = new FX(s);
    this.units = new Map();
    this.objMeshes = new Map();
    this.projPool = [];
    this.projGroup = new THREE.Group();
    s.add(this.projGroup);
    this.laser = new THREE.Mesh(new THREE.BoxGeometry(1, 0.04, 0.04), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.55 }));
    s.add(this.laser);
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 16), new THREE.MeshBasicMaterial({ color: 0xff4040, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
    this.reticle.rotation.x = -Math.PI / 2;
    s.add(this.reticle);
    this.night = night;
    this.camPos = new THREE.Vector3(localTeam === 'def' ? ARENA.w / 2 - 6 : -ARENA.w / 2 + 6, 22, 12);
    this.snap = null;
    this.time = 0;
    this.shake = 0;
    this.slowmo = 0;
  }

  side(team) { return this.rt[team].s; }

  hpSprite(e, hp, maxHp, main) {
    const key = Math.ceil(hp) + '/' + maxHp;
    if (e.hpKey === key) return;
    e.hpKey = key;
    const c = e.hpCanvas || (e.hpCanvas = document.createElement('canvas'));
    c.width = 64; c.height = 8;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 64, 8);
    g.fillStyle = '#141810';
    g.fillRect(0, 0, 64, 8);
    const f = Math.max(0, hp / maxHp);
    const col = !this.localTeam ? TEAM_COLORS[this.side(e.team)].css : e.team === this.localTeam ? '#63c74d' : '#e43b44';
    const n = 12, filled = Math.ceil(f * n);
    for (let i = 0; i < n; i++) { g.fillStyle = i < filled ? col : '#3a4466'; g.fillRect(2 + i * 5, 2, 4, 4); }
    if (!e.hpSprite) {
      e.hpTex = new THREE.CanvasTexture(c);
      e.hpTex.magFilter = THREE.NearestFilter;
      e.hpSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: e.hpTex, depthTest: false }));
      e.hpSprite.scale.set(main ? 2.6 : 1.6, main ? 0.33 : 0.2, 1);
      e.hpSprite.renderOrder = 5;
      this.scene.add(e.hpSprite);
    } else e.hpTex.needsUpdate = true;
  }

  modelFor(kind, team) {
    const f = this.rt[team];
    if (kind === 'C' || (kind === f.t && f.t === 'C')) return unitModel('C', this.side(team), 'duel', this.customDefs[f.cid]);
    return unitModel(kind, this.side(team), 'duel');
  }

  apply(snap, interpolate) {
    this.snap = snap;
    this.interp = interpolate;
    for (const u of snap.u) {
      const [id, kind, team, x, z, aim, hp, maxHp, alive, body, moving, , main, , , reloading, flags] = u;
      let e = this.units.get(id);
      if (!e) {
        const model = this.modelFor(kind, team);
        const big = ['R', 'Q', 'A', 'L', 'T'].includes(kind) || (kind === 'C' && this.rt[team].vehicle);
        model.scale.setScalar(big ? 1 : kind === 'U' ? 1.2 : 1.25);
        model.traverse((c) => { if (c.isMesh) c.castShadow = true; });
        this.scene.add(model);
        e = { model, kind, team, x, z, tx: x, tz: z, aim, body, alive: true, walk: 0, recoil: 0 };
        const rr = big ? 1.8 : 0.85;
        const ring = new THREE.Mesh(new THREE.RingGeometry(rr, rr + 0.2, 24),
          new THREE.MeshBasicMaterial({ color: TEAM_COLORS[this.side(team)].main, side: THREE.DoubleSide, transparent: true, opacity: main ? 0.9 : 0.45 }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, 0.05, z);
        this.scene.add(ring);
        e.ring = ring;
        if (this.night && main) {
          const fl = new THREE.SpotLight(0xfff2c0, 30, 18, 0.5, 0.5);
          fl.position.set(0, 1.6, 0);
          model.add(fl);
          model.add(fl.target);
          fl.target.position.set(6, 0, 0);
        }
        model.position.set(x, 0, z);
        this.units.set(id, e);
      }
      e.tx = x; e.tz = z; e.aim = aim; e.body = body; e.moving = moving; e.flags = flags; e.reloading = reloading;
      if (!interpolate) { e.x = x; e.z = z; }
      e.main = main;
      if (e.alive && !alive) { e.alive = false; e.deathT = 0; if (e.hpSprite) e.hpSprite.visible = false; }
      if (alive) this.hpSprite(e, hp, maxHp, main);
    }
    for (const id of snap.od || []) {
      const m = this.obsMeshes.get(id);
      if (m) {
        if (m.userData.body) { m.userData.collapse = 1; } else m.visible = false;
      }
    }
    // ground objects (mines, c4, smoke)
    const seen = new Set();
    for (const [id, type, x, z, t, team] of snap.o || []) {
      seen.add(id);
      let m = this.objMeshes.get(id);
      if (!m) {
        if (type === 'smoke') {
          m = new THREE.Group();
          for (let k = 0; k < 10; k++) {
            const p = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshLambertMaterial({ color: 0xdedede, transparent: true, opacity: 0.55, depthWrite: false }));
            const a = Math.random() * Math.PI * 2, r = Math.random() * 2.6;
            p.position.set(Math.cos(a) * r, 0.8 + Math.random() * 1.2, Math.sin(a) * r);
            p.scale.setScalar(1 + Math.random() * 0.8);
            m.add(p);
          }
        } else {
          m = new THREE.Group();
          const body = new THREE.Mesh(type === 'c4' ? new THREE.BoxGeometry(0.5, 0.25, 0.35) : new THREE.CylinderGeometry(0.35, 0.4, 0.15, 10), mat(type === 'c4' ? 0xcfc28a : 0x3a3a2a));
          body.position.y = 0.1;
          m.add(body);
          const led = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), new THREE.MeshBasicMaterial({ color: team === this.localTeam ? 0x63c74d : 0xff2020 }));
          led.position.y = 0.26;
          m.add(led);
          m.userData.led = led;
        }
        this.scene.add(m);
        this.objMeshes.set(id, m);
      }
      m.position.set(x, 0, z);
      m.userData.t = t;
      if (m.userData.led) m.userData.led.visible = Math.sin(this.time * (type === 'c4' ? 20 : 6)) > 0;
    }
    for (const [id, m] of this.objMeshes) if (!seen.has(id)) { this.scene.remove(m); this.objMeshes.delete(id); }
    while (this.projPool.length < snap.p.length) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
      this.projGroup.add(m);
      this.projPool.push(m);
    }
    this.projPool.forEach((m, i) => {
      const p = snap.p[i];
      if (!p) { m.visible = false; return; }
      m.visible = true;
      const [x, z, kind, a, life] = p;
      m.position.set(x, kind === 'g' ? 0.6 + Math.sin(Math.max(0, life) / 0.9 * Math.PI) * 2.5 : 1.2, z);
      m.rotation.set(0, -a, 0);
      if (kind === 'b') { m.scale.set(0.7, 0.07, 0.07); m.material.color.setHex(0xffe066); }
      else if (kind === 's') { m.scale.set(2.5, 0.08, 0.08); m.material.color.setHex(0xffffff); }
      else if (kind === 'c') { m.scale.set(0.6, 0.25, 0.25); m.material.color.setHex(0xffaa33); }
      else if (kind === 'r') { m.scale.set(0.8, 0.18, 0.18); m.material.color.setHex(0xff6633); if (Math.random() < 0.5) this.fx.smoke(x, 1.2, z, 0x999999, 0.3); }
      else if (kind === 'g') { m.scale.set(0.3, 0.3, 0.3); m.material.color.setHex(0x334422); }
      else if (kind === 'f') { const s0 = 0.4 + (1 - life / 0.46) * 0.9; m.scale.set(s0, s0, s0); m.material.color.setHex(Math.random() < 0.5 ? 0xff8a1c : 0xffd23f); m.position.y = 1.0; }
    });
    for (const ev of snap.ev || []) this.event(ev);
  }

  event(ev) {
    const F = this.fx, S = this.sound;
    const u = ev.id !== undefined ? [...this.units.entries()].find(([id]) => id === ev.id) : null;
    const e = u ? u[1] : null;
    switch (ev.k) {
      case 'shot': {
        const big = ev.w === 's' || ev.w === 'c';
        if (ev.w !== 'f') F.muzzle(ev.x, 1.2, ev.z, big ? 0.6 : 0.3);
        if (e) e.recoil = big ? 1 : 0.4;
        if (ev.w === 'f') S('flame', 0.5); else S(ev.w === 's' ? 'sniper' : ev.w === 'c' ? 'cannon' : ev.w === 'r' ? 'rocket' : 'shot', ev.team === this.localTeam ? 1 : 0.6);
        if (Math.random() < 0.4 && ev.w === 'b') F.shell(ev.x, 1.1, ev.z);
        break;
      }
      case 'boom': F.explosion(ev.x, 0.3, ev.z, Math.max(1, ev.r * 0.5)); S('boom'); this.shake = Math.max(this.shake, 0.3); break;
      case 'hit': if (ev.veh) F.spark(ev.x, 1.2, ev.z); else F.blood(ev.x, ev.z); S('hit', 0.5); break;
      case 'crit': F.text(ev.x, 3.4, ev.z, ev.veh ? 'КРИТ!' : 'ХЕДШОТ!', '#fee761'); F.blood(ev.x, ev.z); S('crit'); break;
      case 'spark': F.spark(ev.x, 1.1, ev.z); S('ricochet', 0.3); break;
      case 'debris': F.explosion(ev.x, 0.3, ev.z, ev.kind === 'barrel' || ev.kind === 'car' ? 1.8 : 0.8); S(ev.kind === 'barrel' || ev.kind === 'car' ? 'boom' : 'crate'); break;
      case 'collapse': F.cloud(ev.x, ev.z, 0xb0a690); F.explosion(ev.x, 1, ev.z, 2.2); S('collapse'); this.shake = 0.6; break;
      case 'chip': { const m = this.obsMeshes.get(ev.id); if (m) F.spark(ev.x, 2, ev.z, 0xc9b9a0); break; }
      case 'mark': F.ring(ev.x, ev.z, 0xff2020, 4, 1.6); S('radio'); break;
      case 'dash': F.ring(ev.x, ev.z, 0xffffff, 1.5, 0.3); S('dash'); break;
      case 'throw': S('throw'); break;
      case 'guards': F.ring(ev.x, ev.z, 0xffd700, 3); S('radio'); break;
      case 'heal': F.text(ev.x, 3, ev.z, '+' + ev.v, '#63c74d'); F.ring(ev.x, ev.z, 0x63c74d, 2); S('heal'); break;
      case 'smoke': S('smoke'); break;
      case 'build': F.ring(ev.x, ev.z, 0x9dff7a, 1.5); S('build'); break;
      case 'drop': S('click'); break;
      case 'shield': F.bubble(ev.x, 1.2, ev.z, 0x2ce8f5); S('shield'); break;
      case 'flameOn': S('fire'); break;
      case 'reload': if (e && e.team === this.localTeam) S('reload'); break;
      case 'reloaded': if (e && e.team === this.localTeam) S('click'); break;
      case 'death':
        S(['R', 'Q', 'A', 'L', 'T', 'U'].includes(ev.kind) ? 'boom' : 'death');
        if (this.units.size && e && e.main) { this.slowmo = 1.2; this.killX = ev.x; this.killZ = ev.z; }
        break;
    }
  }

  groundPoint(ndcX, ndcY) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const p = new THREE.Vector3();
    if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.0), p)) return p;
    return null;
  }

  localUnit() {
    if (!this.snap) return null;
    const team = this.localTeam || 'att';
    const u = this.snap.u.find((x) => x[2] === team && x[12]);
    return u ? this.units.get(u[0]) : null;
  }

  localRaw() {
    if (!this.snap) return null;
    const team = this.localTeam || 'att';
    return this.snap.u.find((x) => x[2] === team && x[12]) || null;
  }

  enemiesRaw() {
    if (!this.snap || !this.localTeam) return [];
    return this.snap.u.filter((x) => x[2] !== this.localTeam && x[8]);
  }

  update(dt) {
    if (!this.scene) return;
    this.time += dt;
    for (const [, e] of this.units) {
      if (this.interp) { const k = Math.min(1, dt * 15); e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; }
      else { e.x = e.tx; e.z = e.tz; }
      const m = e.model;
      m.position.x = e.x; m.position.z = e.z;
      if (e.ring) e.ring.position.set(e.x, 0.05, e.z);
      const ud = m.userData;
      e.recoil = Math.max(0, (e.recoil || 0) - dt * 6);
      if (ud.body && !ud.bob) {
        ud.body.rotation.y = -e.body;
        ud.aim.rotation.y = -e.aim;
        m.rotation.y = 0;
        if (e.recoil > 0) ud.aim.position.x = -0.1 - e.recoil * 0.25 * Math.cos(e.aim);
        if (e.moving) ud.body.position.y = Math.sin(this.time * 30) * 0.02;
      } else {
        m.rotation.y = -e.aim;
        if (ud.aim && ud.legs) {
          ud.aim.rotation.z = -e.recoil * 0.12;
          ud.aim.position.y = 0.7 + (e.reloading ? -0.05 : 0);
          if (ud.gun) ud.gun.rotation.z = e.reloading ? -0.8 : 0;
        }
      }
      if (ud.rotor) ud.rotor.rotation.y += dt * 30;
      if (ud.tailRotor) ud.tailRotor.rotation.z += dt * 40;
      if (ud.dish) ud.dish.rotation.y += dt * 3;
      if (ud.bob) { ud.bob.position.y = 2.4 + Math.sin(this.time * 3) * 0.12; ud.bob.rotation.z = e.moving ? -0.15 : 0; }
      if (ud.legs && e.alive) {
        if (e.moving) e.walk += dt * 12;
        const sw = e.moving ? Math.sin(e.walk) * 0.55 : 0;
        ud.legs[0].rotation.z = sw; ud.legs[1].rotation.z = -sw;
        m.position.y = e.moving ? Math.abs(Math.sin(e.walk)) * 0.06 : 0;
      }
      if (e.flags & 4 && Math.random() < dt * 12) this.fx.fireBurst ? this.fx.smoke(e.x, 1.4, e.z, 0xff8a1c, 0.25) : null;
      if (e.flags & 1 && Math.random() < dt * 4) this.fx.bubble(e.x, 1.2, e.z, 0x2ce8f5);
      if (!e.alive) {
        e.deathT += dt;
        if (['R', 'A', 'L', 'T', 'U'].includes(e.kind)) {
          if (!e.burnt) { e.burnt = true; m.traverse((c) => { if (c.isMesh) c.material = mat(0x222222); }); }
          if (Math.random() < dt * 6) this.fx.smoke(e.x, 2, e.z, 0x222222, 0.8);
        } else if (e.kind === 'Q') {
          if (ud.bob) ud.bob.position.y = Math.max(0.6, 2.4 - e.deathT * 4);
          m.rotation.y += dt * 4;
          if (!e.burnt && e.deathT > 0.5) { e.burnt = true; m.traverse((c) => { if (c.isMesh) c.material = mat(0x222222); }); }
          if (Math.random() < dt * 6) this.fx.smoke(e.x, 1.5, e.z, 0x222222, 0.8);
        } else {
          m.rotation.z = Math.min(Math.PI / 2, e.deathT * 6);
          m.position.y = -Math.min(0.3, e.deathT);
        }
        if (e.ring) e.ring.visible = false;
      }
      if (e.hpSprite) e.hpSprite.position.set(e.x, e.kind === 'Q' ? 4.6 : ['R', 'A', 'L', 'T'].includes(e.kind) ? 3.8 : 3.0, e.z);
    }
    for (const [, m] of this.obsMeshes) {
      if (m.userData.collapse > 0) {
        m.userData.collapse -= dt;
        m.userData.body.position.y = -3.4 * (1 - Math.max(0, m.userData.collapse));
        m.userData.body.rotation.z = (1 - m.userData.collapse) * 0.15;
        if (m.userData.collapse <= 0) m.userData.body.scale.y = 0.15;
      }
    }
    for (const [, m] of this.objMeshes) if (m.children.length > 3) m.rotation.y += dt * 0.2;
    const lu = this.localUnit();
    const focus = this.slowmo > 0 && this.killX !== undefined ? new THREE.Vector3(this.killX, 0, this.killZ)
      : lu ? new THREE.Vector3(lu.x + Math.cos(lu.aim) * 3, 0, lu.z + Math.sin(lu.aim) * 2) : new THREE.Vector3(0, 0, 0);
    const height = this.slowmo > 0 ? 12 : this.narrow ? 30 : 21;
    const want = new THREE.Vector3(focus.x, height, focus.z + height * 0.48);
    want.x = Math.max(-ARENA.w / 2 + 6, Math.min(ARENA.w / 2 - 6, want.x));
    this.camPos.lerp(want, Math.min(1, dt * (this.slowmo > 0 ? 3 : 5)));
    if (this.slowmo > 0) this.slowmo -= dt;
    if (this.shake > 0) {
      this.shake -= dt;
      this.camPos.x += (Math.random() - 0.5) * this.shake * 1.5;
      this.camPos.z += (Math.random() - 0.5) * this.shake * 1.5;
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camPos.x, 0, this.camPos.z - height * 0.48);
    if (lu && lu.alive && this.localTeam) {
      const len = lu.kind === 'B' ? 18 : 8;
      this.laser.visible = true;
      this.laser.scale.x = len;
      this.laser.position.set(lu.x + Math.cos(lu.aim) * len / 2, 1.2, lu.z + Math.sin(lu.aim) * len / 2);
      this.laser.rotation.y = -lu.aim;
      this.reticle.visible = true;
      this.reticle.position.set(lu.x + Math.cos(lu.aim) * len, 0.08, lu.z + Math.sin(lu.aim) * len);
    } else { this.laser.visible = false; this.reticle.visible = false; }
    this.fx.update(dt);
  }

  dispose() {
    if (!this.scene) return;
    this.scene.traverse((o) => {
      if (o.geometry && !o.geometry.parameters) o.geometry.dispose();
      if (o.material && o.material.map && o.material.map.isCanvasTexture) o.material.map.dispose();
    });
    this.scene = null;
    this.units = new Map();
  }
}
