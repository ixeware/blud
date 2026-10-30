// Procedural low-poly military models. Every model faces +x.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const TEAM_COLORS = {
  w: { main: 0x3f74c8, dark: 0x1f3f78, light: 0x9cc2ff, hex: '#4f8be0', css: '#3f74c8' },
  b: { main: 0xc8423b, dark: 0x6e1f1b, light: 0xffa494, hex: '#e0574f', css: '#c8423b' },
  n: { main: 0x5a5a5a, dark: 0x262626, light: 0xb0b0b0, hex: '#9a9a9a', css: '#5a5a5a' },
};

// ---------- shared resources ----------
const texLoader = new THREE.TextureLoader();
const texCache = new Map();
export function tex(name, repeat = 1) {
  const key = name + repeat;
  if (!texCache.has(key)) {
    const t = texLoader.load('assets/tex/' + name + '.jpg');
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(key, t);
  }
  return texCache.get(key);
}

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts, (k, v) => (v && v.isTexture ? v.uuid : v));
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial({ color, ...opts }));
  return matCache.get(key);
}
const camoMat = (color) => mat(color, { map: tex('tex_camo', 1) });
const metalMat = (color) => mat(color, { map: tex('tex_metal', 1) });

const geoCache = new Map();
function geo(k, make) { if (!geoCache.has(k)) geoCache.set(k, make()); return geoCache.get(k); }
const box = (w, h, d) => geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt, rb, h, seg = 10) => geo(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const sph = (r, seg = 10) => geo(`s${r},${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2)));
const cone = (r, h, seg = 8) => geo(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));

function m(g, material, x = 0, y = 0, z = 0, parent, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(g, material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  if (parent) parent.add(mesh);
  return mesh;
}

// Merge static child meshes of a group per material to cut draw calls.
export function bake(group) {
  const byMat = new Map();
  const keep = [];
  group.updateMatrix();
  for (const c of [...group.children]) {
    if (c.isMesh && !c.userData.dynamic && !c.material.transparent) {
      c.updateMatrix();
      if (!byMat.has(c.material)) byMat.set(c.material, []);
      const g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
      g.applyMatrix4(c.matrix);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      byMat.get(c.material).push(g);
      group.remove(c);
    } else keep.push(c);
  }
  for (const [material, list] of byMat) {
    const merged = mergeGeometries(list, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}

const SKIN = 0xd9a77e, GUN = 0x262626, GUN2 = 0x4a3a28, OLIVE = 0x4b5a32, KHAKI = 0x8a7d55, BOOT = 0x2b2118;

// ---------- weapons (along +x) ----------
function weapon(type, parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  const G = mat(GUN), W = mat(GUN2);
  switch (type) {
    case 'pistol': m(box(0.3, 0.1, 0.07), G, 0.15, 0, 0, g); m(box(0.08, 0.16, 0.06), G, 0.02, -0.08, 0, g); break;
    case 'smg':
      m(box(0.55, 0.11, 0.08), G, 0.25, 0, 0, g); m(cyl(0.035, 0.035, 0.3, 6), G, 0.65, 0.01, 0, g, 0, 0, Math.PI / 2);
      m(box(0.07, 0.2, 0.06), G, 0.22, -0.13, 0, g); m(box(0.18, 0.08, 0.06), G, -0.08, -0.02, 0, g); break;
    case 'sniper':
      m(box(1.3, 0.09, 0.08), W, 0.5, 0, 0, g); m(cyl(0.03, 0.03, 0.5, 6), G, 1.35, 0.01, 0, g, 0, 0, Math.PI / 2);
      m(cyl(0.06, 0.06, 0.38, 8), mat(0x111111), 0.45, 0.12, 0, g, 0, 0, Math.PI / 2);
      m(box(0.03, 0.25, 0.02), G, 1.0, -0.12, 0.05, g, 0.4); m(box(0.03, 0.25, 0.02), G, 1.0, -0.12, -0.05, g, -0.4); break;
    case 'mg':
      m(box(0.9, 0.13, 0.1), G, 0.35, 0, 0, g); m(cyl(0.04, 0.04, 0.5, 6), G, 1.0, 0.02, 0, g, 0, 0, Math.PI / 2);
      m(box(0.18, 0.18, 0.16), mat(OLIVE), 0.25, -0.12, 0.06, g); break;
    case 'shotgun': m(box(0.8, 0.1, 0.08), W, 0.3, 0, 0, g); m(cyl(0.045, 0.045, 0.45, 6), G, 0.85, 0.02, 0, g, 0, 0, Math.PI / 2); break;
    case 'flame':
      m(box(0.7, 0.1, 0.1), G, 0.3, 0, 0, g); m(cyl(0.06, 0.04, 0.2, 6), mat(0x885522), 0.75, 0, 0, g, 0, 0, Math.PI / 2); break;
    default: // rifle
      m(box(0.7, 0.1, 0.08), G, 0.3, 0, 0, g); m(box(0.25, 0.1, 0.07), W, -0.12, -0.03, 0, g);
      m(cyl(0.03, 0.03, 0.32, 6), G, 0.78, 0.02, 0, g, 0, 0, Math.PI / 2);
      m(box(0.08, 0.2, 0.06), mat(0x3a2a1a), 0.32, -0.14, 0, g, 0, 0, -0.25); break;
  }
  return g;
}

// ---------- soldiers ----------
const SOLDIER = {
  P: { body: null, helmet: 'net', weapon: 'rifle', pack: 'bedroll' },
  S: { body: null, helmet: 'plain', weapon: 'rifle', pack: 'small' },
  N: { body: 0x2c2f33, helmet: 'beret', weapon: 'smg', pack: 'none', mask: true, nvg: true },
  B: { body: 0x55663a, helmet: 'ghillie', weapon: 'sniper', pack: 'none', ghillie: true },
  K: { body: 0x4d5235, helmet: 'cap', weapon: 'pistol', pack: 'none', medals: true, coat: true },
  M: { body: null, helmet: 'medic', weapon: 'smg', pack: 'medic' },
  E: { body: 0x6b5a3a, helmet: 'hardhat', weapon: 'rifle', pack: 'tools' },
  D: { body: 0x2e2e33, helmet: 'cap', weapon: 'pistol', pack: 'none', coat: true, dictator: true },
};

function soldier(side, variant) {
  const C = TEAM_COLORS[side];
  const V = SOLDIER[variant] || SOLDIER.P;
  const g = new THREE.Group();
  const bodyCol = V.body ?? (side === 'n' ? 0x55554e : C.main);
  const legMat = mat(V.ghillie ? OLIVE : V.dictator ? 0x222226 : C.dark);
  // legs
  const legs = [];
  for (const z of [-0.15, 0.15]) {
    const leg = new THREE.Group();
    leg.position.set(0, 0.72, z);
    g.add(leg);
    m(box(0.22, 0.42, 0.22), legMat, 0, -0.2, 0, leg);
    m(box(0.2, 0.36, 0.2), legMat, 0, -0.52, 0, leg);
    m(box(0.12, 0.1, 0.22), mat(0x333333), 0.07, -0.36, 0, leg); // knee pad
    m(box(0.3, 0.12, 0.22), mat(BOOT), 0.05, -0.68, 0, leg);
    leg.userData.dynamic = true;
    legs.push(leg);
  }
  g.userData.legs = legs;
  const upper = new THREE.Group();
  upper.position.y = 0.7;
  g.add(upper);
  // torso & vest
  const torsoMat = V.ghillie ? camoMat(0x7b8f55) : mat(bodyCol);
  m(box(0.42, 0.66, 0.62), torsoMat, 0, 0.33, 0, upper);
  if (V.coat) m(box(0.46, 0.5, 0.66), mat(bodyCol), 0, 0.05, 0, upper);
  if (!V.coat && !V.ghillie) {
    m(box(0.46, 0.42, 0.66), mat(V.mask ? 0x1d1f22 : 0x4a5233), 0.01, 0.4, 0, upper); // plate carrier
    for (const z of [-0.18, 0, 0.18]) m(box(0.08, 0.14, 0.14), mat(0x3b4228), 0.26, 0.3, z, upper); // pouches
  }
  m(box(0.48, 0.1, 0.68), mat(0x2a2218), 0, 0.05, 0, upper); // belt
  // team armband
  m(box(0.16, 0.1, 0.12), mat(C.main), 0, 0.5, 0.33, upper);
  m(box(0.16, 0.1, 0.12), mat(C.main), 0, 0.5, -0.33, upper);
  if (V.medals) for (const z of [-0.12, -0.02, 0.08]) m(box(0.04, 0.08, 0.07), mat(0xd4af37), 0.23, 0.48, z, upper);
  // backpack
  if (V.pack === 'bedroll') { m(box(0.26, 0.42, 0.48), mat(OLIVE), -0.32, 0.38, 0, upper); m(cyl(0.1, 0.1, 0.52, 8), mat(KHAKI), -0.33, 0.66, 0, upper, Math.PI / 2); }
  if (V.pack === 'small') m(box(0.22, 0.32, 0.4), mat(OLIVE), -0.3, 0.38, 0, upper);
  if (V.pack === 'medic') {
    m(box(0.26, 0.38, 0.46), mat(0xe8e8e0), -0.32, 0.38, 0, upper);
    m(box(0.02, 0.2, 0.06), mat(0x2fbf4a), -0.46, 0.4, 0, upper); m(box(0.02, 0.06, 0.2), mat(0x2fbf4a), -0.46, 0.4, 0, upper);
  }
  if (V.pack === 'tools') {
    m(box(0.24, 0.34, 0.44), mat(0x5a4a2a), -0.31, 0.36, 0, upper);
    m(cyl(0.025, 0.025, 0.9, 5), mat(0x6b4a2a), -0.42, 0.6, 0.12, upper, 0.3); // shovel handle
    m(box(0.04, 0.22, 0.16), mat(0x777777), -0.42, 1.0, 0.25, upper, 0.3);
    m(box(0.12, 0.1, 0.12), mat(0xc9a227), 0.18, 0.02, 0.22, upper); // tool pouch
  }
  // head
  const headMat = mat(V.mask ? 0x1b1b1b : SKIN);
  m(sph(0.21, 10), headMat, 0.02, 0.86, 0, upper);
  if (!V.mask) { m(box(0.02, 0.04, 0.05), mat(0x111111), 0.21, 0.9, 0.08, upper); m(box(0.02, 0.04, 0.05), mat(0x111111), 0.21, 0.9, -0.08, upper); }
  else m(box(0.03, 0.06, 0.24), mat(0xd9a77e), 0.2, 0.9, 0, upper);
  if (V.dictator) m(box(0.03, 0.04, 0.1), mat(0x1b1b1b), 0.22, 0.81, 0, upper);
  switch (V.helmet) {
    case 'net': {
      const h = m(sph(0.27, 10), camoMat(0x6b7a48), 0, 0.93, 0, upper); h.scale.set(1, 0.68, 1);
      m(box(0.05, 0.05, 0.42), mat(0x222222), 0.12, 0.86, 0, upper, 0, 0, 0.4); // strap
      break;
    }
    case 'plain': { const h = m(sph(0.26, 10), mat(0x5a6440), 0, 0.93, 0, upper); h.scale.set(1, 0.66, 1); break; }
    case 'beret': {
      const b = m(sph(0.25, 10), mat(0x7a1f2b), -0.04, 0.99, 0.04, upper); b.scale.set(1, 0.38, 1);
      if (V.nvg) { m(box(0.1, 0.1, 0.18), mat(0x222222), 0.18, 1.04, 0, upper); m(cyl(0.04, 0.04, 0.1, 6), mat(0x55ff88), 0.26, 1.04, 0.05, upper, 0, 0, Math.PI / 2); }
      break;
    }
    case 'ghillie': {
      const h = m(sph(0.3, 8), camoMat(0x6e8048), 0, 0.92, 0, upper); h.scale.set(1.1, 0.85, 1.1);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        m(cone(0.12, 0.35, 5), mat(i % 2 ? 0x56692f : 0x7d8c3e), Math.cos(a) * 0.28, 0.3 + (i % 3) * 0.18, Math.sin(a) * 0.32, upper, Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
      }
      break;
    }
    case 'cap':
      m(cyl(0.25, 0.23, 0.12, 12), mat(V.dictator ? 0x26262b : 0x3b4a2a), 0, 1.04, 0, upper);
      m(cyl(0.3, 0.3, 0.04, 12), mat(V.dictator ? 0x26262b : 0x3b4a2a), 0.04, 1.1, 0, upper);
      m(box(0.2, 0.03, 0.36), mat(0x111111), 0.2, 0.99, 0, upper);
      m(box(0.04, 0.06, 0.06), mat(V.dictator ? 0x888888 : 0xd4af37), 0.24, 1.06, 0, upper);
      break;
    case 'medic': {
      const h = m(sph(0.26, 10), mat(0xeeeeee), 0, 0.93, 0, upper); h.scale.set(1, 0.68, 1);
      m(box(0.04, 0.14, 0.05), mat(0x2fbf4a), 0.24, 0.98, 0, upper); m(box(0.04, 0.05, 0.14), mat(0x2fbf4a), 0.24, 0.98, 0, upper);
      break;
    }
    case 'hardhat': {
      const h = m(sph(0.27, 10), mat(0xf28c1c), 0, 0.95, 0, upper); h.scale.set(1, 0.6, 1);
      m(cyl(0.33, 0.33, 0.03, 12), mat(0xf28c1c), 0.02, 0.93, 0, upper);
      m(box(0.06, 0.08, 0.3), mat(0x99ddff), 0.2, 0.9, 0, upper); // goggles
      break;
    }
  }
  // arms + weapon
  const arms = new THREE.Group();
  arms.position.set(0, 0.45, 0);
  upper.add(arms);
  m(box(0.5, 0.14, 0.14), torsoMat, 0.22, 0, 0.28, arms);
  m(box(0.46, 0.14, 0.14), torsoMat, 0.22, 0, -0.08, arms, 0, 0.45);
  m(box(0.1, 0.1, 0.1), mat(SKIN), 0.47, -0.02, 0.24, arms);
  const gun = weapon(V.weapon, arms, 0.22, 0.02, 0.18);
  g.userData.aim = upper;
  g.userData.gun = gun;
  g.userData.muzzle = new THREE.Vector3(1.0, 1.17, 0.18);
  return g;
}

// ---------- vehicles ----------
function tracks(parent, len, z, wheelR = 0.22) {
  m(box(len, 0.55, 0.45), mat(0x2b2b2b), 0, 0.3, z, parent);
  for (let x = -len / 2 + 0.3; x <= len / 2 - 0.29; x += 0.55) m(cyl(wheelR, wheelR, 0.5, 10), mat(0x4a4a4a), x, 0.27, z, parent, Math.PI / 2);
  for (let x = -len / 2 + 0.1; x <= len / 2; x += 0.22) m(box(0.08, 0.06, 0.47), mat(0x1c1c1c), x, 0.58, z, parent);
}

function tank(side) {
  const C = TEAM_COLORS[side];
  const g = new THREE.Group();
  const hull = new THREE.Group();
  g.add(hull);
  const camo = camoMat(C.main);
  m(box(3.0, 0.62, 2.0), mat(C.dark), 0, 0.62, 0, hull);
  m(box(2.7, 0.32, 1.86), camo, -0.1, 1.06, 0, hull);
  m(box(0.7, 0.45, 1.9), mat(C.dark), 1.4, 0.72, 0, hull, 0, 0, 0.55);
  for (const z of [-1.0, 1.0]) {
    tracks(hull, 3.2, z);
    m(box(2.9, 0.28, 0.06), camo, 0, 0.66, z * 1.25, hull); // side skirt
  }
  for (let i = -0.9; i <= 0.91; i += 0.36) for (const z of [0.72, -0.72]) m(box(0.3, 0.12, 0.24), mat(KHAKI), i, 1.27, z, hull); // ERA
  m(box(0.5, 0.3, 0.5), mat(0x3b3b3b), -1.3, 1.1, 0.55, hull); // stowage
  m(cyl(0.12, 0.12, 0.6, 8), mat(0x222222), -1.5, 0.95, -0.5, hull, Math.PI / 2); // exhaust
  const turret = new THREE.Group();
  turret.position.set(-0.1, 1.25, 0);
  g.add(turret);
  m(box(1.5, 0.55, 1.36), camo, 0, 0.27, 0, turret);
  m(box(0.5, 0.45, 1.2), mat(C.dark), -0.85, 0.24, 0, turret);
  m(box(0.4, 0.45, 0.7), mat(C.dark), 0.75, 0.25, 0, turret); // mantlet
  m(cyl(0.11, 0.13, 2.4, 10), metalMat(0x444444), 1.9, 0.3, 0, turret, 0, 0, Math.PI / 2);
  m(cyl(0.18, 0.18, 0.4, 10), mat(0x333333), 3.0, 0.3, 0, turret, 0, 0, Math.PI / 2);
  m(cyl(0.2, 0.22, 0.2, 12), mat(0x333333), -0.2, 0.62, 0.35, turret);
  m(box(0.5, 0.07, 0.07), mat(0x111111), 0.1, 0.78, 0.35, turret); // commander MG
  for (const z of [-0.6, 0.6]) for (let k = 0; k < 3; k++) m(cyl(0.05, 0.05, 0.2, 6), mat(0x222222), 0.45, 0.5, z + (k - 1) * 0.1, turret, 0, 0, -0.8);
  m(cyl(0.015, 0.015, 1.6, 4), mat(0x222222), -0.9, 1.25, -0.45, turret);
  m(box(1.52, 0.08, 0.2), mat(C.light), 0, 0.5, 0.6, turret);
  g.userData.aim = turret;
  g.userData.body = hull;
  g.userData.recoil = turret;
  g.userData.muzzle = new THREE.Vector3(3.2, 1.55, 0);
  return g;
}

function heli(side) {
  const C = TEAM_COLORS[side];
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.4;
  g.add(body);
  const camo = camoMat(C.main);
  const fus = m(sph(0.8, 14), camo, 0, 0, 0, body); fus.scale.set(1.8, 0.8, 0.72);
  // tandem cockpit
  const gl = mat(0x9fd3ff, { transparent: true, opacity: 0.8 });
  const c1 = m(sph(0.42, 10), gl, 1.0, 0.25, 0, body); c1.scale.set(1.1, 0.7, 0.8);
  const c2 = m(sph(0.38, 10), gl, 0.45, 0.42, 0, body); c2.scale.set(1.1, 0.7, 0.8);
  m(box(0.6, 0.35, 0.9), mat(C.dark), -0.3, 0.5, 0, body); // engine block
  for (const z of [-0.45, 0.45]) m(cyl(0.16, 0.16, 0.4, 8), mat(0x222222), -0.2, 0.55, z, body, 0, 0, Math.PI / 2);
  m(box(2.6, 0.24, 0.24), camo, -2.0, 0.15, 0, body);
  m(box(0.45, 0.85, 0.08), mat(C.dark), -3.2, 0.5, 0, body);
  m(box(0.3, 0.08, 0.9), mat(C.dark), -3.0, 0.25, 0, body);
  const trot = new THREE.Group();
  trot.position.set(-3.2, 0.62, 0.1);
  body.add(trot);
  m(box(0.9, 0.08, 0.04), mat(0x1a1a1a), 0, 0, 0, trot); m(box(0.08, 0.9, 0.04), mat(0x1a1a1a), 0, 0, 0, trot);
  trot.userData.dynamic = true;
  // stub wings with pods & missiles
  m(box(0.45, 0.08, 2.4), mat(C.dark), -0.1, -0.1, 0, body);
  for (const z of [-1.1, 1.1]) {
    m(cyl(0.16, 0.16, 0.8, 8), mat(0x333333), -0.1, -0.28, z, body, 0, 0, Math.PI / 2);
    m(cyl(0.05, 0.05, 0.9, 6), mat(0xeeeeee), -0.1, -0.24, z * 0.72, body, 0, 0, Math.PI / 2);
  }
  // chin gun turret
  m(sph(0.18, 8), mat(0x222222), 1.3, -0.5, 0, body);
  m(cyl(0.05, 0.05, 0.6, 6), mat(0x222222), 1.65, -0.55, 0, body, 0, 0, Math.PI / 2);
  for (const z of [-0.5, 0.5]) { m(box(0.1, 0.4, 0.1), mat(0x333333), 0.5, -0.65, z, body); m(cyl(0.12, 0.12, 0.08, 10), mat(0x111111), 0.5, -0.85, z, body, Math.PI / 2); }
  const rotor = new THREE.Group();
  rotor.position.set(0, 0.85, 0);
  body.add(rotor);
  m(cyl(0.1, 0.1, 0.3, 6), mat(0x222222), 0, -0.1, 0, rotor);
  for (let i = 0; i < 5; i++) {
    const b = m(box(4.0, 0.04, 0.22), mat(0x1a1a1a), 0, 0.05, 0, rotor);
    b.rotation.y = (i * Math.PI * 2) / 5;
  }
  rotor.userData.dynamic = true;
  g.userData.rotor = rotor;
  g.userData.tailRotor = trot;
  g.userData.aim = body;
  g.userData.bob = body;
  g.userData.muzzle = new THREE.Vector3(1.8, 1.9, 0);
  return g;
}

function aaGun(side) {
  const C = TEAM_COLORS[side];
  const g = new THREE.Group();
  const hull = new THREE.Group();
  g.add(hull);
  m(box(2.8, 0.6, 1.9), mat(C.dark), 0, 0.62, 0, hull);
  m(box(2.4, 0.3, 1.8), camoMat(C.main), -0.1, 1.0, 0, hull);
  for (const z of [-0.95, 0.95]) tracks(hull, 3.0, z, 0.2);
  const turret = new THREE.Group();
  turret.position.set(0, 1.15, 0);
  g.add(turret);
  m(box(1.4, 0.7, 1.5), camoMat(C.main), 0, 0.35, 0, turret);
  for (const [y, z] of [[0.45, 0.28], [0.45, -0.28], [0.7, 0.28], [0.7, -0.28]]) m(cyl(0.05, 0.05, 1.6, 6), mat(0x2a2a2a), 1.3, y, z, turret, 0, 0, Math.PI / 2 - 0.35);
  const dish = new THREE.Group();
  dish.position.set(-0.55, 1.0, 0);
  turret.add(dish);
  m(cyl(0.04, 0.04, 0.4, 5), mat(0x333333), 0, -0.15, 0, dish);
  const d = m(cyl(0.45, 0.2, 0.12, 12), mat(0xcfd6c4), 0, 0.12, 0, dish); d.rotation.z = Math.PI / 2;
  dish.userData.dynamic = true;
  g.userData.aim = turret;
  g.userData.body = hull;
  g.userData.dish = dish;
  g.userData.muzzle = new THREE.Vector3(2.0, 2.0, 0);
  return g;
}

function mlrs(side) {
  const C = TEAM_COLORS[side];
  const g = new THREE.Group();
  const hull = new THREE.Group();
  g.add(hull);
  const camo = camoMat(C.main);
  m(box(3.4, 0.25, 1.4), mat(0x2b2b2b), 0, 0.55, 0, hull); // chassis
  m(box(1.0, 0.95, 1.5), camo, 1.25, 1.1, 0, hull); // cab
  m(box(0.05, 0.4, 1.2), mat(0x9fd3ff), 1.76, 1.25, 0, hull);
  m(box(1.0, 0.1, 1.55), mat(C.dark), 1.25, 1.6, 0, hull);
  for (const x of [1.2, -0.3, -1.2]) for (const z of [-0.72, 0.72]) {
    m(cyl(0.34, 0.34, 0.3, 12), mat(0x1c1c1c), x, 0.34, z, hull, Math.PI / 2);
    m(cyl(0.16, 0.16, 0.32, 8), mat(0x555555), x, 0.34, z, hull, Math.PI / 2);
  }
  const pod = new THREE.Group();
  pod.position.set(-0.6, 1.05, 0);
  g.add(pod);
  const rack = new THREE.Group();
  rack.rotation.z = 0.35;
  pod.add(rack);
  m(box(2.1, 0.7, 1.2), camo, 0.2, 0.35, 0, rack);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) m(cyl(0.09, 0.09, 0.08, 8), mat(0x111111), 1.27, 0.12 + r * 0.22, -0.42 + c * 0.28, rack, 0, 0, Math.PI / 2);
  m(box(0.6, 0.35, 0.6), mat(0x333333), -0.3, -0.1, 0, pod);
  g.userData.aim = pod;
  g.userData.body = hull;
  g.userData.muzzle = new THREE.Vector3(1.0, 2.0, 0);
  return g;
}

function train(side) {
  const C = TEAM_COLORS[side];
  const g = new THREE.Group();
  const hull = new THREE.Group();
  g.add(hull);
  const armor = metalMat(C.main);
  m(box(3.6, 0.2, 1.3), mat(0x222222), 0, 0.45, 0, hull);
  for (let x = -1.4; x <= 1.41; x += 0.7) for (const z of [-0.55, 0.55]) m(cyl(0.3, 0.3, 0.12, 12), mat(0x3a3a3a), x, 0.3, z, hull, Math.PI / 2);
  m(cyl(0.55, 0.55, 2.2, 12), armor, 0.45, 1.05, 0, hull, 0, 0, Math.PI / 2); // boiler
  m(box(1.1, 1.3, 1.4), armor, -1.1, 1.2, 0, hull); // cab
  m(box(1.15, 0.12, 1.5), mat(C.dark), -1.1, 1.9, 0, hull);
  m(box(0.06, 0.25, 0.6), mat(0xffd27a), -0.54, 1.45, 0, hull); // window glow
  m(cyl(0.18, 0.24, 0.7, 10), mat(0x222222), 1.25, 1.75, 0, hull); // smokestack
  m(box(0.3, 0.5, 1.4), mat(0x444444), 1.8, 0.65, 0, hull, 0, 0, -0.4); // plough
  m(sph(0.14, 8), mat(0xffee88, { emissive: 0xffcc44 }), 1.68, 1.15, 0, hull); // headlight
  const turret = new THREE.Group();
  turret.position.set(0.4, 1.65, 0);
  g.add(turret);
  m(cyl(0.45, 0.5, 0.4, 10), armor, 0, 0.1, 0, turret);
  m(cyl(0.08, 0.1, 1.4, 8), mat(0x333333), 0.9, 0.15, 0, turret, 0, 0, Math.PI / 2);
  g.userData.aim = turret;
  g.userData.body = hull;
  g.userData.smoke = new THREE.Vector3(1.25, 2.2, 0);
  g.userData.muzzle = new THREE.Vector3(1.6, 1.8, 0);
  return g;
}

function turretModel(side) {
  const C = TEAM_COLORS[side];
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; m(cyl(0.04, 0.04, 0.9, 5), mat(0x333333), Math.cos(a) * 0.3, 0.4, Math.sin(a) * 0.3, g, Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4); }
  const head = new THREE.Group();
  head.position.y = 0.85;
  g.add(head);
  m(box(0.5, 0.3, 0.4), mat(C.dark), 0, 0, 0, head);
  m(box(0.06, 0.5, 0.7), mat(C.main), 0.3, 0.05, 0, head);
  m(cyl(0.05, 0.05, 0.8, 6), mat(0x222222), 0.55, 0.02, 0, head, 0, 0, Math.PI / 2);
  m(sph(0.06, 6), mat(0xff3030, { emissive: 0xff0000 }), 0.15, 0.2, 0, head);
  g.userData.aim = head;
  return g;
}

// HQ bunker for the board king
function hq(side) {
  const C = TEAM_COLORS[side];
  const g = new THREE.Group();
  m(box(2.3, 0.9, 2.3), mat(0x6a6858, { map: tex('tex_concrete', 1) }), 0, 0.45, 0, g);
  m(box(2.5, 0.2, 2.5), mat(0x55534a), 0, 0.98, 0, g);
  m(box(1.0, 0.18, 0.06), mat(0x111111), 0.7, 0.6, 1.16, g); // firing slit
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    m(box(0.55, 0.3, 0.35), mat(i % 2 ? KHAKI : 0x7d7150), Math.cos(a) * 1.6, 0.15, Math.sin(a) * 1.6, g, 0, -a, 0);
  }
  m(cyl(0.04, 0.04, 2.8, 5), mat(0x333333), 0.75, 2.4, -0.75, g);
  m(cyl(0.035, 0.035, 0.8, 5), mat(0x333333), 0.75, 3.6, -0.75, g, 0, 0, Math.PI / 2);
  m(cyl(0.05, 0.05, 2.4, 5), mat(0xcccccc), -0.8, 2.1, 0.8, g);
  const flag = m(box(1.0, 0.6, 0.04), mat(C.main), -0.3, 2.95, 0.8, g);
  flag.userData.dynamic = true;
  g.userData.flag = flag;
  // map table under camo net
  m(box(0.8, 0.05, 0.6), mat(0xd8c89a), -0.5, 1.15, -0.4, g);
  const gen = soldier(side, 'K');
  gen.position.set(0.3, 1.05, 0.3);
  gen.scale.setScalar(0.8);
  g.add(gen);
  g.userData.aim = gen;
  return g;
}

// ---------- custom unit from workshop parts ----------
const PRIMS = {
  box: () => new THREE.BoxGeometry(1, 1, 1),
  sphere: () => new THREE.SphereGeometry(0.5, 14, 10),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
  cone: () => new THREE.ConeGeometry(0.5, 1, 14),
  capsule: () => new THREE.CapsuleGeometry(0.3, 0.4, 4, 10),
  torus: () => new THREE.TorusGeometry(0.4, 0.12, 8, 18),
  wedge: () => new THREE.CylinderGeometry(0.6, 0.6, 1, 3),
};
export const PRIM_NAMES = { box: 'Куб', sphere: 'Сфера', cylinder: 'Цилиндр', cone: 'Конус', capsule: 'Капсула', torus: 'Тор', wedge: 'Призма' };
const userTex = new Map();
export function customTexture(dataUrl) {
  if (!userTex.has(dataUrl)) {
    const t = texLoader.load(dataUrl);
    t.colorSpace = THREE.SRGBColorSpace;
    userTex.set(dataUrl, t);
  }
  return userTex.get(dataUrl);
}

export function partMesh(part, def, side) {
  const geoObj = geo('prim_' + part.g, PRIMS[part.g] || PRIMS.box);
  let color = part.team && side ? TEAM_COLORS[side].main : new THREE.Color(part.c || '#888888').getHex();
  const map = part.tex !== undefined && part.tex !== null && def.textures && def.textures[part.tex] ? customTexture(def.textures[part.tex]) : null;
  const material = map ? new THREE.MeshLambertMaterial({ color: part.team ? color : 0xffffff, map }) : mat(color);
  const mesh = new THREE.Mesh(geoObj, material);
  mesh.position.fromArray(part.p);
  mesh.rotation.fromArray(part.r);
  mesh.scale.fromArray(part.s);
  mesh.castShadow = true;
  return mesh;
}

export function customModel(def, side) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  for (const part of def.parts || []) inner.add(partMesh(part, def, side));
  // normalise height to ~2.2 units
  const bb = new THREE.Box3().setFromObject(inner);
  const h = Math.max(0.1, bb.max.y - bb.min.y), w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
  const sc = Math.min(2.2 / h, 2.8 / Math.max(0.1, w));
  inner.scale.setScalar(sc);
  inner.position.y = -bb.min.y * sc + (def.air ? 1.6 : 0);
  g.userData.aim = inner;
  g.userData.custom = true;
  return g;
}

function bakeDeep(g) {
  for (const c of [...g.children]) if (!c.isMesh) bakeDeep(c);
  if (g.children.some((c) => c.isMesh)) bake(g);
  return g;
}

export function unitModel(t, side, ctx = 'board', def = null) {
  let g;
  switch (t) {
    case 'R': g = tank(side); break;
    case 'Q': g = heli(side); break;
    case 'A': g = aaGun(side); break;
    case 'L': g = mlrs(side); break;
    case 'T': g = train(side); break;
    case 'U': g = turretModel(side); break;
    case 'K': g = ctx === 'board' ? hq(side) : soldier(side, 'K'); break;
    case 'C': g = def ? customModel(def, side) : soldier(side, 'S'); break;
    default: g = soldier(side, t); break;
  }
  if (t !== 'C') {
    for (const c of [...g.children]) if (!c.isMesh) bakeDeep(c);
    bake(g);
  }
  g.userData.kind = t;
  return g;
}

// ---------- props ----------
export function makeTree(scale = 1, snowy = false, dry = false) {
  const g = new THREE.Group();
  m(cyl(0.15, 0.22, 1.2, 6), mat(0x5a3d22), 0, 0.6, 0, g);
  const leaf = mat(snowy ? 0xe8eef2 : dry ? 0x9f9a4a : 0x2f6d2b);
  m(cone(1.0, 1.8, 7), leaf, 0, 1.8, 0, g);
  m(cone(0.75, 1.4, 7), mat(snowy ? 0xf4f8fa : dry ? 0xb0a855 : 0x3a8034), 0, 2.5, 0, g);
  g.scale.setScalar(scale);
  return bake(g);
}

export function makeFactory(side) {
  const C = TEAM_COLORS[side];
  const g = new THREE.Group();
  const brick = mat(0xb07a5a, { map: tex('tex_brick', 1) });
  m(box(4.2, 2.2, 3), brick, 0, 1.1, 0, g);
  for (let i = -1.4; i <= 1.41; i += 1.4) m(box(1.4, 0.8, 3.05), mat(0x5b5248, { map: tex('tex_roof', 1) }), i, 2.4, 0, g, 0, 0, 0.35);
  m(cyl(0.3, 0.4, 3.2, 8), brick, 1.6, 3.0, -1.0, g);
  m(cyl(0.25, 0.32, 2.6, 8), brick, 0.8, 2.7, -1.1, g);
  m(box(4.25, 0.3, 3.05), mat(C.main), 0, 1.9, 0, g);
  m(box(1.2, 1.2, 0.1), mat(0x3a3a3a), -1, 0.6, 1.52, g);
  for (const x of [0.4, 1.3]) m(box(0.5, 0.5, 0.08), mat(0xffd27a, { emissive: 0x553300 }), x, 1.2, 1.52, g);
  bake(g);
  g.userData.chimneys = [new THREE.Vector3(1.6, 4.6, -1.0), new THREE.Vector3(0.8, 4.0, -1.1)];
  return g;
}

export function makeDrone(side) {
  const C = TEAM_COLORS[side];
  const g = new THREE.Group();
  m(box(0.5, 0.15, 0.5), mat(0x222222), 0, 0, 0, g);
  m(box(0.3, 0.12, 0.25), mat(C.main), 0.1, 0.12, 0, g);
  m(cyl(0.08, 0.08, 0.4, 6), mat(0x556633), 0.35, -0.05, 0, g, 0, 0, Math.PI / 2);
  const props = [];
  for (const [x, z] of [[0.4, 0.4], [0.4, -0.4], [-0.4, 0.4], [-0.4, -0.4]]) {
    m(box(0.6, 0.05, 0.06), mat(0x333333), x / 2, 0, z / 2, g, 0, Math.atan2(-z, x));
    props.push(m(cyl(0.25, 0.25, 0.02, 10), mat(0x888888, { transparent: true, opacity: 0.45 }), x, 0.08, z, g));
  }
  g.userData.props = props;
  return g;
}

export function makeKeypoint(type) {
  const g = new THREE.Group();
  if (type === 'oil') {
    m(box(1.6, 0.2, 0.8), mat(0x333333), 0, 0.1, 0, g);
    m(box(0.15, 1.6, 0.15), mat(0x444444), -0.2, 0.9, 0.25, g, 0, 0, 0.15);
    m(box(0.15, 1.6, 0.15), mat(0x444444), -0.2, 0.9, -0.25, g, 0, 0, 0.15);
    const beam = new THREE.Group();
    beam.position.set(-0.05, 1.7, 0);
    g.add(beam);
    m(box(2.0, 0.18, 0.18), mat(0xd9a32b), 0, 0, 0, beam);
    m(box(0.25, 0.6, 0.3), mat(0x222222), 1.0, -0.2, 0, beam);
    beam.userData.dynamic = true;
    g.userData.beam = beam;
    m(cyl(0.35, 0.35, 0.5, 10), mat(0x8a8a8a), -1.0, 0.45, 0, g);
  } else if (type === 'radar') {
    m(box(0.9, 0.9, 0.9), mat(0x6d6d60), 0, 0.45, 0, g);
    m(cyl(0.06, 0.06, 1.2, 6), mat(0x444444), 0, 1.4, 0, g);
    const dish = new THREE.Group();
    dish.position.y = 2.0;
    g.add(dish);
    m(box(0.15, 0.8, 1.6), mat(0xcfd6c4), 0.2, 0, 0, dish, 0, 0, 0.3);
    dish.userData.dynamic = true;
    g.userData.dish = dish;
  } else if (type === 'airfield') {
    m(box(3.4, 0.05, 0.9), mat(0x3a3a3a), 0, 0.03, 0, g);
    for (let x = -1.4; x <= 1.4; x += 0.7) m(box(0.35, 0.06, 0.08), mat(0xffffff), x, 0.05, 0, g);
    const pl = new THREE.Group();
    pl.position.set(0.3, 0.3, 0);
    g.add(pl);
    m(cone(0.18, 1.6, 6), mat(0x7d8a92), 0, 0, 0, pl, 0, 0, -Math.PI / 2);
    m(box(0.4, 0.05, 1.5), mat(0x6d7a82), -0.1, 0, 0, pl);
    m(box(0.25, 0.4, 0.05), mat(0x6d7a82), -0.7, 0.2, 0, pl);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function makeObstacle(o, theme) {
  const g = new THREE.Group();
  if (o.kind === 'wall') {
    const col = theme === 'ruins' ? 0x8a8278 : theme === 'winter' ? 0xb7bec4 : theme === 'desert' ? 0xc2a878 : 0x8f8f86;
    m(box(o.w, 2.4, o.d), mat(col, { map: tex('tex_concrete', 1) }), 0, 1.2, 0, g).receiveShadow = true;
    m(box(o.w + 0.1, 0.15, o.d + 0.1), mat(0x6a655d), 0, 2.45, 0, g);
  } else if (o.kind === 'crate') {
    m(box(o.w, 1.5, o.d), mat(0x9b7b4d, { map: tex('tex_wood', 1) }), 0, 0.75, 0, g);
    m(box(o.w + 0.04, 0.12, o.d + 0.04), mat(0x5e4626), 0, 1.3, 0, g);
    m(box(o.w + 0.04, 0.12, o.d + 0.04), mat(0x5e4626), 0, 0.2, 0, g);
  } else if (o.kind === 'sandbag') {
    const n = Math.round(Math.max(o.w, o.d) / 0.75);
    const horiz = o.w > o.d;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5;
      for (let row = 0; row < 2; row++) {
        const bag = m(sph(0.42, 8), mat(row ? 0xa39468 : 0x938457), horiz ? t * o.w : 0, 0.22 + row * 0.33, horiz ? 0 : t * o.d, g);
        bag.scale.set(horiz ? 1 : 0.7, 0.55, horiz ? 0.7 : 1);
      }
    }
  } else if (o.kind === 'barrel') {
    m(cyl(0.45, 0.45, 1.1, 10), mat(0xb33a22), 0, 0.55, 0, g);
    m(cyl(0.47, 0.47, 0.08, 10), mat(0x333333), 0, 0.85, 0, g);
  } else if (o.kind === 'car') {
    const col = [0x9b2d2d, 0x2d5d9b, 0xcfc8b8, 0x4a6b3a][Math.floor(o.rot * 4) % 4];
    m(box(o.w, 0.6, o.d), mat(col), 0, 0.55, 0, g);
    m(box(o.w * 0.55, 0.45, o.d * 0.9), mat(col), -0.1, 1.05, 0, g);
    m(box(o.w * 0.5, 0.36, o.d * 0.92), mat(0x223344), -0.1, 1.07, 0, g);
    for (const x of [-o.w * 0.32, o.w * 0.32]) for (const z of [-o.d / 2, o.d / 2]) m(cyl(0.28, 0.28, 0.2, 10), mat(0x111111), x, 0.28, z, g, Math.PI / 2);
  } else if (o.kind === 'house') {
    const wallM = mat(0xc9b9a0, { map: tex('tex_brick', 2) });
    const body = new THREE.Group();
    g.add(body);
    m(box(o.w, 3.2, o.d), wallM, 0, 1.6, 0, body).receiveShadow = true;
    const roof = m(box(o.w + 0.4, 0.25, o.d + 0.4), mat(0x6b4a3a, { map: tex('tex_roof', 1) }), 0, 3.3, 0, body);
    roof.receiveShadow = true;
    for (let x = -o.w / 2 + 0.8; x < o.w / 2 - 0.4; x += 1.3) {
      for (const z of [o.d / 2 + 0.01, -o.d / 2 - 0.01]) m(box(0.6, 0.7, 0.05), mat(0x2a3540), x, 2.1, z, body);
    }
    g.userData.body = body;
  }
  g.position.set(o.x, 0, o.z);
  return bake(g);
}
