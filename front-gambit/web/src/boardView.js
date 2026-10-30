// 3D strategic board view with environment, effects and cinematic camera shots.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TILE, sqToWorld, worldToSq } from './rng.js';
import { unitModel, makeDrone, makeKeypoint, makeBuilding, setNightWindows, TEAM_COLORS, mat, tex, bake, flatten, makeForest } from './models.js';
import { makeSky, applyLights, makeClouds, makeTerrain, scatterGrass, scatterRocks, makeWater, updateWind, updateWater, fbm } from './world.js';
import { plotPos, PLOTS, BUILDINGS } from './city.js';
import { FX } from './fx.js';
import { territory, supplyMap, rc, unitDef } from './rules.js';
import { hasPassive } from './core.js';
import { A, img } from './assets.js';
import { ABILITIES } from './abilities.js';

const CINE_SLOW = 1.7;
// time of day: city fights are overcast, field battles happen by day or at sunset, blackouts are at night
export function lightPreset(state) {
  if (state.effects && state.effects.blackout > 0) return 'night';
  if (state.map === 'city') return 'overcast';
  return (state.seed || 0) % 3 === 0 ? 'sunset' : 'day';
}
// how a piece moves when it uses an ability
const ABILITY_ANIM = {
  shell: 'recoil', snipe: 'recoil', rockets: 'recoil', grad: 'recoil', barrage: 'recoil', flak: 'recoil', broadside: 'recoil',
  smoke: 'recoil', gas: 'recoil', napalm: 'recoil', arty: 'cast', recon: 'cast', mark: 'cast', hack: 'cast', terror: 'cast', emp: 'cast',
  ram: 'lunge', raid: 'lunge', hook: 'lunge', loot: 'lunge', propaganda: 'lunge',
  dig: 'dig', fortify: 'dig', trenchline: 'dig', laymine: 'dig', buildrail: 'dig', demine: 'dig', ambush: 'dig', cutrail: 'dig',
  march: 'hop', paradrop: 'hop', swap: 'hop', inspire: 'hop', rally: 'hop', overdrive: 'spin', kamikaze: 'spin',
};
// targeted abilities that get an over-the-shoulder camera (area strikes already have their own shots)
const SHOULDER = new Set(['shell', 'snipe', 'raid', 'ram', 'hook', 'hack', 'terror', 'mark', 'propaganda', 'napalm', 'gas', 'emp', 'smoke', 'recon', 'cutrail', 'heal', 'supplydrop']);

const HL_COLORS = { move: 0x4cff6a, capture: 0xff3b30, rail: 0x3fb6ff, metro: 0xd64bff, target: 0xffc93c, select: 0xffffff, last: 0xffe9a0, area: 0x7fb8ff };

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
    this.cityView = null;
    this.occluders = [];
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
    this.labelPlane = new THREE.Mesh(new THREE.PlaneGeometry(42, 42), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
    this.labelPlane.rotation.x = -Math.PI / 2;
    this.labelPlane.position.y = 0.22;
    s.add(this.labelPlane);
    this.labelTex = { w: this.makeLabelTexture('w'), b: this.makeLabelTexture('b') };
    this.labelPlane.material.map = this.labelTex.w;
    this.cityGroup = new THREE.Group();
    s.add(this.cityGroup);
    this.cityMeshes = { w: new Array(PLOTS).fill(null), b: new Array(PLOTS).fill(null) };
    this.plotPads = [];
    const padGeo = new THREE.PlaneGeometry(8.4, 5);
    for (const side of ['w', 'b']) for (let i = 0; i < PLOTS; i++) {
      const p = plotPos(side, i);
      const pad = new THREE.Mesh(padGeo, new THREE.MeshBasicMaterial({ color: 0xfee761, transparent: true, opacity: 0.0, depthWrite: false }));
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(p.x, -0.3, p.z);
      pad.userData = { side, plot: i };
      s.add(pad);
      this.plotPads.push(pad);
      const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(8.2, 0.02, 4.8)), new THREE.LineBasicMaterial({ color: 0x8a8a7a, transparent: true, opacity: 0.6 }));
      frame.position.set(p.x, -0.32, p.z);
      s.add(frame);
      pad.userData.frame = frame;
    }
    for (const name of ['railGroup', 'frontGroup', 'mineGroup', 'terrainGroup', 'kpGroup', 'sqfxGroup', 'lootGroup']) {
      this[name] = new THREE.Group();
      s.add(this[name]);
    }
    this.snow = null;
  }

  // environment differs per map and time of day
  buildEnvironment(map, preset) {
    const key = map + preset;
    if (this.envKey === key) return;
    this.envKey = key;
    this.map = map;
    this.preset = preset;
    const g = this.envGroup;
    g.clear();
    const stat = new THREE.Group(); // static props, merged into a few draw calls at the end
    const city = map === 'city';
    applyLights(this.scene, this.hemi, this.sun, preset);
    this.baseI = { sun: this.sun.intensity, hemi: this.hemi.intensity };
    g.add(makeSky(preset));
    this.clouds = makeClouds(14, 160, 48, preset === 'night' || preset === 'overcast');
    g.add(this.clouds);
    const inRear = (x, z) => Math.abs(x) < 29 && Math.abs(z) > 16 && Math.abs(z) < 32;
    const flat = (x, z) => {
      if (!city && Math.abs(x - 34) < 7) return 0; // river bed
      const d = Math.max(Math.abs(x) / 34, Math.abs(z) / 36);
      return Math.max(0, Math.min(1, (d - 1) * 1.6));
    };
    const hill = city ? 0 : 9;
    const ground = makeTerrain({ base: city ? 0x9a9a9a : 0x86a066, texName: city ? 'tex_asphalt' : 'tex_grass', repeat: city ? 30 : 46, hill, flatMask: flat });
    g.add(ground);
    const heightAt = (x, z) => -0.4 + flat(x, z) * (fbm(x * 0.03, z * 0.03) * hill + Math.max(0, (Math.hypot(x, z) - 90) * 0.12));
    this.tileMat.map = tex(city ? 'tex_cobble' : 'tex_dirt', 1);
    this.tileMat.needsUpdate = true;
    for (const dir of [1, -1]) {
      const zone = new THREE.Mesh(new THREE.PlaneGeometry(56, 14), mat(0xb8b4a8, { map: tex('tex_concrete', 6) }));
      zone.rotation.x = -Math.PI / 2;
      zone.position.set(0, -0.37, dir * 24.4);
      zone.receiveShadow = true;
      stat.add(zone);
      this.trackLine(-28, dir * 18.6, 28, dir * 18.6, -0.35, g);
      for (let k = 0; k < 3; k++) {
        const wag = new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 1.3), mat(k % 2 ? 0x6b4a3a : 0x55603d, { map: tex('tex_metal', 1) }));
        wag.position.set(18 + k * 3.3, 0.4, dir * 18.6);
        wag.castShadow = true;
        stat.add(wag);
      }
      // fence around the rear city
      const fence = new THREE.Mesh(new THREE.BoxGeometry(56, 0.9, 0.12), mat(0x6a6a5a, { map: tex('tex_metal', 4) }));
      fence.position.set(0, 0.05, dir * 31.4);
      stat.add(fence);
    }
    for (const sx of [-1, 1]) {
      for (let z = -12; z <= 12; z += 3) {
        const hh = new THREE.Group();
        for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.12), mat(0x3a3a3a)); b.rotation.set(k * 1.05, k * 0.8, 0.6); hh.add(b); }
        hh.position.set(sx * 19, 0.2, z + (Math.random() - 0.5));
        stat.add(hh);
      }
      const wire = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.03, 4, 10), mat(0x777777));
      for (let z = -14; z <= 14; z += 0.6) { const w = wire.clone(); w.position.set(sx * 20.5, 0.25, z); w.rotation.y = Math.PI / 2; stat.add(w); }
    }
    const avoid = (x, z) => (Math.abs(x) < 21 && Math.abs(z) < 18) || inRear(x, z) || (!city && x > 29 && x < 39);
    if (city) {
      for (let i = 0; i < 60; i++) {
        const a = Math.random() * Math.PI * 2, r = 34 + Math.random() * 50;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (Math.abs(z) < 34 && Math.abs(x) < 30) continue;
        const h = 5 + Math.random() * 16;
        const w = 5 + Math.random() * 4, d = 5 + Math.random() * 4;
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat([0xc8c0b4, 0xa8b0b8, 0xd8c8a8][i % 3], { map: tex(i % 2 ? 'tex_concrete' : 'tex_brick', 2) }));
        b.position.set(x, h / 2 - 0.4, z);
        b.castShadow = true;
        b.receiveShadow = true;
        stat.add(b);
        // lit windows on the facade facing the board
        for (let f = 1; f < h - 1; f += 1.6) {
          const win = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, 0.35), mat(0xffd27a, { emissive: preset === 'night' ? 0xffa030 : 0x3a2a10 }));
          const toC = Math.atan2(-x, -z);
          win.position.set(x + Math.sin(toC) * (d / 2 + 0.02), f, z + Math.cos(toC) * (d / 2 + 0.02));
          win.rotation.y = toC;
          if (Math.random() < 0.7) stat.add(win);
        }
      }
      for (const z of [-33, 33]) for (let x = -24; x <= 24; x += 8) {
        const lamp = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4, 6), mat(0x333333)); pole.position.y = 1.6; lamp.add(pole);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.0, 1.4) })); head.position.set(0.3, 3.6, 0); lamp.add(head);
        lamp.position.set(x, -0.4, z);
        stat.add(lamp);
      }
      g.add(scatterRocks({ count: 40, area: 100, avoid, heightAt: () => -0.4, color: 0x7a7670 }));
    } else {
      const green = [], dry = [];
      for (let i = 0; i < 170; i++) {
        const a = Math.random() * Math.PI * 2, r = 26 + Math.random() * 75;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (avoid(x, z) || (x > 27 && x < 41)) continue;
        (preset === 'sunset' && Math.random() < 0.3 ? dry : green).push({ x, y: heightAt(x, z) - 0.1, z, s: 0.9 + Math.random() * 1.4 });
      }
      g.add(makeForest(green, 'green'));
      if (dry.length) g.add(makeForest(dry, 'dry'));
      const river = makeWater(8, 300);
      river.position.set(34, -0.32, 0);
      g.add(river);
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(10, 0.4, 4), mat(0x7a6a55, { map: tex('tex_wood', 2) }));
      bridge.position.set(34, 0, 0);
      bridge.castShadow = true;
      stat.add(bridge);
      for (const x of [29.5, 38.5]) for (const z of [-1.8, 1.8]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, 0.3), mat(0x5a4a3a)); post.position.set(x, 0.5, z); stat.add(post);
      }
      for (const [x, z] of [[-36, 8], [-40, -14], [46, 22], [48, -26]]) {
        const h = new THREE.Group();
        const w = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 4), mat(0xd8c8a8, { map: tex('tex_brick', 1) })); w.position.y = 1.1; h.add(w);
        const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 3.4, 2, 4), mat(0x8a3b2a, { map: tex('tex_roof', 1) })); roof.position.y = 3.6; roof.rotation.y = Math.PI / 4; h.add(roof);
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.7), mat(0xffd27a, { emissive: preset === 'night' ? 0xffa030 : 0x3a2a10 })); win.position.set(0, 1.4, 2.01); h.add(win);
        h.position.set(x, heightAt(x, z), z);
        h.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        stat.add(h);
      }
      for (let i = 0; i < 14; i++) {
        const hay = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1, 12), mat(0xd9b45a));
        hay.rotation.z = Math.PI / 2;
        const x = -30 - Math.random() * 16, z = -30 + Math.random() * 60;
        hay.position.set(x, heightAt(x, z) + 0.6, z);
        hay.castShadow = true;
        stat.add(hay);
      }
      g.add(scatterGrass({ count: this.lowGfx ? 900 : 2600, area: 95, avoid, heightAt }));
      g.add(scatterRocks({ count: 70, area: 100, avoid, heightAt }));
    }
    flatten(stat);
    g.add(stat);
    setNightWindows(preset === 'night');
  }

  // board coordinates painted on one texture (flipped for the red player's camera)
  makeLabelTexture(side) {
    const N = 1024, c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.font = '34px "Press Start 2P", monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const px = (x) => (x / 42 + 0.5) * N;
    const put = (txt, x, z) => {
      g.save();
      g.translate(px(x), px(z));
      if (side === 'b') g.rotate(Math.PI);
      g.fillText(txt, 0, 0);
      g.restore();
    };
    const E = 17.75;
    for (let c2 = 0; c2 < 8; c2++) { const x = (c2 - 3.5) * TILE; put('abcdefgh'[c2], x, E); put('abcdefgh'[c2], x, -E); }
    for (let r = 0; r < 8; r++) { const z = (3.5 - r) * TILE; put(String(r + 1), -E, z); put(String(r + 1), E, z); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
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
    if (this.labelPlane) { this.labelPlane.material.map = this.labelTex[side === 'b' ? 'b' : 'w']; this.labelPlane.material.needsUpdate = true; }
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
    if (!this.cineEnabled || this.cityView) return;
    const now = this.time;
    if (this.shots.length > 4) return;
    let t = this.shots.length ? this.shots[this.shots.length - 1].end : now;
    for (const sh of shots) {
      const dur = sh.dur * CINE_SLOW;
      this.shots.push({ ...sh, dur, start: t, end: t + dur });
      t += dur;
    }
  }

  // board props that would hide the action become see-through while a cutscene plays
  setOccludersFaded(on) {
    if (this.occFaded === on) return;
    this.occFaded = on;
    for (const grp of [this.terrainGroup, this.kpGroup, this.lootGroup]) {
      grp.traverse((o) => {
        if (!o.isMesh) return;
        if (!o.userData.fadeMat) { o.userData.baseMat = o.material; o.userData.fadeMat = o.material.clone(); o.userData.fadeMat.transparent = true; o.userData.fadeMat.opacity = 0.28; o.userData.fadeMat.depthWrite = false; }
        o.material = on ? o.userData.fadeMat : o.userData.baseMat;
      });
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

  enterCity(side) { this.cityView = side; this.shots = []; }
  exitCity() { this.cityView = null; this.lookCur = this.camera.position.clone().add(new THREE.Vector3(0, -10, this.viewSide === 'w' ? -10 : 10)); }

  pickPlot(ndcX, ndcY) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hit = ray.intersectObjects(this.plotPads, false)[0];
    return hit ? hit.object.userData : null;
  }

  updateCamera() {
    if (this.cityView) {
      const dir = this.cityView === 'w' ? 1 : -1;
      const want = new THREE.Vector3(0, 20, dir * 47);
      const look = new THREE.Vector3(0, 0, dir * 23);
      this.camera.position.lerp(want, 0.06);
      this.lookCur = this.lookCur ? this.lookCur.lerp(look, 0.06) : look.clone();
      this.camera.lookAt(this.lookCur);
      this.onCine(false);
      return;
    }
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
    this.setOccludersFaded(!!shot);
    if (shot) {
      const k = (this.time - shot.start) / shot.dur;
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const p = shot.pos2 ? shot.pos.clone().lerp(shot.pos2, e) : shot.pos;
      this.camera.position.lerp(p, shot.cut ? 1 : 0.07);
      const look = shot.look2 ? shot.look.clone().lerp(shot.look2, e) : shot.look;
      this.lookCur = this.lookCur ? this.lookCur.lerp(look, 0.08) : look.clone();
      this.camera.lookAt(this.lookCur);
      return;
    }
    const t = this.camTarget;
    const h = Math.sin(this.camPitch) * this.camDist;
    const back = Math.cos(this.camPitch) * this.camDist;
    const want = new THREE.Vector3(t.x + Math.sin(this.camAz) * back, h, t.z + Math.cos(this.camAz) * back);
    if (this.lookCur) {
      this.camera.position.lerp(want, 0.07);
      this.lookCur.lerp(t, 0.07);
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
      m.material.opacity = h.kind === 'select' ? 0.55 : h.kind === 'last' ? 0.22 : h.kind === 'area' ? 0.2 : 0.45;
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
    this.buildEnvironment(state.map, lightPreset(state));
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
    this.syncCity(state);
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
      try { this.playFx(e, state); } catch (err) { console.error('fx', e.k, err); }
    }
  }

  syncCity(state) {
    if (!state.city) return;
    for (const side of ['w', 'b']) {
      for (let i = 0; i < PLOTS; i++) {
        const b = state.city[side][i];
        const key = b ? `${b.type}|${b.lvl}|${b.build > 0 ? 1 : 0}` : '';
        const cur = this.cityMeshes[side][i];
        if ((cur ? cur.userData.key : '') === key) continue;
        if (cur) this.cityGroup.remove(cur);
        this.cityMeshes[side][i] = null;
        if (!b) continue;
        const m = makeBuilding(b.type, b.build > 0 ? b.lvl : b.lvl, side, b.build > 0);
        const p = plotPos(side, i);
        m.position.set(p.x, -0.38, p.z);
        m.rotation.y = side === 'w' ? Math.PI : 0;
        m.userData.key = key;
        m.userData.type = b.type;
        this.cityGroup.add(m);
        this.cityMeshes[side][i] = m;
      }
    }
    this.cityState = state.city;
  }

  // highlight plots in city mode: mine = side whose city is shown
  setCityHighlight(side, sel) {
    for (const pad of this.plotPads) {
      const own = pad.userData.side === side;
      pad.userData.hl = own ? (pad.userData.plot === sel ? 2 : 1) : 0;
      pad.userData.frame.material.opacity = own ? 0.9 : 0.35;
      pad.userData.frame.material.color.setHex(own ? 0xfee761 : 0x8a8a7a);
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
    flatten(this.kpGroup, new Set(this.kpModels.map((m) => m.userData.beam || m.userData.dish).filter(Boolean)));
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
    const key = terr.join(',');
    if (key === this.frontKey) return;
    this.frontKey = key;
    this.frontGroup.clear();
    if (!this.frontMat) this.frontMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.25, 0.25), transparent: true, opacity: 0.9 });
    const parts = [];
    for (let i = 0; i < 64; i++) {
      const [r, c] = rc(i);
      const w = sqToWorld(i);
      if (c < 7 && terr[i] !== terr[i + 1] && (terr[i] || terr[i + 1])) parts.push(new THREE.BoxGeometry(0.22, 0.14, TILE).translate(w.x + TILE / 2, 0.37, w.z));
      if (r < 7 && terr[i] !== terr[i + 8] && (terr[i] || terr[i + 8])) parts.push(new THREE.BoxGeometry(TILE, 0.14, 0.22).translate(w.x, 0.37, w.z - TILE / 2));
    }
    if (parts.length) this.frontGroup.add(new THREE.Mesh(mergeGeometries(parts.map((g) => g.toNonIndexed()), false), this.frontMat));
  }

  setCheck(sq) {
    if (sq < 0) { if (this.checkRing) { this.scene.remove(this.checkRing); this.checkRing = null; } return; }
    if (!this.checkRing) {
      this.checkRing = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.0, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.4, 0.3), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      this.checkRing.rotation.x = -Math.PI / 2;
      this.scene.add(this.checkRing);
    }
    const w = sqToWorld(sq);
    this.checkRing.position.set(w.x, 0.42, w.z);
  }

  updateLighting(state) {
    const night = state.effects && state.effects.blackout > 0;
    this.night = night;
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
      case 'dmg': { const p = W(e.sq, 3.6); F.text(p.x, p.y, p.z, '-' + e.v); const ent = this.entryAt(e.sq); if (ent) ent.hitT = 0.45; break; }
      case 'ability': {
        const ent = (e.pid !== undefined && this.pieceMeshes.get(e.pid)) || this.entryAt(e.sq);
        const a = W(e.sq, 0);
        const tgt = e.to !== undefined && e.to !== null && e.to >= 0 && e.to !== e.sq ? W(e.to, 0) : null;
        if (ent) {
          if (tgt) { ent.aimFace = Math.atan2(-(tgt.z - a.z), tgt.x - a.x); ent.aimT = 2.2; }
          ent.anim = { kind: ABILITY_ANIM[e.ab] || 'cast', t: 0, dur: 0.8, delay: tgt ? 0.25 : 0 };
        }
        const name = ABILITIES[e.ab] ? ABILITIES[e.ab].name.toUpperCase() : '';
        F.text(a.x, 5.6, a.z, name, '#fee761', 2.2);
        F.ring(a.x, a.z, TEAM_COLORS[e.side] ? TEAM_COLORS[e.side].main : 0xfee761, 2.4, 0.7);
        if (tgt) {
          F.ring(tgt.x, tgt.z, 0xfee761, 2.2, 1.1);
          if (SHOULDER.has(e.ab)) {
            const dir = tgt.clone().sub(a).normalize();
            const off = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(2.6);
            const cam = a.clone().addScaledVector(dir, -9).add(off).setY(6.5);
            this.cinematic([{ pos: cam, pos2: cam.clone().addScaledVector(dir, 3), look: a.clone().lerp(tgt, 0.55).setY(1), dur: 1.25 }]);
          }
        }
        break;
      }
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
        const go = () => {
          S(e.k === 'snipe' ? 'sniper' : 'cannon');
          F.muzzle(a.x, a.y, a.z, e.k === 'snipe' ? 0.6 : 1.3);
          F.tracer(a, b, e.k === 'snipe' ? 0xffffff : 0xffcc66, e.k === 'snipe' ? 0.12 : 0.22, 0.35);
          F.smoke(a.x, a.y, a.z, 0x8a8a8a, 0.6);
          if (e.k === 'shell') setTimeout(() => this.boom(b, 1.5), 120);
          else { F.spark(b.x, b.y, b.z, 0xff4444); F.blood(b.x, b.z); }
          this.kick = 0.35;
        };
        if (this.cineEnabled && !this.cityView) setTimeout(go, 650); else go();
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
        const pos = plotPos(en, e.plot >= 0 ? e.plot : 2);
        this.nightFlash = 2.6;
        this.cinematic([{ pos: new THREE.Vector3(pos.x + 9, 6, pos.z + (en === 'b' ? 11 : -11)), pos2: new THREE.Vector3(pos.x + 5, 4, pos.z + (en === 'b' ? 8 : -8)), look: new THREE.Vector3(pos.x, 1, pos.z), dur: 2 }]);
        S('sneak');
        break;
      }
      case 'cityBuild': case 'cityDone': {
        const pos = plotPos(e.side, e.plot);
        const v = new THREE.Vector3(pos.x, 0, pos.z);
        F.ring(pos.x, pos.z, e.k === 'cityDone' ? 0xfee761 : 0x9dff7a, 5, 1.2);
        for (let k = 0; k < 6; k++) F.dust(pos.x + (Math.random() - 0.5) * 6, pos.z + (Math.random() - 0.5) * 3, 0xb0a890);
        if (e.k === 'cityDone') F.text(pos.x, 6, pos.z, BUILDINGS[e.type] ? BUILDINGS[e.type].name.toUpperCase() : '', '#fee761');
        if (!this.cityView) this.cinematic([this.orbitShot(v, 14, 9, 1.6, e.side === 'w' ? 0.3 : Math.PI + 0.3)]);
        S(e.k === 'cityDone' ? 'rank' : 'build');
        break;
      }
      case 'bldHit': case 'bldBoom': {
        const pos = plotPos(e.side, e.plot);
        this.boom(new THREE.Vector3(pos.x, 1, pos.z), e.k === 'bldBoom' ? 3.2 : 1.6);
        if (e.k === 'bldBoom') {
          F.cloud(pos.x, pos.z, 0x8a8070);
          this.cinematic([{ pos: new THREE.Vector3(pos.x + 9, 8, pos.z + (e.side === 'w' ? 13 : -13)), look: new THREE.Vector3(pos.x, 1, pos.z), dur: 1.8 }]);
        }
        break;
      }
      case 'support': {
        const a = W(e.from, 1.5), b = W(e.to, 1.5);
        F.beam(a, b, e.side === 'w' ? 0x9cc2ff : e.side === 'b' ? 0xffa494 : 0xdddddd, 2.4);
        F.ring(a.x, a.z, 0xfee761, 2.4, 1.6);
        S('radio');
        break;
      }
      case 'evac': { const p = W(e.sq, 0); F.text(p.x, 4.5, p.z, 'ЭВАКУИРОВАН', '#9cc2ff'); F.ring(p.x, p.z, 0x9cc2ff, 3, 1); break; }
      case 'decoy': { const p = W(e.sq, 0); F.text(p.x, 4, p.z, 'ЛОЖНАЯ ЦЕЛЬ', '#c0cbdc'); break; }
      case 'resist': { const p = W(e.sq, 3); F.text(p.x, p.y, p.z, 'НЕ СЛОМЛЕН', '#c0cbdc'); break; }
      case 'card': S('card'); break;
      case 'b2ready': S('alarm'); break;
      case 'duel': {
        const a = W(e.from, 1.5), b = W(e.to, 1.5);
        const mid = a.clone().lerp(b, 0.5);
        const side = new THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(7);
        if (e.sup) this.cinematic([{ pos: mid.clone().add(side.clone().multiplyScalar(1.8)).setY(11), look: mid, dur: 1.0 }]);
        this.cinematic([{ pos: mid.clone().add(side).setY(4), pos2: mid.clone().add(side.multiplyScalar(0.6)).setY(3), look: a, look2: b, dur: 1.3 }]);
        break;
      }
    }
  }

  pieceAt(i) { const e = this.entryAt(i); return e ? e.model : null; }
  entryAt(i) { for (const [, e] of this.pieceMeshes) if (e.group.userData.sq === i) return e; return null; }

  // tap during a cutscene: jump back to the normal board camera
  skipCinematic() {
    if (!this.shots.length) return false;
    this.shots = [];
    this.lookCur = this.camera.position.clone().add(new THREE.Vector3(0, -10, this.viewSide === 'w' ? -10 : 10));
    return true;
  }

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

  // ability poses (recoil, lunge, hop, dig, spin) and hit shake layered over the idle pose
  animatePiece(e, dt) {
    const m = e.model;
    if (e.aimT > 0) { e.aimT -= dt; m.rotation.y += (e.aimFace - m.rotation.y) * Math.min(1, dt * 9); }
    if (!e.anim && !(e.hitT > 0) && !e.animDirty) return;
    let ox = 0, oy = 0, oz = 0;
    const A = e.anim;
    if (A) {
      if (A.delay > 0) A.delay -= dt;
      else {
        A.t += dt;
        const k = Math.min(1, A.t / A.dur), s = Math.sin(k * Math.PI);
        const fx = Math.cos(m.rotation.y), fz = -Math.sin(m.rotation.y);
        if (A.kind === 'recoil') { const r = k < 0.12 ? (k / 0.12) * 0.6 : 0.6 * (1 - (k - 0.12) / 0.88); ox = -fx * r; oz = -fz * r; oy = r * 0.15; }
        else if (A.kind === 'lunge') { ox = fx * s * 1.4; oz = fz * s * 1.4; oy = s * 0.35; }
        else if (A.kind === 'hop') oy = s * 1.3;
        else if (A.kind === 'dig') oy = -s * 0.4 + Math.sin(k * Math.PI * 6) * 0.05;
        else if (A.kind === 'spin') { m.rotation.y += dt * 16 * (1 - k); oy = s * 0.4; }
        else oy = s * 0.6;
        if (k >= 1) e.anim = null;
      }
    }
    if (e.hitT > 0) {
      e.hitT -= dt;
      const h = Math.max(0, e.hitT) / 0.45;
      ox += Math.sin(this.time * 75) * 0.2 * h;
      oz += Math.cos(this.time * 61) * 0.14 * h;
    }
    m.position.set(ox, 0.32 + oy, oz);
    e.animDirty = !!(e.anim || e.hitT > 0);
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
          if (!(e.aimT > 0)) e.model.rotation.y += (e.face - e.model.rotation.y) * Math.min(1, dt * 3);
        }
      }
      this.animatePiece(e, dt);
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
      const k = this.nightFlash > 0 ? 0.18 : 1;
      this.sun.intensity = this.baseI.sun * k;
      this.hemi.intensity = this.baseI.hemi * Math.max(k, 0.3);
    }
    updateWind(this.time);
    updateWater(this.time);
    if (this.clouds) this.clouds.userData.update(dt);
    if (this.checkRing) { this.checkRing.material.opacity = 0.55 + Math.sin(this.time * 8) * 0.4; this.checkRing.scale.setScalar(1 + Math.sin(this.time * 8) * 0.06); }
    for (const pad of this.plotPads) {
      const hl = this.cityView ? pad.userData.hl : 0;
      pad.visible = hl > 0;
      pad.material.opacity = hl === 2 ? 0.45 + Math.sin(this.time * 6) * 0.15 : 0.12;
    }
    for (const side of ['w', 'b']) for (const m of this.cityMeshes[side]) {
      if (!m) continue;
      if (m.userData.flag) m.userData.flag.rotation.y = Math.sin(this.time * 3) * 0.3;
      if (m.userData.dishes) for (const d of m.userData.dishes) d.rotation.y += dt * 1.2;
      if (m.userData.jib) m.userData.jib.rotation.y = Math.sin(this.time * 0.6) * 1.2;
    }
    this.smokeT = (this.smokeT || 0) - dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.35;
      for (const side of ['w', 'b']) for (const f of this.cityMeshes[side]) {
        if (!f || !f.userData.chimneys || !f.userData.chimneys.length) continue;
        const c = f.userData.chimneys[Math.floor(Math.random() * f.userData.chimneys.length)].clone();
        f.localToWorld(c);
        this.fx.smoke(c.x, c.y, c.z, f.userData.type === 'power' ? 0xe8e8e8 : 0x6e6a66, f.userData.type === 'power' ? 0.9 : 0.5);
      }
      for (const [, e] of this.pieceMeshes) if (e.t === 'T' && Math.random() < 0.5) { const p = e.group.position; this.fx.smoke(p.x + 1, 2.2, p.z, 0x555555, 0.35); }
    }
    if (this.frontMat) this.frontMat.opacity = 0.55 + Math.sin(this.time * 4) * 0.35;
    for (const m of this.hlMeshes) if (m.visible && m.userData.kind !== 'last' && m.userData.kind !== 'area') m.position.y = 0.34 + Math.sin(this.time * 5) * 0.02;
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
    if (this.kick > 0 && !this.droneSnap) {
      this.kick -= dt;
      const k = Math.max(0, this.kick);
      this.camera.position.x += (Math.random() - 0.5) * k * 0.9;
      this.camera.position.y += (Math.random() - 0.5) * k * 0.6;
    }
  }
}
