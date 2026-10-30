// 3D view of a real-time duel arena.
import * as THREE from 'three';
import { unitModel, makeObstacle, makeTree, TEAM_COLORS, mat } from './models.js';
import { FX } from './fx.js';
import { genArena, ARENA } from './duel.js';

const THEME_COL = {
  field: { ground: 0x5f7a3c, sky: 0xa8cde0, dirt: 0x6b5a3c },
  desert: { ground: 0xc9ac74, sky: 0xe6d5b0, dirt: 0xb08f58 },
  winter: { ground: 0xdfe6ea, sky: 0xc5d3dc, dirt: 0xa9b4ba },
  ruins: { ground: 0x6c6a62, sky: 0x9aa3a8, dirt: 0x55524a },
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

  start(rt, localTeam, sound) {
    this.rt = rt;
    this.localTeam = localTeam; // 'att' | 'def' | null (spectator)
    this.sound = sound || (() => {});
    const arena = genArena(rt.seed);
    this.theme = arena.theme;
    const T = THEME_COL[arena.theme];
    const s = new THREE.Scene();
    this.scene = s;
    s.background = new THREE.Color(T.sky);
    s.fog = new THREE.Fog(T.sky, 40, 90);
    s.add(new THREE.HemisphereLight(0xffffff, 0x554433, 1.0));
    const sun = new THREE.DirectionalLight(0xfff0d0, 1.7);
    sun.position.set(-12, 30, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 18, bottom: -18, near: 1, far: 80 });
    s.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA.w + 60, ARENA.d + 60), mat(T.ground));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    s.add(ground);
    // patches / craters
    for (let i = 0; i < 18; i++) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(1 + Math.random() * 2.5, 10), mat(T.dirt));
      p.rotation.x = -Math.PI / 2;
      p.position.set((Math.random() - 0.5) * ARENA.w, 0.02, (Math.random() - 0.5) * ARENA.d);
      p.receiveShadow = true;
      s.add(p);
    }
    // border fences
    const fenceMat = mat(0x5a4a35);
    for (const z of [-ARENA.d / 2 - 0.3, ARENA.d / 2 + 0.3]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(ARENA.w + 0.6, 0.8, 0.25), fenceMat);
      f.position.set(0, 0.4, z);
      s.add(f);
    }
    for (const x of [-ARENA.w / 2 - 0.3, ARENA.w / 2 + 0.3]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.8, ARENA.d + 0.6), fenceMat);
      f.position.set(x, 0.4, 0);
      s.add(f);
    }
    // team spawn flags
    for (const [team, x] of [['att', -ARENA.w / 2 + 1.5], ['def', ARENA.w / 2 - 1.5]]) {
      const side = rt[team].s;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.5, 5), mat(0xcccccc));
      pole.position.set(x, 1.75, -ARENA.d / 2 + 1.5);
      s.add(pole);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 0.05), mat(TEAM_COLORS[side].main));
      flag.position.set(x + 0.65, 3.0, -ARENA.d / 2 + 1.5);
      s.add(flag);
    }
    this.obsMeshes = new Map();
    for (const o of arena.obs) {
      const m = makeObstacle(o, arena.theme);
      m.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
      s.add(m);
      this.obsMeshes.set(o.id, m);
    }
    for (const d of arena.deco) {
      const t = makeTree(d.s * 1.3, arena.theme === 'winter', arena.theme === 'desert');
      t.position.set(d.x, 0, d.z);
      s.add(t);
    }
    this.fx = new FX(s);
    this.units = new Map();
    this.projPool = [];
    this.projGroup = new THREE.Group();
    s.add(this.projGroup);
    // aim laser
    this.laser = new THREE.Mesh(new THREE.BoxGeometry(1, 0.04, 0.04), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.55 }));
    s.add(this.laser);
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 16), new THREE.MeshBasicMaterial({ color: 0xff4040, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
    this.reticle.rotation.x = -Math.PI / 2;
    s.add(this.reticle);
    this.camPos = new THREE.Vector3(localTeam === 'def' ? ARENA.w / 2 - 6 : -ARENA.w / 2 + 6, 22, 12);
    this.snap = null;
    this.time = 0;
  }

  side(team) { return this.rt[team].s; }

  hpSprite(e, hp, maxHp, main) {
    const key = Math.ceil(hp) + '/' + maxHp;
    if (e.hpKey === key) return;
    e.hpKey = key;
    const c = e.hpCanvas || (e.hpCanvas = document.createElement('canvas'));
    c.width = 128; c.height = 24;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 128, 24);
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(0, 4, 128, 16);
    const f = Math.max(0, hp / maxHp);
    g.fillStyle = e.team === this.localTeam ? '#5ce65c' : '#ff4d4d';
    if (!this.localTeam) g.fillStyle = TEAM_COLORS[this.side(e.team)].hex;
    g.fillRect(2, 6, 124 * f, 12);
    if (!e.hpSprite) {
      e.hpTex = new THREE.CanvasTexture(c);
      e.hpSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: e.hpTex, depthTest: false }));
      e.hpSprite.scale.set(main ? 2.6 : 1.6, main ? 0.5 : 0.32, 1);
      e.hpSprite.renderOrder = 5;
      this.scene.add(e.hpSprite);
    } else e.hpTex.needsUpdate = true;
  }

  // snap from DuelSim.snapshot()
  apply(snap, interpolate) {
    this.snap = snap;
    this.interp = interpolate;
    for (const u of snap.u) {
      const [id, kind, team, x, z, aim, hp, maxHp, alive, body, moving, , main] = u;
      let e = this.units.get(id);
      if (!e) {
        const model = unitModel(kind === 'A' ? 'A' : kind, this.side(team), 'duel');
        const scale = kind === 'R' || kind === 'Q' ? 1 : 1.25;
        model.scale.setScalar(scale);
        model.traverse((c) => { if (c.isMesh) c.castShadow = true; });
        this.scene.add(model);
        e = { model, kind, team, x, z, tx: x, tz: z, aim, body, alive: true, walk: 0 };
        // selection ring
        const ring = new THREE.Mesh(new THREE.RingGeometry(kind === 'R' ? 1.7 : kind === 'Q' ? 1.6 : 0.8, kind === 'R' ? 1.95 : kind === 'Q' ? 1.85 : 0.98, 24),
          new THREE.MeshBasicMaterial({ color: TEAM_COLORS[this.side(team)].main, side: THREE.DoubleSide, transparent: true, opacity: main ? 0.9 : 0.45 }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.05;
        model.add(ring);
        ring.userData.counterRotate = true;
        e.ring = ring;
        model.position.set(x, 0, z);
        this.units.set(id, e);
      }
      e.tx = x; e.tz = z; e.aim = aim; e.body = body; e.moving = moving;
      if (!interpolate) { e.x = x; e.z = z; }
      e.main = main;
      if (e.alive && !alive) {
        e.alive = false;
        e.deathT = 0;
        if (e.hpSprite) e.hpSprite.visible = false;
      }
      if (alive) this.hpSprite(e, hp, maxHp, main);
    }
    for (const id of snap.od || []) {
      const m = this.obsMeshes.get(id);
      if (m) { m.visible = false; }
    }
    // projectiles
    while (this.projPool.length < snap.p.length) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
      this.projGroup.add(m);
      this.projPool.push(m);
    }
    this.projPool.forEach((m, i) => {
      const p = snap.p[i];
      if (!p) { m.visible = false; return; }
      m.visible = true;
      const [x, z, kind, a] = p;
      m.position.set(x, kind === 'g' ? 0.8 : 1.2, z);
      m.rotation.set(0, -a, 0);
      if (kind === 'b') { m.scale.set(0.7, 0.07, 0.07); m.material.color.setHex(0xffe066); }
      else if (kind === 's') { m.scale.set(2.5, 0.08, 0.08); m.material.color.setHex(0xffffff); }
      else if (kind === 'c') { m.scale.set(0.6, 0.25, 0.25); m.material.color.setHex(0xffaa33); }
      else if (kind === 'r') { m.scale.set(0.8, 0.18, 0.18); m.material.color.setHex(0xff6633); if (Math.random() < 0.5) this.fx.smoke(x, 1.2, z, 0x999999, 0.3); }
      else if (kind === 'g') { m.scale.set(0.3, 0.3, 0.3); m.material.color.setHex(0x334422); }
    });
    for (const ev of snap.ev || []) this.event(ev);
  }

  event(ev) {
    const F = this.fx, S = this.sound;
    switch (ev.k) {
      case 'shot': {
        const big = ev.w === 's' || ev.w === 'c';
        F.muzzle(ev.x, 1.2, ev.z, big ? 0.6 : 0.3);
        S(ev.w === 's' ? 'sniper' : ev.w === 'c' ? 'cannon' : ev.w === 'r' ? 'rocket' : 'shot', ev.team === this.localTeam ? 1 : 0.6);
        break;
      }
      case 'boom': F.explosion(ev.x, 0.3, ev.z, Math.max(1, ev.r * 0.5)); S('boom'); this.shake = Math.max(this.shake || 0, 0.25); break;
      case 'hit': {
        const e = [...this.units.values()].find((u) => u.tx === ev.x && u.tz === ev.z);
        if (e && (e.kind === 'R' || e.kind === 'Q')) F.spark(ev.x, 1.2, ev.z); else F.blood(ev.x, ev.z);
        S('hit', 0.5);
        break;
      }
      case 'spark': F.spark(ev.x, 1.1, ev.z); break;
      case 'debris': F.explosion(ev.x, 0.3, ev.z, ev.kind === 'barrel' ? 1.8 : 0.8); S(ev.kind === 'barrel' ? 'boom' : 'crate'); break;
      case 'mark': F.ring(ev.x, ev.z, 0xff2020, 4, 1.6); S('radio'); break;
      case 'dash': F.ring(ev.x, ev.z, 0xffffff, 1.5, 0.3); S('dash'); break;
      case 'throw': S('throw'); break;
      case 'guards': F.ring(ev.x, ev.z, 0xffd700, 3); S('radio'); break;
      case 'death': S(ev.kind === 'R' || ev.kind === 'Q' ? 'boom' : 'death'); break;
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

  update(dt) {
    if (!this.scene) return;
    this.time += dt;
    for (const [, e] of this.units) {
      if (this.interp) {
        const k = Math.min(1, dt * 15);
        e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k;
      } else { e.x = e.tx; e.z = e.tz; }
      const m = e.model;
      m.position.x = e.x; m.position.z = e.z;
      const ud = m.userData;
      if (e.kind === 'R') {
        ud.body.rotation.y = -e.body;
        ud.aim.rotation.y = -e.aim;
        m.rotation.y = 0;
      } else {
        m.rotation.y = -e.aim;
      }
      if (ud.rotor) ud.rotor.rotation.y += dt * 30;
      if (ud.bob) ud.bob.position.y = 2.4 + Math.sin(this.time * 3) * 0.12;
      if (ud.legs && e.alive) {
        if (e.moving) e.walk += dt * 12;
        const sw = e.moving ? Math.sin(e.walk) * 0.5 : 0;
        // legs swing in direction of movement relative to aim
        ud.legs[0].rotation.z = sw; ud.legs[1].rotation.z = -sw;
      }
      if (e.ring) e.ring.rotation.z = 0;
      if (!e.alive) {
        e.deathT += dt;
        if (e.kind === 'R') {
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
      if (e.hpSprite) e.hpSprite.position.set(e.x, e.kind === 'Q' ? 4.6 : e.kind === 'R' ? 3.6 : 3.0, e.z);
    }
    // camera follow
    const lu = this.localUnit();
    const focus = lu ? new THREE.Vector3(lu.x + Math.cos(lu.aim) * 3, 0, lu.z + Math.sin(lu.aim) * 2) : new THREE.Vector3(0, 0, 0);
    const height = this.narrow ? 30 : 21;
    const want = new THREE.Vector3(focus.x, height, focus.z + height * 0.48);
    want.x = Math.max(-ARENA.w / 2 + 8, Math.min(ARENA.w / 2 - 8, want.x));
    this.camPos.lerp(want, Math.min(1, dt * 5));
    if (this.shake > 0) {
      this.shake -= dt;
      this.camPos.x += (Math.random() - 0.5) * this.shake * 1.5;
      this.camPos.z += (Math.random() - 0.5) * this.shake * 1.5;
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camPos.x, 0, this.camPos.z - height * 0.48);
    // laser
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
      if (o.material && o.material.map) o.material.map.dispose();
    });
    this.scene = null;
    this.units = new Map();
  }
}
