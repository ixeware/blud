// Shared environment pieces: sky dome, clouds, terrain with hills, wind-swayed grass, rocks, water,
// contact shadows and lighting presets. Used by both the board and the duel arena.
import * as THREE from 'three';
import { mat, tex } from './models.js';

export const LIGHTS = {
  day: { top: 0x2f6fc8, horizon: 0xbfdcf0, bottom: 0x7d8f5a, sun: 0xfff0d2, sunI: 2.6, sunPos: [24, 42, 16], sky: 0xd4e8ff, ground: 0x5a5040, hemiI: 1.05, fog: [90, 230] },
  sunset: { top: 0x2c4a8a, horizon: 0xf4bc86, bottom: 0x6a5a48, sun: 0xffd2a0, sunI: 2.7, sunPos: [42, 22, 10], sky: 0xffe6cc, ground: 0x5a5048, hemiI: 1.2, fog: [90, 220] },
  overcast: { top: 0x6f8296, horizon: 0xc6ced6, bottom: 0x6a6a64, sun: 0xeef2f6, sunI: 1.6, sunPos: [12, 44, 22], sky: 0xe2e8ee, ground: 0x5e5e5a, hemiI: 1.35, fog: [70, 190] },
  night: { top: 0x04060e, horizon: 0x1a2440, bottom: 0x08080c, sun: 0x8fa0ff, sunI: 0.55, sunPos: [-20, 40, 10], sky: 0x3a4a80, ground: 0x101014, hemiI: 0.4, fog: [30, 120] },
};

export function makeSky(preset) {
  const L = LIGHTS[preset] || LIGHTS.day;
  const sunDir = new THREE.Vector3(...L.sunPos).normalize();
  const m = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(L.top) }, horizon: { value: new THREE.Color(L.horizon) }, bottom: { value: new THREE.Color(L.bottom) },
      sunDir: { value: sunDir }, sunColor: { value: new THREE.Color(L.sun) }, night: { value: preset === 'night' ? 1 : 0 },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor; uniform float night;
      varying vec3 vDir;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(horizon, bottom, pow(clamp(-h, 0.0, 1.0), 0.35));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c += sunColor * (pow(s, 600.0) * 4.0 + pow(s, 14.0) * 0.28);
        if (night > 0.5 && h > 0.05) { float st = step(0.9975, hash(floor(d * 220.0))); c += vec3(st) * 1.6 * h; }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(320, 32, 16), m);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  return sky;
}

export function applyLights(scene, hemi, sun, preset) {
  const L = LIGHTS[preset] || LIGHTS.day;
  hemi.color.setHex(L.sky); hemi.groundColor.setHex(L.ground); hemi.intensity = L.hemiI;
  sun.color.setHex(L.sun); sun.intensity = L.sunI;
  sun.position.set(...L.sunPos);
  scene.fog = new THREE.Fog(L.horizon, L.fog[0], L.fog[1]);
  scene.background = new THREE.Color(L.horizon);
}

export function makeClouds(count = 14, radius = 150, y = 46, dark = false) {
  const g = new THREE.Group();
  const puffs = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.3;
    const r = radius * (0.45 + Math.random() * 0.55);
    const cx = Math.cos(a) * r, cy = y + Math.random() * 14, cz = Math.sin(a) * r;
    const n = 4 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) puffs.push([cx + (k - n / 2) * 3.2 + Math.random() * 2, cy + Math.random() * 2, cz + (Math.random() - 0.5) * 4, 3 + Math.random() * 3, 2 + Math.random() * 2, 3 + Math.random() * 2.5]);
  }
  const cm = new THREE.MeshLambertMaterial({ color: dark ? 0x6a7080 : 0xffffff, emissive: dark ? 0x101218 : 0x404448 });
  const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), cm, puffs.length);
  const d = new THREE.Object3D();
  puffs.forEach(([x, yy, z, sx, sy, sz], i) => { d.position.set(x, yy, z); d.scale.set(sx, sy, sz); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
  g.add(im);
  g.userData.update = (dt) => { g.rotation.y += dt * 0.004; };
  return g;
}

// cheap 2D value noise
function hash2(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function noise2(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z) { return noise2(x, z) * 0.6 + noise2(x * 2.1, z * 2.1) * 0.28 + noise2(x * 4.3, z * 4.3) * 0.12; }

// flatMask(x, z) -> 0 where the ground must stay flat, 1 where hills may rise
export function makeTerrain({ size = 300, seg = 110, base = 0x86a066, texName = 'tex_grass', repeat = 46, hill = 7, flatMask, tint = [0.82, 1.08], y = -0.4 }) {
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c0 = new THREE.Color(base);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const mask = flatMask ? flatMask(x, z) : 1;
    const n = fbm(x * 0.03, z * 0.03);
    pos.setY(i, mask * (n * hill + Math.max(0, (Math.hypot(x, z) - 90) * 0.12)));
    const shade = tint[0] + (tint[1] - tint[0]) * fbm(x * 0.08 + 7, z * 0.08 + 3);
    colors[i * 3] = c0.r * shade; colors[i * 3 + 1] = c0.g * shade; colors[i * 3 + 2] = c0.b * shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, map: tex(texName, repeat) }));
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

const windMats = [];
export function windMaterial(color) {
  const m = new THREE.MeshLambertMaterial({ color, vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = { value: 0 };
    m.userData.shader = sh;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>
       #ifdef USE_INSTANCING
       float ph = instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.27;
       #else
       float ph = 0.0;
       #endif
       transformed.x += sin(uTime * 2.2 + ph) * 0.12 * position.y;
       transformed.z += cos(uTime * 1.7 + ph) * 0.08 * position.y;`);
  };
  windMats.push(m);
  return m;
}
export function updateWind(t) { for (const m of windMats) if (m.userData.shader) m.userData.shader.uniforms.uTime.value = t; }

function tuftGeometry() {
  const g = new THREE.BufferGeometry();
  const verts = [], cols = [];
  const n = 7;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + (k % 2) * 0.3;
    const tilt = 0.25 + (k % 3) * 0.12;
    const h = 0.45 + (k % 4) * 0.08;
    const bx = Math.cos(a), bz = Math.sin(a), px = -bz * 0.06, pz = bx * 0.06;
    const tx = bx * tilt, tz = bz * tilt;
    verts.push(px, 0, pz, -px, 0, -pz, tx, h, tz);
    cols.push(0.45, 0.55, 0.32, 0.45, 0.55, 0.32, 1.05, 1.1, 0.7);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

// avoid(x, z) -> true where nothing should be placed; heightAt(x, z) for hills
export function scatterGrass({ count = 2200, area = 110, color = 0x6f9a3e, avoid, heightAt = () => -0.4, scale = 1 }) {
  const mesh = new THREE.InstancedMesh(tuftGeometry(), windMaterial(color), count);
  const d = new THREE.Object3D();
  const col = new THREE.Color();
  let n = 0;
  for (let tries = 0; n < count && tries < count * 6; tries++) {
    const x = (Math.random() * 2 - 1) * area, z = (Math.random() * 2 - 1) * area;
    if (avoid && avoid(x, z)) continue;
    d.position.set(x, heightAt(x, z), z);
    d.rotation.y = Math.random() * Math.PI;
    const s = (0.7 + Math.random() * 0.9) * scale;
    d.scale.set(s, s * (0.8 + Math.random() * 0.6), s);
    d.updateMatrix();
    mesh.setMatrixAt(n, d.matrix);
    col.setHSL(0.22 + Math.random() * 0.06, 0.45, 0.35 + Math.random() * 0.15);
    mesh.setColorAt(n, col);
    n++;
  }
  mesh.count = n;
  mesh.receiveShadow = true;
  return mesh;
}

export function scatterRocks({ count = 60, area = 110, avoid, heightAt = () => -0.4, color = 0x8a8680 }) {
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat(color, { flatShading: true }), count);
  const d = new THREE.Object3D();
  let n = 0;
  for (let tries = 0; n < count && tries < count * 8; tries++) {
    const x = (Math.random() * 2 - 1) * area, z = (Math.random() * 2 - 1) * area;
    if (avoid && avoid(x, z)) continue;
    const s = 0.3 + Math.random() * 1.1;
    d.position.set(x, heightAt(x, z) + s * 0.3, z);
    d.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    d.scale.set(s, s * (0.5 + Math.random() * 0.5), s * (0.7 + Math.random() * 0.5));
    d.updateMatrix();
    mesh.setMatrixAt(n++, d.matrix);
  }
  mesh.count = n;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const waterMats = [];
export function makeWater(w, l, color = 0x1f4f7a) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, deep: { value: new THREE.Color(color) }, shallow: { value: new THREE.Color(0x3f7f9f) }, foam: { value: new THREE.Color(0xc8e0ee) } },
    vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uTime; uniform vec3 deep; uniform vec3 shallow; uniform vec3 foam; varying vec2 vUv; varying vec3 vW;
      void main(){
        float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
        vec3 c = mix(shallow, deep, edge);
        float ripple = sin(vW.z * 0.9 - uTime * 2.4 + sin(vW.x * 1.3 + uTime) * 1.5) * 0.5 + 0.5;
        float ripple2 = sin(vW.z * 2.3 + uTime * 1.7 + vW.x * 2.0) * 0.5 + 0.5;
        c += foam * pow(ripple * ripple2, 10.0) * 0.18;
        c = mix(foam, c, smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x));
        gl_FragColor = vec4(c, 0.9);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
  });
  waterMats.push(m);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, l, 1, 1), m);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}
export function updateWater(t) { for (const m of waterMats) m.uniforms.uTime.value = t; }

let blobTex = null;
export function blobMaterial() {
  if (!blobTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(0,0,0,0.55)'); r.addColorStop(0.6, 'rgba(0,0,0,0.25)'); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    blobTex = new THREE.CanvasTexture(c);
  }
  return new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
}
const blobGeo = new THREE.PlaneGeometry(1, 1);
export function makeBlob(size = 2) {
  const b = new THREE.Mesh(blobGeo, blobMaterial());
  b.rotation.x = -Math.PI / 2;
  b.scale.set(size, size, size);
  b.renderOrder = 1;
  return b;
}
