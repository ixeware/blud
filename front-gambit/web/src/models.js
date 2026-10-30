// Procedural low-poly military models.
import * as THREE from 'three';

export const TEAM_COLORS = {
  w: { main: 0x3f6fb5, dark: 0x22406e, light: 0x8fb5ea, hex: '#4f8be0' },
  b: { main: 0xb5443f, dark: 0x6e2522, light: 0xeaa08f, hex: '#e0574f' },
};

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshLambertMaterial({ color, ...opts }));
  }
  return matCache.get(key);
}

const geoCache = new Map();
function box(w, h, d) {
  const k = `b${w},${h},${d}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(k);
}
function cyl(rt, rb, h, seg = 10) {
  const k = `c${rt},${rb},${h},${seg}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.CylinderGeometry(rt, rb, h, seg));
  return geoCache.get(k);
}
function sph(r, seg = 10) {
  const k = `s${r},${seg}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2)));
  return geoCache.get(k);
}

function m(geo, material, x = 0, y = 0, z = 0, parent) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  if (parent) parent.add(mesh);
  return mesh;
}

const SKIN = 0xd9a77e, GUN = 0x2a2a2a, OLIVE = 0x4b5a32, KHAKI = 0x8a7d55;

// Soldier facing +x. Returns group with userData.aim (upper body that rotates)
function soldier(side, variant) {
  const C = TEAM_COLORS[side];
  const g = new THREE.Group();
  const legs = new THREE.Group();
  g.add(legs);
  const legMat = mat(variant === 'B' ? OLIVE : C.dark);
  const l1 = m(box(0.22, 0.7, 0.22), legMat, 0, 0.35, -0.15, legs);
  const l2 = m(box(0.22, 0.7, 0.22), legMat, 0, 0.35, 0.15, legs);
  g.userData.legs = [l1, l2];
  const upper = new THREE.Group();
  upper.position.y = 0.7;
  g.add(upper);
  const bodyCol = variant === 'B' ? 0x5d6b3a : variant === 'N' ? 0x2f3133 : variant === 'K' ? 0x4d5235 : C.main;
  m(box(0.42, 0.65, 0.62), mat(bodyCol), 0, 0.33, 0, upper);
  // team armband/vest stripe
  m(box(0.44, 0.14, 0.64), mat(C.main), 0, 0.5, 0, upper);
  if (variant === 'P' || variant === 'A') m(box(0.3, 0.4, 0.5), mat(OLIVE), -0.2, 0.35, 0, upper); // backpack
  const head = m(sph(0.22), mat(variant === 'N' ? 0x222222 : SKIN), 0, 0.85, 0, upper);
  void head;
  if (variant === 'K') {
    m(cyl(0.26, 0.24, 0.12, 12), mat(0x3b4a2a), 0, 1.03, 0, upper);
    m(box(0.2, 0.04, 0.4), mat(0x222222), 0.14, 0.98, 0, upper);
    m(box(0.05, 0.2, 0.1), mat(0xd4af37), 0.22, 0.45, 0.2, upper);
  } else if (variant === 'N') {
    m(sph(0.24), mat(0x7a1f2b), -0.03, 0.97, 0, upper).scale.set(1, 0.45, 1); // beret
  } else if (variant === 'B') {
    m(sph(0.27), mat(0x55663a), 0, 0.92, 0, upper).scale.set(1.1, 0.8, 1.1); // ghillie hood
    m(sph(0.35), mat(0x4d5b33), -0.1, 0.4, 0, upper).scale.set(0.9, 1.1, 1.2);
  } else {
    const helm = m(sph(0.27), mat(variant === 'A' ? 0x5a6440 : OLIVE), 0, 0.92, 0, upper);
    helm.scale.set(1, 0.7, 1);
  }
  // weapon
  const gunLen = variant === 'B' ? 1.5 : variant === 'K' ? 0.35 : variant === 'N' ? 0.6 : 0.9;
  const gun = m(box(gunLen, 0.1, 0.1), mat(GUN), 0.25 + gunLen / 2, 0.45, 0.18, upper);
  if (variant === 'B') m(cyl(0.05, 0.05, 0.3, 6), mat(0x111111), 0.5, 0.56, 0.18, upper).rotation.z = Math.PI / 2;
  // arms
  m(box(0.5, 0.14, 0.14), mat(bodyCol), 0.2, 0.45, 0.27, upper);
  m(box(0.5, 0.14, 0.14), mat(bodyCol), 0.2, 0.45, -0.1, upper).rotation.y = 0.5;
  g.userData.aim = upper;
  g.userData.muzzle = new THREE.Vector3(0.25 + gunLen, 1.15, 0.18);
  g.userData.gun = gun;
  return g;
}

function tank(side) {
  const C = TEAM_COLORS[side];
  const g = new THREE.Group();
  const hull = new THREE.Group();
  g.add(hull);
  m(box(3.0, 0.7, 2.0), mat(C.dark), 0, 0.6, 0, hull);
  m(box(2.6, 0.35, 1.8), mat(C.main), -0.1, 1.05, 0, hull);
  m(box(0.6, 0.5, 1.9), mat(C.dark), 1.35, 0.55, 0, hull).rotation.z = 0.5;
  // tracks
  for (const z of [-1.0, 1.0]) {
    m(box(3.2, 0.6, 0.45), mat(0x2b2b2b), 0, 0.32, z, hull);
    for (let i = -1.2; i <= 1.21; i += 0.6) m(cyl(0.22, 0.22, 0.5, 8), mat(0x444444), i, 0.28, z, hull).rotation.x = Math.PI / 2;
  }
  // ERA blocks
  for (let i = -0.8; i <= 0.81; i += 0.4) m(box(0.32, 0.12, 0.25), mat(KHAKI), i, 1.27, 0.75, hull);
  const turret = new THREE.Group();
  turret.position.set(-0.1, 1.25, 0);
  g.add(turret);
  m(box(1.4, 0.55, 1.3), mat(C.main), 0, 0.27, 0, turret);
  m(box(0.4, 0.4, 1.1), mat(C.dark), -0.75, 0.25, 0, turret);
  m(cyl(0.11, 0.13, 2.4, 8), mat(0x333333), 1.8, 0.3, 0, turret).rotation.z = Math.PI / 2;
  m(cyl(0.17, 0.17, 0.4, 8), mat(0x333333), 2.9, 0.3, 0, turret).rotation.z = Math.PI / 2;
  m(cyl(0.18, 0.2, 0.2, 10), mat(0x333333), -0.2, 0.62, 0.35, turret);
  m(box(0.4, 0.06, 0.06), mat(0x111111), 0.05, 0.75, 0.35, turret);
  g.userData.aim = turret;
  g.userData.body = hull;
  g.userData.muzzle = new THREE.Vector3(3.1, 1.55, 0);
  return g;
}

function heli(side) {
  const C = TEAM_COLORS[side];
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.4;
  g.add(body);
  const fus = m(sph(0.8, 12), mat(C.main), 0, 0, 0, body);
  fus.scale.set(1.7, 0.85, 0.75);
  const cock = m(sph(0.5, 10), mat(0x9fd3ff, { transparent: true, opacity: 0.8 }), 0.9, 0.2, 0, body);
  cock.scale.set(1, 0.8, 0.8);
  m(box(2.6, 0.25, 0.25), mat(C.dark), -2.0, 0.15, 0, body);
  m(box(0.4, 0.8, 0.08), mat(C.dark), -3.2, 0.5, 0, body);
  m(box(0.6, 0.06, 0.06), mat(0x222222), -3.2, 0.6, 0.12, body);
  // stub wings with pods
  m(box(0.4, 0.08, 2.2), mat(C.dark), -0.1, -0.15, 0, body);
  for (const z of [-1.05, 1.05]) m(cyl(0.14, 0.14, 0.8, 8), mat(0x333333), -0.1, -0.3, z, body).rotation.z = Math.PI / 2;
  m(cyl(0.08, 0.08, 0.6, 6), mat(0x222222), 1.4, -0.5, 0, body).rotation.z = Math.PI / 2;
  // skids
  for (const z of [-0.55, 0.55]) m(box(2.2, 0.06, 0.08), mat(0x333333), 0, -0.85, z, body);
  const rotor = new THREE.Group();
  rotor.position.set(0, 0.85, 0);
  body.add(rotor);
  m(cyl(0.1, 0.1, 0.3, 6), mat(0x222222), 0, -0.1, 0, rotor);
  for (let i = 0; i < 4; i++) {
    const b = m(box(3.6, 0.04, 0.22), mat(0x1a1a1a), 0, 0.05, 0, rotor);
    b.rotation.y = (i * Math.PI) / 4 * 2 / 2;
    b.rotation.y = i * Math.PI / 4;
  }
  g.userData.rotor = rotor;
  g.userData.aim = body;
  g.userData.bob = body;
  g.userData.muzzle = new THREE.Vector3(1.6, 1.9, 0);
  return g;
}

// Command post for the board king, general soldier for duel
function hq(side) {
  const C = TEAM_COLORS[side];
  const g = new THREE.Group();
  m(box(2.2, 0.9, 2.2), mat(0x5c5a4e), 0, 0.45, 0, g);
  m(box(2.4, 0.2, 2.4), mat(0x4a483e), 0, 0.95, 0, g);
  // sandbags ring
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    m(box(0.6, 0.3, 0.35), mat(KHAKI), Math.cos(a) * 1.55, 0.15, Math.sin(a) * 1.55, g).rotation.y = -a;
  }
  // antenna & flag
  m(cyl(0.04, 0.04, 2.6, 5), mat(0x333333), 0.7, 2.2, -0.7, g);
  const pole = m(cyl(0.05, 0.05, 2.2, 5), mat(0xcccccc), -0.7, 2.0, 0.7, g);
  void pole;
  const flag = m(box(0.9, 0.55, 0.04), mat(C.main), -0.25, 2.75, 0.7, g);
  g.userData.flag = flag;
  const gen = soldier(side, 'K');
  gen.position.set(0.4, 1.05, 0.3);
  gen.scale.setScalar(0.8);
  g.add(gen);
  g.userData.aim = gen;
  return g;
}

export function unitModel(t, side, ctx = 'board') {
  let g;
  switch (t) {
    case 'R': g = tank(side); break;
    case 'Q': g = heli(side); break;
    case 'K': g = ctx === 'board' ? hq(side) : soldier(side, 'K'); break;
    default: g = soldier(side, t); break;
  }
  g.userData.kind = t;
  return g;
}

export function makeTree(scale = 1, snowy = false, dry = false) {
  const g = new THREE.Group();
  m(cyl(0.15, 0.22, 1.2, 6), mat(0x5a3d22), 0, 0.6, 0, g);
  const leaf = mat(snowy ? 0xe8eef2 : dry ? 0x8f8a4a : 0x2f5d2b);
  m(new THREE.ConeGeometry(1.0, 1.8, 7), leaf, 0, 1.8, 0, g);
  m(new THREE.ConeGeometry(0.75, 1.4, 7), leaf, 0, 2.5, 0, g);
  g.scale.setScalar(scale);
  return g;
}

export function makeFactory(side) {
  const C = TEAM_COLORS[side];
  const g = new THREE.Group();
  m(box(4.2, 2.2, 3), mat(0x7a6f62), 0, 1.1, 0, g);
  // saw-tooth roof
  for (let i = -1.4; i <= 1.41; i += 1.4) {
    const r = m(box(1.4, 0.8, 3.05), mat(0x5b5248), i, 2.4, 0, g);
    r.rotation.z = 0.35;
  }
  m(cyl(0.3, 0.4, 3.2, 8), mat(0x6b5a4a), 1.6, 3.0, -1.0, g);
  m(cyl(0.25, 0.32, 2.6, 8), mat(0x6b5a4a), 0.8, 2.7, -1.1, g);
  m(box(4.25, 0.3, 3.05), mat(C.main), 0, 1.9, 0, g);
  m(box(1.2, 1.2, 0.1), mat(0x3a3a3a), -1, 0.6, 1.52, g);
  g.userData.chimneys = [new THREE.Vector3(1.6, 4.6, -1.0), new THREE.Vector3(0.8, 4.0, -1.1)];
  return g;
}

export function makeDrone(side) {
  const C = TEAM_COLORS[side];
  const g = new THREE.Group();
  m(box(0.5, 0.15, 0.5), mat(0x222222), 0, 0, 0, g);
  m(box(0.3, 0.12, 0.25), mat(C.main), 0.1, 0.12, 0, g);
  m(cyl(0.08, 0.08, 0.4, 6), mat(0x556633), 0.35, -0.05, 0, g).rotation.z = Math.PI / 2; // warhead
  const props = [];
  for (const [x, z] of [[0.4, 0.4], [0.4, -0.4], [-0.4, 0.4], [-0.4, -0.4]]) {
    const arm = m(box(0.6, 0.05, 0.06), mat(0x333333), x / 2, 0, z / 2, g);
    arm.rotation.y = Math.atan2(-z, x);
    const p = m(cyl(0.25, 0.25, 0.02, 10), mat(0x888888, { transparent: true, opacity: 0.45 }), x, 0.08, z, g);
    props.push(p);
  }
  g.userData.props = props;
  return g;
}

export function makeObstacle(o, theme) {
  const g = new THREE.Group();
  if (o.kind === 'wall') {
    const col = theme === 'ruins' ? 0x8a8278 : theme === 'winter' ? 0xb7bec4 : theme === 'desert' ? 0xc2a878 : 0x8f8f86;
    m(box(o.w, 2.4, o.d), mat(col), 0, 1.2, 0, g).receiveShadow = true;
    m(box(o.w + 0.1, 0.15, o.d + 0.1), mat(0x6a655d), 0, 2.45, 0, g);
  } else if (o.kind === 'crate') {
    m(box(o.w, 1.5, o.d), mat(0x8b6b3d), 0, 0.75, 0, g);
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
  }
  g.position.set(o.x, 0, o.z);
  return g;
}
