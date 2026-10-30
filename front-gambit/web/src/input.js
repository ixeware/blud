// Touch twin-stick + keyboard/mouse input for real-time phases.

export class Stick {
  constructor(el) {
    this.el = el;
    this.knob = el.querySelector('.knob');
    this.x = 0; this.y = 0; this.active = false; this.id = null;
    // last meaningful direction, kept after release so aim never snaps back
    this.lastX = 0; this.lastY = 0;
    const start = (e) => {
      const t = e.changedTouches ? e.changedTouches[0] : e;
      this.id = e.changedTouches ? t.identifier : 'mouse';
      this.active = true;
      this.move(t);
      e.preventDefault();
      e.stopPropagation();
    };
    const move = (e) => {
      if (!this.active) return;
      const list = e.changedTouches ? [...e.changedTouches] : [e];
      for (const t of list) if ((e.changedTouches ? t.identifier : 'mouse') === this.id) this.move(t);
      if (e.cancelable) e.preventDefault();
    };
    const end = (e) => {
      const list = e.changedTouches ? [...e.changedTouches] : [e];
      for (const t of list) {
        if ((e.changedTouches ? t.identifier : 'mouse') === this.id) {
          this.active = false; this.x = 0; this.y = 0; this.id = null;
          this.knob.style.transform = 'translate(-50%,-50%)';
        }
      }
    };
    el.addEventListener('touchstart', start, { passive: false });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    el.addEventListener('mousedown', start);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
  }

  move(t) {
    const r = this.el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = (t.clientX - cx) / (r.width / 2), dy = (t.clientY - cy) / (r.height / 2);
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    this.x = dx; this.y = dy;
    if (l > 0.2) { this.lastX = dx / Math.max(l, 1e-6); this.lastY = dy / Math.max(l, 1e-6); }
    this.knob.style.transform = `translate(calc(-50% + ${dx * r.width * 0.35}px), calc(-50% + ${dy * r.height * 0.35}px))`;
  }

  get mag() { return Math.hypot(this.x, this.y); }
}

export class Controls {
  constructor() {
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, down: false, has: false };
    this.abilityQueued = false;
    this.reloadQueued = false;
    this.touchMode = false;
    this.aimAssist = true;
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'ShiftLeft') this.abilityQueued = true;
      if (e.code === 'KeyR') this.reloadQueued = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    // any touch switches off mouse aiming for good: phones emit fake mouse events at old tap points,
    // which used to swing the soldier around when the aim stick was released
    window.addEventListener('touchstart', () => { this.touchMode = true; this.mouse.has = false; }, { capture: true, passive: true });
  }

  bindSticks(left, right, abilityBtn, reloadBtn) {
    this.left = new Stick(left);
    this.right = new Stick(right);
    const fire = (e) => { this.abilityQueued = true; e.preventDefault(); e.stopPropagation(); };
    abilityBtn.addEventListener('touchstart', fire, { passive: false });
    abilityBtn.addEventListener('mousedown', fire);
    if (reloadBtn) {
      const rl = (e) => { this.reloadQueued = true; e.preventDefault(); e.stopPropagation(); };
      reloadBtn.addEventListener('touchstart', rl, { passive: false });
      reloadBtn.addEventListener('mousedown', rl);
    }
  }

  bindMouse(canvas, isActive) {
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || this.touchMode) return;
      this.mouse.x = (e.clientX / innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / innerHeight) * 2 + 1;
      this.mouse.has = true;
    });
    canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && !this.touchMode && isActive() && e.button === 0) this.mouse.down = true; });
    window.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') this.mouse.down = false; });
  }

  reset() {
    this.abilityQueued = false; this.reloadQueued = false;
    if (this.right) { this.right.lastX = 0; this.right.lastY = 0; }
  }

  // Duel input: world-space movement + aim. `assist(ax, az)` may bend the aim toward a nearby enemy.
  duelInput(unitPos, groundPoint, assist) {
    let mx = 0, mz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    if (this.left && this.left.mag > 0.12) { mx = this.left.x; mz = this.left.y; }
    let ax = 0, az = 0, fire = false, tx, tz;
    if (this.right && this.right.active && this.right.mag > 0.15) {
      ax = this.right.x; az = this.right.y;
      fire = this.right.mag > 0.45;
      if (this.aimAssist && assist) [ax, az] = assist(ax, az);
    } else if (!this.touchMode && this.mouse.has && unitPos && groundPoint) {
      const p = groundPoint(this.mouse.x, this.mouse.y);
      if (p) {
        ax = p.x - unitPos.x; az = p.z - unitPos.z;
        tx = p.x; tz = p.z;
        const l = Math.hypot(ax, az) || 1;
        ax /= l; az /= l;
      }
      fire = this.mouse.down;
    }
    // ax = az = 0 means "keep current aim" in the simulation
    const ab = this.abilityQueued, reload = this.reloadQueued;
    this.abilityQueued = false;
    this.reloadQueued = false;
    const r = { mx: +mx.toFixed(2), mz: +mz.toFixed(2), ax: +ax.toFixed(3), az: +az.toFixed(3), fire, ab, reload };
    if (tx !== undefined) { r.tx = tx; r.tz = tz; }
    return r;
  }

  droneInput() {
    let mx = 0, my = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my -= 1;
    if (this.left && this.left.mag > 0.1) { mx = this.left.x; my = -this.left.y; }
    if (this.right && this.right.mag > 0.1) { mx = this.right.x; my = -this.right.y; }
    const ab = this.abilityQueued;
    this.abilityQueued = false;
    return { mx: +mx.toFixed(2), my: +my.toFixed(2), ab };
  }
}
