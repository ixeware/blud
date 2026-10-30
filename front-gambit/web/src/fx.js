// Particle / effect system shared by the board and duel views.
// Sprites use procedural textures; HDR colours (>1) feed the bloom pass.
import * as THREE from 'three';

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const sphereGeo = new THREE.SphereGeometry(1, 10, 8);
const ringGeo = new THREE.RingGeometry(0.82, 1, 40);

function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let TEX = null;
function textures() {
  if (TEX) return TEX;
  const glow = canvasTex(64, (g, n) => {
    const r = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.8)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, n, n);
  });
  const smoke = canvasTex(96, (g, n) => {
    for (let i = 0; i < 14; i++) {
      const x = n / 2 + (Math.random() - 0.5) * n * 0.45, y = n / 2 + (Math.random() - 0.5) * n * 0.45, rr = n * (0.14 + Math.random() * 0.2);
      const r = g.createRadialGradient(x, y, 0, x, y, rr);
      const v = 200 + Math.random() * 55;
      r.addColorStop(0, `rgba(${v},${v},${v},0.55)`); r.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = r; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
    }
  });
  const star = canvasTex(64, (g, n) => {
    g.translate(n / 2, n / 2);
    for (let k = 0; k < 4; k++) {
      g.rotate(Math.PI / 4);
      const r = g.createLinearGradient(0, 0, n / 2, 0);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.beginPath(); g.moveTo(0, -n * 0.06); g.lineTo(n / 2, 0); g.lineTo(0, n * 0.06); g.fill();
      g.beginPath(); g.moveTo(0, -n * 0.06); g.lineTo(-n / 2, 0); g.lineTo(0, n * 0.06); g.fill();
    }
    const r = g.createRadialGradient(0, 0, 0, 0, 0, n * 0.22);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(-n / 2, -n / 2, n, n);
  });
  const ring = canvasTex(128, (g, n) => {
    const r = g.createRadialGradient(n / 2, n / 2, n * 0.3, n / 2, n / 2, n / 2);
    r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(0.8, 'rgba(255,255,255,0.9)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, n, n);
  });
  TEX = { glow, smoke, star, ring };
  return TEX;
}

const HDR = (r, g, b) => new THREE.Color(r, g, b);

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.tex = textures();
    // fixed pool of point lights: never add/remove lights at runtime (that recompiles shaders)
    this.lights = [];
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffa040, 0, 10, 2);
      l.userData.t = 0;
      scene.add(l);
      this.lights.push(l);
    }
  }

  add(obj, life, update, opts = {}) {
    this.scene.add(obj);
    this.items.push({ obj, mesh: obj, life, max: life, update, delay: opts.delay || 0, dispose: opts.dispose });
    if (opts.delay) obj.visible = false;
    return obj;
  }

  sprite(tex, color, additive, opacity = 1) {
    const m = new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    return new THREE.Sprite(m);
  }

  flash(x, y, z, color = 0xffa040, power = 30, dur = 0.25, dist = 12) {
    const l = this.lights.reduce((a, b) => (a.userData.t < b.userData.t ? a : b));
    l.position.set(x, y + 1, z);
    l.color.setHex(color);
    l.distance = dist;
    l.userData.t = dur; l.userData.max = dur; l.userData.p = power;
  }

  explosion(x, y, z, size = 1) {
    const T = this.tex;
    this.flash(x, y, z, 0xff9a40, 40 * size, 0.35, 10 + size * 6);
    const fl = this.sprite(T.glow, HDR(6, 5, 3.5), true);
    fl.position.set(x, y + 0.6 * size, z);
    this.add(fl, 0.16, (m, k) => { m.scale.setScalar(size * (3 + (1 - k) * 4)); m.material.opacity = k; });
    for (let i = 0; i < 6 + size * 3; i++) {
      const s = this.sprite(T.glow, HDR(4, 2.6, 1), true);
      const a = Math.random() * Math.PI * 2, r = Math.random() * size * 0.8;
      const ox = Math.cos(a) * r, oz = Math.sin(a) * r, vy = 1 + Math.random() * 2.5;
      const s0 = size * (0.9 + Math.random() * 0.9);
      s.position.set(x + ox, y + 0.3 + Math.random() * size * 0.6, z + oz);
      this.add(s, 0.45 + Math.random() * 0.35, (m, k, dt) => {
        m.position.y += vy * dt;
        m.scale.setScalar(s0 * (0.6 + (1 - k) * 1.6));
        m.material.color.setRGB(1 + 3 * k, 0.35 + 2.3 * k * k, 0.1 + 0.9 * k * k * k);
        m.material.opacity = Math.min(1, k * 1.6);
      });
    }
    for (let i = 0; i < 5 + size * 4; i++) {
      const s = this.sprite(T.smoke, new THREE.Color(0.22, 0.2, 0.19), false, 0.0);
      const a = Math.random() * Math.PI * 2, r = Math.random() * size;
      s.position.set(x + Math.cos(a) * r, y + 0.5, z + Math.sin(a) * r);
      s.material.rotation = Math.random() * 6;
      const vx = Math.cos(a) * 0.8 * size, vz = Math.sin(a) * 0.8 * size, vy = 1.2 + Math.random() * 1.6;
      const s0 = size * (1 + Math.random() * 0.8);
      this.add(s, 1.8 + Math.random() * 1.2, (m, k, dt) => {
        m.position.x += vx * dt * k; m.position.z += vz * dt * k; m.position.y += vy * dt * (0.4 + k);
        m.scale.setScalar(s0 * (1 + (1 - k) * 2.6));
        m.material.opacity = 0.8 * Math.min(1, (1 - k) * 6) * k;
        m.material.rotation += dt * 0.3;
      }, { delay: 0.08 });
    }
    // sparks
    for (let i = 0; i < 6 + size * 4; i++) {
      const s = this.sprite(T.glow, HDR(5, 3.5, 1.2), true);
      s.scale.setScalar(0.18);
      s.position.set(x, y + 0.5, z);
      const v = new THREE.Vector3((Math.random() - 0.5) * 16, 4 + Math.random() * 9, (Math.random() - 0.5) * 16).multiplyScalar(0.5 + size * 0.25);
      this.add(s, 0.5 + Math.random() * 0.4, (m, k, dt) => { v.y -= 22 * dt; m.position.addScaledVector(v, dt); m.material.opacity = k; });
    }
    // debris chunks
    for (let i = 0; i < 4 + 3 * size; i++) {
      const d = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x2a2520 }));
      d.position.set(x, y + 0.5, z);
      d.castShadow = true;
      const v = new THREE.Vector3((Math.random() - 0.5) * 10, 4 + Math.random() * 6, (Math.random() - 0.5) * 10).multiplyScalar(0.6 + size * 0.2);
      d.scale.setScalar(0.12 + Math.random() * 0.18);
      this.add(d, 1.4, (m, k, dt) => {
        v.y -= 18 * dt;
        m.position.addScaledVector(v, dt);
        if (m.position.y < 0.05) { m.position.y = 0.05; v.multiplyScalar(0.2); }
        m.rotation.x += dt * 8; m.rotation.z += dt * 6;
      });
    }
    // ground shockwave
    const sw = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: T.ring, color: HDR(2.5, 2, 1.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    sw.rotation.x = -Math.PI / 2;
    sw.position.set(x, Math.max(0.12, y - 0.2), z);
    this.add(sw, 0.4, (m, k) => { m.scale.setScalar(size * (0.5 + (1 - k) * 5)); m.material.opacity = k; });
  }

  muzzle(x, y, z, size = 0.35) {
    const s = this.sprite(this.tex.star, HDR(5, 4, 2), true);
    s.position.set(x, y, z);
    s.material.rotation = Math.random() * Math.PI;
    s.scale.setScalar(size * 3);
    this.add(s, 0.06, (m, k) => { m.material.opacity = k; });
    if (size > 0.45) this.flash(x, y, z, 0xffc070, 18 * size, 0.08, 7);
  }

  spark(x, y, z, color = 0xffd27a) {
    const c = new THREE.Color(color).multiplyScalar(3);
    for (let i = 0; i < 5; i++) {
      const s = this.sprite(this.tex.glow, c, true);
      s.scale.setScalar(0.14);
      s.position.set(x, y, z);
      const v = new THREE.Vector3((Math.random() - 0.5) * 9, Math.random() * 6, (Math.random() - 0.5) * 9);
      this.add(s, 0.28, (m, k, dt) => { v.y -= 20 * dt; m.position.addScaledVector(v, dt); m.material.opacity = k; });
    }
  }

  blood(x, z) {
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0x8a1010 }));
      s.scale.setScalar(0.1);
      s.position.set(x, 1, z);
      const v = new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 3, (Math.random() - 0.5) * 5);
      this.add(s, 0.3, (m, k, dt) => { v.y -= 15 * dt; m.position.addScaledVector(v, dt); });
    }
  }

  smoke(x, y, z, color = 0x777777, size = 0.6) {
    const s = this.sprite(this.tex.smoke, new THREE.Color(color), false, 0);
    s.position.set(x, y, z);
    s.material.rotation = Math.random() * 6;
    this.add(s, 3, (m, k, dt) => {
      m.position.y += dt * 1.2; m.position.x += dt * 0.6;
      m.scale.setScalar(size * 2 * (1 + (1 - k) * 2.5));
      m.material.opacity = 0.55 * k * Math.min(1, (1 - k) * 8);
      m.material.rotation += dt * 0.2;
    });
  }

  arc(from, to, height, time, color, onEnd, size = 0.3) {
    const p = this.sprite(this.tex.glow, new THREE.Color(color).multiplyScalar(3), true);
    p.scale.setScalar(size * 3);
    p.position.copy(from);
    let fired = false;
    const end = () => { if (!fired && onEnd) { fired = true; onEnd(); } };
    this.add(p, time, (m, k) => {
      const t = 1 - k;
      m.position.lerpVectors(from, to, t);
      m.position.y += Math.sin(t * Math.PI) * height;
      if (Math.random() < 0.5) this.smoke(m.position.x, m.position.y, m.position.z, 0x8a8a8a, 0.18);
    }, { dispose: end });
  }

  ring(x, z, color, r = 2, life = 0.8) {
    const g = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), map: this.tex.ring, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    g.rotation.x = -Math.PI / 2;
    g.position.set(x, 0.4, z);
    this.add(g, life, (m, k) => { m.scale.setScalar(r * (1.2 - k)); m.material.opacity = k; });
  }

  beam(a, b, color = 0xfee761, life = 1.2) {
    const len = a.distanceTo(b);
    const t = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    t.scale.set(0.16, 0.16, len);
    t.position.copy(a).lerp(b, 0.5);
    t.lookAt(b);
    this.add(t, life, (m, k) => { m.material.opacity = Math.min(1, k * 2) * (0.6 + 0.4 * Math.sin(k * 30)); });
  }

  text(x, y, z, str, color = '#ff5040', life = 1.6) {
    const c = document.createElement('canvas');
    const font = '28px "Press Start 2P", monospace';
    let g = c.getContext('2d');
    g.font = font;
    const w = Math.max(256, Math.ceil(g.measureText(str).width + 28));
    c.width = w; c.height = 64;
    g = c.getContext('2d');
    g.font = font;
    g.textAlign = 'center';
    g.lineWidth = 8;
    g.strokeStyle = '#000';
    g.strokeText(str, w / 2, 44);
    g.fillStyle = color;
    g.fillText(str, w / 2, 44);
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(4 * w / 256, 1, 1);
    sp.position.set(x, y, z);
    sp.renderOrder = 10;
    this.add(sp, life, (m, k, dt) => { m.position.y += dt * 1.4; m.material.opacity = Math.min(1, k * 2); }, { dispose: () => tex.dispose() });
  }

  shell(x, y, z) {
    const s = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xd9a032 }));
    s.scale.set(0.06, 0.06, 0.14);
    s.position.set(x, y, z);
    const v = new THREE.Vector3((Math.random() - 0.5) * 3, 3 + Math.random() * 2, (Math.random() - 0.5) * 3);
    this.add(s, 0.6, (m, k, dt) => {
      v.y -= 20 * dt;
      m.position.addScaledVector(v, dt);
      if (m.position.y < 0.04) { m.position.y = 0.04; v.multiplyScalar(0.3); v.y = Math.abs(v.y); }
      m.rotation.x += dt * 20;
    });
  }

  tracer(a, b, color = 0xffe066, width = 0.08, life = 0.18) {
    const len = a.distanceTo(b);
    const t = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    t.scale.set(width, width, len);
    t.position.copy(a).lerp(b, 0.5);
    t.lookAt(b);
    this.add(t, life, (m, k) => { m.material.opacity = k; });
  }

  dropIn(model) {
    if (!model) return;
    const y0 = model.position.y;
    this.items.push({ obj: new THREE.Object3D(), life: 0.5, max: 0.5, delay: 0, update: (m, k) => { model.position.y = y0 + k * k * 8; } });
  }

  fireBurst(x, z) {
    for (let i = 0; i < 12; i++) {
      const f = this.sprite(this.tex.glow, HDR(4, 1.8, 0.4), true);
      const ox = (Math.random() - 0.5) * 3, oz = (Math.random() - 0.5) * 3;
      f.position.set(x + ox, 0.5, z + oz);
      const s0 = 0.8 + Math.random() * 1.2;
      this.add(f, 0.9 + Math.random() * 0.6, (m, k, dt) => { m.position.y += dt * 2.5; m.scale.setScalar(s0 * (0.5 + k)); m.material.opacity = k; }, { delay: Math.random() * 0.2 });
    }
    this.flash(x, 1, z, 0xff7a20, 25, 0.5, 10);
    this.smoke(x, 1, z, 0x222222, 1);
  }

  cloud(x, z, color) {
    for (let i = 0; i < 10; i++) {
      const p = this.sprite(this.tex.smoke, new THREE.Color(color), false, 0);
      const a = Math.random() * Math.PI * 2, r = Math.random() * 3;
      p.position.set(x + Math.cos(a) * r, 0.6, z + Math.sin(a) * r);
      p.material.rotation = Math.random() * 6;
      const s0 = 2 + Math.random() * 1.5;
      this.add(p, 2.2, (m, k, dt) => { m.position.y += dt * 0.6; m.scale.setScalar(s0 * (1 + (1 - k) * 1.5)); m.material.opacity = 0.75 * k * Math.min(1, (1 - k) * 6); });
    }
  }

  flakBurst(x, y, z) {
    const f = this.sprite(this.tex.smoke, new THREE.Color(0.12, 0.12, 0.12), false, 0.9);
    f.position.set(x, y, z);
    this.add(f, 1.1, (m, k) => { m.scale.setScalar(0.6 + (1 - k) * 2.4); m.material.opacity = k * 0.85; });
    this.muzzle(x, y, z, 0.5);
  }

  bubble(x, y, z, color) {
    const b = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.5), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    b.position.set(x, y, z);
    this.add(b, 0.8, (m, k) => { m.scale.setScalar(1.8 + (1 - k) * 0.6); m.material.opacity = 0.4 * k; });
  }

  dust(x, z, color = 0x9a8a70) {
    const p = this.sprite(this.tex.smoke, new THREE.Color(color), false, 0);
    p.position.set(x + (Math.random() - 0.5), 0.3, z + (Math.random() - 0.5));
    this.add(p, 1.2, (m, k, dt) => { m.position.y += dt * 0.4; m.scale.setScalar(0.8 + (1 - k) * 1.6); m.material.opacity = 0.45 * k * Math.min(1, (1 - k) * 6); });
  }

  update(dt) {
    for (const l of this.lights) {
      if (l.userData.t > 0) { l.userData.t -= dt; l.intensity = Math.max(0, l.userData.p * (l.userData.t / l.userData.max)); }
      else l.intensity = 0;
    }
    for (const it of this.items) {
      if (it.delay > 0) { it.delay -= dt; if (it.delay <= 0) it.obj.visible = true; else continue; }
      it.life -= dt;
      const k = Math.max(0, it.life / it.max);
      it.update(it.obj, k, dt);
    }
    if (this.items.some((it) => it.life <= 0)) {
      const keep = [];
      for (const it of this.items) {
        if (it.life > 0) { keep.push(it); continue; }
        if (it.dispose) it.dispose();
        this.scene.remove(it.obj);
        if (it.obj.material) it.obj.material.dispose();
      }
      this.items = keep;
    }
  }

  clear() {
    for (const it of this.items) { this.scene.remove(it.obj); if (it.obj.material) it.obj.material.dispose(); }
    this.items = [];
  }
}
