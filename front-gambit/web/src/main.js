// Front Gambit — app controller: menus, modes (AI / hot-seat / online), board + real-time phases.
import * as THREE from 'three';
import {
  newGame, apply, finishDuel, finishDrone, legalMovesFor, abilityTargets, shopTargets, canBuy,
  territory, income, UNITS, SHOP, SIDE_NAME, MAX_TURNS, other,
} from './rules.js';
import { aiChoose } from './ai.js';
import { BoardView } from './boardView.js';
import { DuelView } from './duelView.js';
import { DuelSim, KINDS } from './duel.js';
import { DroneSim, DRONE_BATTERY } from './drone.js';
import { Controls } from './input.js';
import { initAudio, sfx, setSound, droneBuzz } from './audio.js';
import { Net } from './net.js';

const $ = (id) => document.getElementById(id);
const show = (el, on = true) => (typeof el === 'string' ? $(el) : el).classList.toggle('hidden', !on);

// ---------- settings ----------
const settings = { diff: 1, duel: 'manual', gfx: 'high', sound: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem('fg-settings') || '{}')); } catch (e) { /* ignore */ }
function saveSettings() { try { localStorage.setItem('fg-settings', JSON.stringify(settings)); } catch (e) { /* ignore */ } }
$('setDiff').value = settings.diff;
$('setDuel').value = settings.duel;
$('setGfx').value = settings.gfx;
$('setSound').checked = settings.sound;
setSound(settings.sound);
$('setDiff').onchange = (e) => { settings.diff = +e.target.value; saveSettings(); };
$('setDuel').onchange = (e) => { settings.duel = e.target.value; saveSettings(); };
$('setGfx').onchange = (e) => { settings.gfx = e.target.value; saveSettings(); applyGfx(); };
$('setSound').onchange = (e) => { settings.sound = e.target.checked; setSound(settings.sound); saveSettings(); };

// ---------- renderer ----------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
function applyGfx() {
  renderer.shadowMap.enabled = settings.gfx === 'high';
  renderer.setPixelRatio(settings.gfx === 'high' ? Math.min(window.devicePixelRatio, 2) : Math.min(window.devicePixelRatio, 1.25));
  resize();
}
const board = new BoardView(renderer);
const duel = new DuelView(renderer);
board.onSound = (n) => sfx(n);
const controls = new Controls();
controls.bindSticks($('stickL'), $('stickR'), $('abBtn'));
controls.bindMouse(canvas, () => app.rtView === 'duel');

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  board.resize(w, h);
  duel.resize(w, h);
}
window.addEventListener('resize', resize);
applyGfx();

// ---------- app state ----------
const app = {
  mode: null, // 'ai' | 'hot' | 'host' | 'guest'
  state: null,
  net: null,
  mySide: 'w',
  sim: null,
  simKind: null,
  rtView: null, // 'duel' | 'drone' | null
  intro: 0,
  sel: -1,
  targeting: null, // {kind:'ability'|'shop', from, item, targets, sub}
  aiTimer: null,
  remoteInput: null,
  sendAcc: 0,
  pendingEv: [],
  pendingOd: [],
  lastTurnSeen: null,
  lastLogLen: 0,
};

const authority = () => app.mode !== 'guest';
const localSides = () => (app.mode === 'ai' ? ['w'] : app.mode === 'hot' ? ['w', 'b'] : app.mode === 'host' ? ['w'] : ['b']);
const isAiSide = (side) => app.mode === 'ai' && side === 'b';
function myTurn() {
  const s = app.state;
  return s && s.phase === 'board' && !s.winner && localSides().includes(s.turn);
}
function actingSide() { return app.mode === 'hot' ? app.state.turn : app.mySide; }
function viewerSides() { return app.mode === 'hot' ? [app.state.turn] : localSides(); }

// ---------- menu ----------
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { sfx('click'); b.closest('.screen').classList.add('hidden'); }));
document.querySelectorAll('#menu [data-act]').forEach((b) => b.addEventListener('click', () => {
  initAudio();
  sfx('click');
  const a = b.dataset.act;
  if (a === 'ai') startGame('ai');
  else if (a === 'hot') startGame('hot');
  else if (a === 'host') openLobby(true);
  else if (a === 'join') openLobby(false);
  else if (a === 'help') show('help');
}));
$('menuBtn').onclick = () => { sfx('click'); show('pause'); };
$('helpBtn2').onclick = () => show('help');
$('toggleSnd').onclick = () => { settings.sound = !settings.sound; setSound(settings.sound); saveSettings(); toast(settings.sound ? 'Звук включён' : 'Звук выключен'); };
$('quitBtn').onclick = () => quitToMenu();
$('overMenu').onclick = () => quitToMenu();

function quitToMenu() {
  clearTimeout(app.aiTimer);
  if (app.net) { app.net.destroy(); app.net = null; }
  app.mode = null; app.state = null; app.sim = null;
  endRtView();
  ['hud', 'pause', 'over', 'shop', 'sabo', 'lobby', 'duelHud', 'droneHud', 'sticks', 'banner'].forEach((id) => show(id, false));
  show('menu');
  droneBuzz(false);
}

window.onAndroidBack = () => {
  if (!$('menu').classList.contains('hidden')) return 'exit';
  const open = ['help', 'shop', 'sabo', 'pause', 'lobby'].find((id) => !$(id).classList.contains('hidden'));
  if (open) { if (open === 'lobby') quitToMenu(); else show(open, false); return 'ok'; }
  if (app.targeting) { cancelTargeting(); return 'ok'; }
  show('pause');
  return 'ok';
};

// ---------- online lobby ----------
function openLobby(isHost) {
  show('menu', false);
  show('lobby');
  show('hostBox', isHost);
  show('joinBox', !isHost);
  $('lobbyTitle').textContent = isHost ? 'Создать комнату' : 'Войти в комнату';
  if (app.net) app.net.destroy();
  const net = new Net();
  app.net = net;
  if (isHost) {
    $('roomCode').textContent = '.....';
    $('lobbyStatus').textContent = 'Подключение к серверу…';
    net.host((code) => {
      $('roomCode').textContent = code;
      $('lobbyStatus').textContent = 'Ожидание соперника… Вы играете за Синих.';
    }, (err) => { $('lobbyStatus').textContent = 'Ошибка сети: ' + err; });
    net.onOpen = () => {
      sfx('turn');
      startGame('host');
    };
  } else {
    $('joinStatus').textContent = '';
    $('joinCode').value = '';
    $('joinGo').onclick = () => {
      const c = $('joinCode').value.trim();
      if (c.length < 5) { $('joinStatus').textContent = 'Код из 5 символов'; return; }
      $('joinStatus').textContent = 'Подключение…';
      net.join(c, (err) => { $('joinStatus').textContent = 'Ошибка: ' + err; });
    };
    net.onOpen = () => {
      $('joinStatus').textContent = 'Подключено! Ожидание данных…';
      net.send({ t: 'hello' });
    };
  }
  net.onMessage = onNetMessage;
  net.onClose = () => {
    if (app.mode === 'host' || app.mode === 'guest') {
      if (app.state && !app.state.winner) {
        toast('Соединение с соперником потеряно');
        setTimeout(quitToMenu, 2500);
      }
    }
  };
}
$('lobbyBack').onclick = () => quitToMenu();

function onNetMessage(m) {
  if (app.mode === 'host') {
    if (m.t === 'cmd') applyCmd('b', m.c, true);
    else if (m.t === 'inp') app.remoteInput = m.i;
    else if (m.t === 'hello') pushState();
  } else {
    if (m.t === 'state') {
      if (app.mode !== 'guest') startGame('guest', m.s);
      else { app.state = m.s; onStateChange(); }
    } else if (m.t === 'snap') {
      if (app.rtView === 'duel') duel.apply(m.d, true);
      else if (app.rtView === 'drone') applyDroneSnap(m.d);
      if (m.d.over && !app.rtOverShown) showRtOver(m.d);
    } else if (m.t === 'err') { toast(m.e); sfx('error'); }
  }
}

function pushState() {
  if (app.mode === 'host' && app.net) app.net.send({ t: 'state', s: app.state });
}

// ---------- game start ----------
function startGame(mode, guestState) {
  app.mode = mode;
  app.mySide = mode === 'guest' ? 'b' : 'w';
  app.state = guestState || newGame({ autoDuel: settings.duel === 'auto' && mode !== 'host' });
  app.sel = -1;
  app.targeting = null;
  app.sim = null;
  app.lastLogLen = 0;
  app.lastTurnSeen = null;
  endRtView();
  ['menu', 'lobby', 'over'].forEach((id) => show(id, false));
  show('hud');
  show('ping', mode === 'host' || mode === 'guest');
  board.setViewSide(app.mySide);
  board.userZoomed = false;
  resize();
  board.skipFx(app.state);
  onStateChange();
  banner(mode === 'guest' ? 'ВЫ — КРАСНЫЕ' : mode === 'host' ? 'ВЫ — СИНИЕ' : 'К БОЮ!', mode === 'hot' ? 'Синие ходят первыми' : 'Уничтожьте вражеского генерала');
}

// ---------- commands ----------
function sendCmd(cmd) {
  if (app.mode === 'guest') app.net.send({ t: 'cmd', c: cmd });
  else applyCmd(actingSide(), cmd);
}

function applyCmd(side, cmd, remote) {
  const s = app.state;
  if (!s) return;
  const err = apply(s, side, cmd);
  if (err) {
    if (remote) app.net.send({ t: 'err', e: err });
    else if (!isAiSide(side)) { toast(err); sfx('error'); }
    return;
  }
  if (cmd.c === 'buy' && !isAiSide(side) && !remote) sfx('cash');
  onStateChange();
}

function onStateChange() {
  const s = app.state;
  if (!s) return;
  // hot-seat: rotate camera to the side to move
  if (s.turn !== app.lastTurnSeen && s.phase !== 'over') {
    const first = app.lastTurnSeen === null;
    app.lastTurnSeen = s.turn;
    if (app.mode === 'hot') board.setViewSide(s.turn);
    if (!first) {
      if (localSides().includes(s.turn) && !isAiSide(s.turn)) {
        sfx('turn');
        banner(app.mode === 'hot' ? `ХОД: ${SIDE_NAME[s.turn].toUpperCase()}` : 'ВАШ ХОД', `+${income(s, s.turn)} 💰 доход`);
      }
    }
    app.sel = -1;
    app.targeting = null;
  }
  board.sync(s, viewerSides());
  updateHud();
  updateLog();
  updateHighlights();
  if (s.phase === 'over' && s.winner) {
    pushState();
    setTimeout(() => showGameOver(), 1200);
    return;
  }
  if ((s.phase === 'duel' || s.phase === 'drone') && !app.rtView) startRealtime();
  if (s.phase === 'board' && app.rtView) endRtView();
  pushState();
  scheduleAi();
}

function scheduleAi() {
  const s = app.state;
  clearTimeout(app.aiTimer);
  if (!authority() || !s || s.phase !== 'board' || s.winner || !isAiSide(s.turn)) return;
  app.aiTimer = setTimeout(() => {
    if (!app.state || app.state !== s || s.phase !== 'board' || !isAiSide(s.turn)) return;
    const cmd = aiChoose(s, s.turn, settings.diff);
    const err = apply(s, s.turn, cmd);
    if (err) apply(s, s.turn, { c: 'end' });
    onStateChange();
  }, 650);
}

// ---------- HUD ----------
function updateHud() {
  const s = app.state;
  const side = app.mode === 'hot' ? s.turn : app.mySide;
  const tb = $('turnBadge');
  tb.textContent = `Ход ${s.turnNo}/${MAX_TURNS} · ${SIDE_NAME[s.turn]}`;
  tb.className = 'badge ' + s.turn;
  $('actBadge').textContent = `Действия: ${s.actionsLeft}`;
  $('money').firstChild.nodeValue = `💰 ${s.money[side]} `;
  $('income').textContent = `+${income(s, side)}`;
  $('factBadge').textContent = `🏭 ${s.factories[side]}${s.ew[side] ? ' · 📡' : ''}`;
  const terr = territory(s);
  const tw = terr.filter((x) => x === 'w').length, tbn = terr.filter((x) => x === 'b').length;
  const pw = Math.round((tw / Math.max(1, tw + tbn)) * 100);
  $('terrW').style.width = pw + '%';
  $('terrWl').textContent = pw + '%';
  $('terrBl').textContent = 100 - pw + '%';
  const mine = myTurn();
  $('endBtn').disabled = !mine;
  $('shopBtn').disabled = !mine;
  show('waitBar', !mine && s.phase === 'board' && !s.winner);
  $('waitBar').textContent = isAiSide(s.turn) ? 'ИИ планирует операцию…' : 'Ход противника…';
  if (app.net) $('ping').textContent = `📶 ${app.net.ping} мс`;
  updateInfo();
}

function updateLog() {
  const s = app.state;
  const box = $('log');
  if (s.log.length < app.lastLogLen) app.lastLogLen = 0;
  const fresh = s.log.slice(Math.max(app.lastLogLen, s.log.length - 4));
  app.lastLogLen = s.log.length;
  for (const m of fresh) {
    const d = document.createElement('div');
    d.textContent = m;
    box.appendChild(d);
    setTimeout(() => d.remove(), 7000);
  }
  while (box.children.length > 5) box.firstChild.remove();
}

function updateInfo() {
  const s = app.state;
  const p = app.sel >= 0 ? s.board[app.sel] : null;
  show('info', !!p && !app.targeting);
  if (!p) return;
  const u = UNITS[p.t];
  $('infoGlyph').textContent = u.glyph;
  $('infoGlyph').style.color = p.s === 'w' ? 'var(--blue)' : 'var(--red)';
  $('infoName').textContent = `${u.name} · ${SIDE_NAME[p.s]}`;
  const flags = [];
  if (p.dug) flags.push('окопан');
  if (p.stun > 0) flags.push('оглушён');
  if (p.cd > 0) flags.push(`перезарядка ${p.cd}`);
  $('infoHp').textContent = `❤ ${p.hp}/${p.maxHp}${flags.length ? ' · ' + flags.join(', ') : ''}`;
  $('infoDesc').textContent = u.desc;
  const own = myTurn() && p.s === actingSide();
  const t = own ? abilityTargets(s, app.sel) : null;
  $('abilityBtn').textContent = `${u.abilityName}${p.cd > 0 ? ` (${p.cd})` : ''}`;
  $('abilityBtn').disabled = !own || !t || !t.length || s.actionsLeft <= 0;
  show('abilityBtn', p.s === actingSide() || app.mode === 'hot');
}

function updateHighlights() {
  const s = app.state;
  const hl = [];
  if (s.lastMove) { hl.push({ sq: s.lastMove.from, kind: 'last' }); hl.push({ sq: s.lastMove.to, kind: 'last' }); }
  if (app.targeting) {
    for (const t of app.targeting.targets) hl.push({ sq: t, kind: 'target' });
    if (app.targeting.from >= 0) hl.push({ sq: app.targeting.from, kind: 'select' });
  } else if (app.sel >= 0 && s.board[app.sel]) {
    hl.push({ sq: app.sel, kind: 'select' });
    const p = s.board[app.sel];
    if (myTurn() && p.s === actingSide()) {
      for (const m of legalMovesFor(s, app.sel)) hl.push({ sq: m.to, kind: m.capture ? 'capture' : m.rail ? 'rail' : 'move' });
    }
  }
  board.setHighlights(hl);
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  show(t);
  clearTimeout(toast.tm);
  toast.tm = setTimeout(() => show(t, false), 2200);
}

function banner(text, sub = '', ms = 1700) {
  $('bannerText').textContent = text;
  $('bannerSub').textContent = sub;
  const b = $('banner');
  b.classList.add('hidden');
  void b.offsetWidth;
  show(b);
  clearTimeout(banner.tm);
  banner.tm = setTimeout(() => show(b, false), ms);
}

// ---------- board interaction ----------
function onTapSquare(i) {
  const s = app.state;
  if (!s || s.phase !== 'board' || i < 0) return;
  if (app.targeting) {
    const T = app.targeting;
    if (T.targets.includes(i)) {
      if (T.kind === 'ability') sendCmd({ c: 'ability', from: T.from, target: i });
      else sendCmd({ c: 'buy', item: T.item, target: i });
      app.targeting = null;
      app.sel = -1;
      updateHighlights();
      updateInfo();
      show('targetBar', false);
    } else cancelTargeting();
    return;
  }
  const p = s.board[i];
  if (app.sel >= 0 && myTurn()) {
    const sp = s.board[app.sel];
    if (sp && sp.s === actingSide()) {
      const m = legalMovesFor(s, app.sel).find((x) => x.to === i);
      if (m) {
        sfx('click');
        sendCmd({ c: 'move', from: app.sel, to: i });
        app.sel = -1;
        updateHighlights();
        updateInfo();
        return;
      }
    }
  }
  app.sel = p ? i : -1;
  if (p) sfx('select');
  updateHighlights();
  updateInfo();
}

function cancelTargeting() {
  app.targeting = null;
  show('targetBar', false);
  updateHighlights();
  updateInfo();
}

$('targetCancel').onclick = cancelTargeting;
$('infoClose').onclick = () => { app.sel = -1; updateHighlights(); updateInfo(); };
$('endBtn').onclick = () => { if (myTurn()) { sfx('click'); app.sel = -1; sendCmd({ c: 'end' }); } };
$('abilityBtn').onclick = () => {
  const s = app.state;
  if (!myTurn() || app.sel < 0) return;
  const t = abilityTargets(s, app.sel);
  if (!t || !t.length) return;
  sfx('click');
  if (t.length === 1 && t[0] === app.sel) { sendCmd({ c: 'ability', from: app.sel, target: app.sel }); return; }
  app.targeting = { kind: 'ability', from: app.sel, targets: t };
  $('targetText').textContent = `${UNITS[s.board[app.sel].t].abilityName}: выберите цель`;
  show('targetBar');
  updateHighlights();
  updateInfo();
};

// shop
$('shopBtn').onclick = () => { if (!myTurn()) return; sfx('click'); openShop(); };
function openShop() {
  const s = app.state;
  const side = actingSide();
  $('shopMoney').textContent = `💰 ${s.money[side]}`;
  const grid = $('shopGrid');
  grid.innerHTML = '';
  for (const [key, it] of Object.entries(SHOP)) {
    const err = canBuy(s, side, key);
    const b = document.createElement('button');
    b.className = 'shop-item' + (err ? ' off' : '');
    b.innerHTML = `<div class="si-top"><span class="si-icon">${it.icon}</span><span class="si-price">${it.price}</span></div>
      <div><b>${it.name}</b>${it.action ? ' <small>⚡действие</small>' : ''}</div><div class="si-desc">${it.desc}</div>${err ? `<div class="si-err">${err}</div>` : ''}`;
    b.onclick = () => {
      const e2 = canBuy(app.state, side, key);
      if (e2) { toast(e2); sfx('error'); return; }
      sfx('click');
      show('shop', false);
      if (key === 'sabotage') { show('sabo'); return; }
      if (it.target) {
        app.targeting = { kind: 'shop', item: key, from: -1, targets: shopTargets(app.state, side, key) };
        $('targetText').textContent = `${it.name}: выберите клетку`;
        show('targetBar');
        app.sel = -1;
        updateHighlights();
        updateInfo();
      } else sendCmd({ c: 'buy', item: key });
    };
    grid.appendChild(b);
  }
  show('shop');
}
document.querySelectorAll('[data-sabo]').forEach((b) => b.addEventListener('click', () => {
  show('sabo', false);
  sendCmd({ c: 'buy', item: 'sabotage', sub: b.dataset.sabo });
}));

// board gestures
const touches = new Map();
let gesture = null;
canvas.addEventListener('pointerdown', (e) => {
  initAudio();
  if (app.rtView || !app.state) return;
  canvas.setPointerCapture(e.pointerId);
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), btn: e.button });
  if (touches.size === 2) {
    const [a, b] = [...touches.values()];
    gesture = { dist: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), multi: true };
  } else gesture = { moved: false };
});
canvas.addEventListener('pointermove', (e) => {
  const t = touches.get(e.pointerId);
  if (!t || app.rtView) return;
  const dx = e.clientX - t.x, dy = e.clientY - t.y;
  t.x = e.clientX; t.y = e.clientY;
  if (touches.size >= 2 && gesture && gesture.multi) {
    const [a, b] = [...touches.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (gesture.dist > 0) board.zoom(gesture.dist / d);
    board.rotate(-(ang - gesture.ang));
    gesture.dist = d; gesture.ang = ang;
    return;
  }
  if (Math.hypot(e.clientX - t.sx, e.clientY - t.sy) > 10) gesture.moved = true;
  if (gesture.moved) {
    if (t.btn === 2) board.rotate(dx * 0.01);
    else board.pan(dx, dy);
  }
});
const endPointer = (e) => {
  const t = touches.get(e.pointerId);
  touches.delete(e.pointerId);
  if (!t || app.rtView) return;
  if (gesture && !gesture.moved && !gesture.multi && touches.size === 0) {
    const nx = (e.clientX / innerWidth) * 2 - 1, ny = -(e.clientY / innerHeight) * 2 + 1;
    onTapSquare(board.pick(nx, ny));
  }
  if (touches.size === 0) gesture = null;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => { if (!app.rtView) board.zoom(e.deltaY > 0 ? 1.1 : 0.9); }, { passive: true });

// ---------- real-time phases ----------
function ctrlFor(side, role) {
  if (app.mode === 'ai') return side === 'w' ? 'local' : 'ai';
  if (app.mode === 'hot') return role === 'att' ? 'local' : 'ai';
  if (app.mode === 'host') return side === 'w' ? 'local' : 'remote';
  return 'remote';
}

function startRealtime() {
  const s = app.state;
  const rt = s.rt;
  app.rtOverShown = false;
  app.remoteInput = null;
  app.pendingEv = []; app.pendingOd = [];
  app.intro = 1.6;
  clearTimeout(app.aiTimer);
  app.sel = -1; app.targeting = null;
  show('targetBar', false); show('info', false); show('shop', false); show('sabo', false);
  if (rt.kind === 'duel') {
    let localTeam = null;
    if (app.mode === 'guest') localTeam = rt.att.s === 'b' ? 'att' : rt.def.s === 'b' ? 'def' : null;
    else {
      if (ctrlFor(rt.att.s, 'att') === 'local') localTeam = 'att';
      else if (ctrlFor(rt.def.s, 'def') === 'local') localTeam = 'def';
    }
    app.localTeam = localTeam;
    if (authority()) {
      app.sim = new DuelSim(rt, { ctrl: { att: ctrlFor(rt.att.s, 'att'), def: ctrlFor(rt.def.s, 'def') }, difficulty: settings.diff });
      app.simKind = 'duel';
    }
    duel.start(rt, localTeam, (n, v) => sfx(n, v));
    duel.resize(innerWidth, innerHeight);
    if (app.sim) duel.apply(app.sim.snapshot(), false);
    app.rtView = 'duel';
    show('hud', false);
    show('duelHud');
    show('sticks', !!localTeam);
    show('stickR', true);
    show('spectate', !localTeam);
    const ab = KINDS[localTeam ? rt[localTeam].t : 'P'].ab;
    $('abName').textContent = ab ? ab.name : '—';
    $('dNameA').textContent = `${UNITS[rt.att.t].name} (${SIDE_NAME[rt.att.s]})${rt.att.allies ? ' +' + rt.att.allies : ''}`;
    $('dNameD').textContent = `${rt.def.allies ? rt.def.allies + '+ ' : ''}${UNITS[rt.def.t].name} (${SIDE_NAME[rt.def.s]})${rt.def.dug ? ' 🛡' : ''}`;
    const youAtt = localTeam === 'att', youDef = localTeam === 'def';
    banner('БОЙ!', youAtt ? 'Вы атакуете — уничтожьте защитника' : youDef ? 'Вас атакуют — удержите позицию!' : `${UNITS[rt.att.t].name} против ${UNITS[rt.def.t].name}`, 1600);
    sfx('alarm');
  } else {
    const local = app.mode === 'guest' ? rt.side === 'b' : ctrlFor(rt.side, 'att') === 'local' && !isAiSide(rt.side);
    app.localTeam = local ? 'drone' : null;
    if (authority()) {
      const ctrl = isAiSide(rt.side) ? 'ai' : app.mode === 'host' && rt.side === 'b' ? 'remote' : 'local';
      app.sim = new DroneSim(s, { ctrl });
      app.simKind = 'drone';
    }
    board.droneSide = rt.side;
    app.rtView = 'drone';
    show('hud', false);
    show('droneHud');
    show('sticks', local);
    show('stickR', false);
    show('spectate', false);
    $('abName').textContent = '⚡ БУСТ';
    $('fpvSide').textContent = `FPV · ${SIDE_NAME[rt.side]}`;
    $('fpvHelp').textContent = local ? 'Стик: поворот и высота · ⚡ ускорение · Врежьтесь во врага!' : 'Вражеский дрон в воздухе!';
    banner(local ? 'FPV-ДРОН' : 'ВОЗДУШНАЯ УГРОЗА', local ? 'Найдите и поразите цель' : 'Противник запустил дрон', 1400);
    if (app.sim) applyDroneSnap(app.sim.snapshot());
    droneBuzz(true);
  }
}

function applyDroneSnap(d) {
  board.droneSnap = d;
  $('fpvBat').textContent = Math.max(0, Math.round((d.bat / DRONE_BATTERY) * 100));
  $('fpvAlt').textContent = d.y.toFixed(1);
  $('fpvSig').textContent = d.jam ? 'РЭБ! ПОМЕХИ ▮▯▯▯' : 'СИГНАЛ ▮▮▮▮';
  $('fpvNoise').classList.toggle('on', !!d.jam || d.bat < 3);
  droneBuzz(!d.over, d.boost ? 1.6 : 1 + d.y * 0.02);
  for (const e of d.ev || []) {
    if (e.k === 'boom') { board.fx.explosion(e.x, Math.max(0.3, e.y), e.z, 2); sfx('boom'); }
  }
  if (d.over && !app.rtOverShown) showRtOver(d);
}

function showRtOver(snap) {
  app.rtOverShown = true;
  const rt = app.state && app.state.rt;
  if (!rt) return;
  if (rt.kind === 'duel') {
    const w = snap.over.winner;
    const lt = app.localTeam;
    if (w === 'timeout') banner('ВРЕМЯ ВЫШЛО', 'Атака захлебнулась');
    else if (lt) {
      const won = w === lt;
      banner(won ? 'ПОБЕДА В БОЮ' : 'ПОРАЖЕНИЕ', won ? 'Позиция за вами' : 'Юнит потерян');
      sfx(won ? 'win' : 'lose');
    } else banner(w === 'att' ? 'АТАКА УСПЕШНА' : 'АТАКА ОТБИТА');
  } else {
    banner(snap.over.hits.length ? 'ЦЕЛЬ ПОРАЖЕНА' : 'ДРОН ПОТЕРЯН', snap.msg || '');
    droneBuzz(false);
  }
}

function endRtView() {
  if (app.rtView === 'duel') duel.dispose();
  board.droneSnap = null;
  app.rtView = null;
  app.sim = null;
  show('duelHud', false);
  show('droneHud', false);
  show('sticks', false);
  droneBuzz(false);
  if (app.state) show('hud');
}

function localInput() {
  if (app.rtView === 'duel') {
    const lu = duel.localUnit();
    return controls.duelInput(lu ? { x: lu.x, z: lu.z } : null, (x, y) => duel.groundPoint(x, y));
  }
  return controls.droneInput();
}

function tickRealtime(dt) {
  const s = app.state;
  if (!app.rtView) return;
  if (authority() && app.sim) {
    const sim = app.sim;
    const inp = app.localTeam ? localInput() : null;
    if (app.intro > 0) app.intro -= dt;
    else {
      const steps = Math.min(4, Math.max(1, Math.round(dt / (1 / 60))));
      const h = Math.min(dt, 1 / 15) / steps;
      for (let i = 0; i < steps; i++) {
        if (app.simKind === 'duel') {
          const inputs = {};
          if (app.localTeam) inputs[app.localTeam] = inp;
          const remoteTeam = app.mode === 'host' ? (s.rt.att.s === 'b' ? 'att' : 'def') : null;
          if (remoteTeam) inputs[remoteTeam] = app.remoteInput;
          sim.step(h, inputs);
          if (i === 0 && inp) inp.ab = false;
        } else {
          sim.step(h, sim.ctrl === 'remote' ? app.remoteInput : inp);
          if (inp) inp.ab = false;
        }
      }
    }
    const snap = sim.snapshot();
    if (app.simKind === 'duel') duel.apply(snap, false);
    else applyDroneSnap(snap);
    if (app.mode === 'host') {
      app.pendingEv.push(...(snap.ev || []));
      if (snap.od) app.pendingOd.push(...snap.od);
      app.sendAcc += dt;
      if (app.sendAcc > 0.05 || snap.over) {
        app.sendAcc = 0;
        snap.ev = app.pendingEv; snap.od = app.pendingOd;
        app.net.send({ t: 'snap', d: snap });
        app.pendingEv = []; app.pendingOd = [];
      }
    }
    if (snap.over && !app.rtOverShown) showRtOver(snap);
    if (sim.done) {
      const res = sim.result;
      app.sim = null;
      if (app.simKind === 'duel') finishDuel(s, res);
      else finishDrone(s, res);
      endRtView();
      onStateChange();
    }
  } else if (app.mode === 'guest' && app.localTeam) {
    app.sendAcc += dt;
    if (app.sendAcc > 0.033) {
      app.sendAcc = 0;
      const inp = localInput();
      // keep ability press until delivered
      app.net.send({ t: 'inp', i: inp });
    }
  }
  // duel HUD
  if (app.rtView === 'duel' && duel.snap) {
    const sn = duel.snap;
    $('dTimer').textContent = Math.ceil(sn.t);
    for (const u of sn.u) {
      if (!u[12]) continue;
      const el = u[2] === 'att' ? $('dHpA') : $('dHpD');
      el.style.width = Math.max(0, (u[6] / u[7]) * 100) + '%';
      el.style.background = u[6] / u[7] > 0.5 ? '#5ce65c' : u[6] / u[7] > 0.25 ? '#f2c94c' : '#ff4d4d';
      if (u[2] === app.localTeam) {
        const ab = KINDS[u[1]].ab;
        const frac = ab ? Math.min(1, u[11] / ab.cd) : 1;
        $('abCd').style.height = frac * 100 + '%';
      }
    }
  }
}

function showGameOver() {
  const s = app.state;
  if (!s || !s.winner) return;
  endRtView();
  const youWin = app.mode === 'hot' ? null : s.winner === app.mySide;
  $('overTitle').textContent = youWin === null ? `ПОБЕДА: ${SIDE_NAME[s.winner].toUpperCase()}` : youWin ? 'ПОБЕДА!' : 'ПОРАЖЕНИЕ';
  sfx(youWin === false ? 'lose' : 'win');
  const st = s.stats;
  $('overStats').innerHTML = `${s.byScore ? `Перемирие на ${MAX_TURNS}-м ходу. Очки: Синие ${s.byScore.w} — Красные ${s.byScore.b}<br>` : 'Вражеский генерал уничтожен!<br>'}Ходов: ${s.turnNo}<br>
    <span style="color:var(--blue)">Синие</span>: уничтожено ${st.w.kills}, боёв выиграно ${st.w.duelsWon}, дронов ${st.w.drones}, заводов ${s.factories.w}<br>
    <span style="color:var(--red)">Красные</span>: уничтожено ${st.b.kills}, боёв выиграно ${st.b.duelsWon}, дронов ${st.b.drones}, заводов ${s.factories.b}`;
  show('hud', false);
  show('over');
}

// ---------- main loop ----------
let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (app.state) tickRealtime(dt);
  if (app.rtView === 'duel' && duel.scene) {
    duel.update(dt);
    renderer.render(duel.scene, duel.camera);
  } else {
    if (!app.state) {
      // menu backdrop: slow orbit
      board.camAz += dt * 0.05;
    }
    board.update(dt);
    renderer.render(board.scene, board.camera);
  }
}
// menu backdrop state
board.sync(newGame(), ['w']);
resize();
requestAnimationFrame(frame);

// debug hooks for automated tests
window.__fg = { app, board, duel, sendCmd, onTapSquare, startGame, controls, settings };
void other;
