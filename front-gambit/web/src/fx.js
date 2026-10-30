// Lightweight particle / effect system for both views.
import * as THREE from 'three';

const sphereGeo = new THREE.SphereGeometry(1, 8, 6);
const boxGeo = new THREE.BoxGeometry(1, 1, 1);

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
  }

  add(mesh, life, update) {
    this.scene.add(mesh);
    this.items.push({ mesh, life, max: life, update });
  }

  explosion(x, y, z, size = 1) {
    const fire = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: 0xffb030, transparent: true }));
    fire.position.set(x, y + 0.3 * size, z);
    this.add(fire, 0.45, (m, k) => {
      m.scale.setScalar(size * (0.4 + (1 - k) * 1.6));
      m.material.opacity = k;
      m.material.color.setHSL(0.08 * k, 1, 0.5 + 0.2 * k);
    });
    const flash = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
    flash.position.copy(fire.position);
    this.add(flash, 0.12, (m, k) => { m.scale.setScalar(size * (1.5 - k)); m.material.opacity = k; });
    const n = Math.round(5 + size * 3);
    for (let i = 0; i < n; i++) {
      const puff = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: 0x4a4440, transparent: true, opacity: 0.7, depthWrite: false }));
      const a = Math.random() * Math.PI * 2, r = Math.random() * size * 0.9;
      puff.position.set(x + Math.cos(a) * r, y + 0.3, z + Math.sin(a) * r);
      const vy = 1 + Math.random() * 2, vx = Math.cos(a) * 1.2 * size, vz = Math.sin(a) * 1.2 * size;
      const s0 = (0.3 + Math.random() * 0.5) * size;
      this.add(puff, 1.2 + Math.random() * 0.8, (m, k, dt) => {
        m.position.x += vx * dt * k; m.position.z += vz * dt * k; m.position.y += vy * dt;
        m.scale.setScalar(s0 * (1 + (1 - k) * 2));
        m.material.opacity = 0.6 * k;
      });
    }
    for (let i = 0; i < 6 * size; i++) {
      const d = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0x2a2520 }));
      d.position.set(x, y + 0.5, z);
      const v = new THREE.Vector3((Math.random() - 0.5) * 10, 4 + Math.random() * 6, (Math.random() - 0.5) * 10).multiplyScalar(0.6 + size * 0.2);
      d.scale.setScalar(0.12 + Math.random() * 0.15);
      this.add(d, 1.0, (m, k, dt) => {
        v.y -= 18 * dt;
        m.position.addScaledVector(v, dt);
        if (m.position.y < 0.05) { m.position.y = 0.05; v.set(0, 0, 0); }
        m.rotation.x += dt * 8; m.rotation.z += dt * 6;
      });
    }
    // scorch mark
    const sc = new THREE.Mesh(new THREE.CircleGeometry(1, 12), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.5, depthWrite: false }));
    sc.rotation.x = -Math.PI / 2;
    sc.position.set(x, 0.03, z);
    sc.scale.setScalar(size * 1.1);
    this.add(sc, 8, (m, k) => { m.material.opacity = 0.5 * Math.min(1, k * 3); });
  }

  muzzle(x, y, z, size = 0.35) {
    const f = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: 0xffe080, transparent: true }));
    f.position.set(x, y, z);
    f.scale.setScalar(size);
    this.add(f, 0.06, (m, k) => { m.material.opacity = k; });
  }

  spark(x, y, z, color = 0xffd27a) {
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color }));
      s.scale.setScalar(0.08);
      s.position.set(x, y, z);
      const v = new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 5, (Math.random() - 0.5) * 8);
      this.add(s, 0.25, (m, k, dt) => { v.y -= 20 * dt; m.position.addScaledVector(v, dt); });
    }
  }

  blood(x, z) {
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0x7a1010 }));
      s.scale.setScalar(0.1);
      s.position.set(x, 1, z);
      const v = new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 3, (Math.random() - 0.5) * 5);
      this.add(s, 0.3, (m, k, dt) => { v.y -= 15 * dt; m.position.addScaledVector(v, dt); });
    }
  }

  smoke(x, y, z, color = 0x777777, size = 0.6) {
    const puff = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false }));
    puff.position.set(x, y, z);
    this.add(puff, 3, (m, k, dt) => {
      m.position.y += dt * 1.2; m.position.x += dt * 0.6;
      m.scale.setScalar(size * (1 + (1 - k) * 2.5));
      m.material.opacity = 0.45 * k;
    });
  }

  // projectile travelling along an arc, then callback
  arc(from, to, height, time, color, onEnd, size = 0.3) {
    const p = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color }));
    p.scale.setScalar(size);
    this.add(p, time, (m, k) => {
      const t = 1 - k;
      m.position.lerpVectors(from, to, t);
      m.position.y += Math.sin(t * Math.PI) * height;
      if (k <= 0.0001 && onEnd) { onEnd(); onEnd = null; }
    });
    p.position.copy(from);
    this.items[this.items.length - 1].onDone = () => { if (onEnd) { onEnd(); onEnd = null; } };
  }

  ring(x, z, color, r = 2, life = 0.8) {
    const g = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 24), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    g.rotation.x = -Math.PI / 2;
    g.position.set(x, 0.1, z);
    this.add(g, life, (m, k) => { m.scale.setScalar(r * (1.2 - k)); m.material.opacity = k; });
  }

  text(x, y, z, str, color = '#ff5040') {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const g = c.getContext('2d');
    g.font = 'bold 40px sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 6;
    g.strokeStyle = '#000';
    g.strokeText(str, 64, 46);
    g.fillStyle = color;
    g.fillText(str, 64, 46);
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(2.4, 1.2, 1);
    sp.position.set(x, y, z);
    sp.renderOrder = 10;
    this.add(sp, 1.4, (m, k, dt) => { m.position.y += dt * 1.5; m.material.opacity = Math.min(1, k * 2); });
    this.items[this.items.length - 1].dispose = () => tex.dispose();
  }

  update(dt) {
    for (const it of this.items) {
      it.life -= dt;
      const k = Math.max(0, it.life / it.max);
      it.update(it.mesh, k, dt);
    }
    const dead = this.items.filter((it) => it.life <= 0);
    if (dead.length) {
      for (const it of dead) {
        if (it.onDone) it.onDone();
        this.scene.remove(it.mesh);
        if (it.mesh.material) it.mesh.material.dispose();
        if (it.dispose) it.dispose();
      }
      this.items = this.items.filter((it) => it.life > 0);
    }
  }

  clear() {
    for (const it of this.items) { this.scene.remove(it.mesh); if (it.mesh.material) it.mesh.material.dispose(); }
    this.items = [];
  }
}
