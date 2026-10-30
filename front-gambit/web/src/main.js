// Front Gambit — app controller: menus, modes (AI / hot-seat / online), board + real-time phases.
import * as THREE from 'three';
import {
  newGame, apply, finishDuel, finishDrone, legalMovesFor, abilityList, shopTargets, canBuy, price, autoResolve,
  territory, income, SHOP, SIDE_NAME, MAX_TURNS, KEYPOINTS, b2Available, b2Targets, unitDef, RANKS, ARMY_CAP, armySize, supplyMap,
} from './rules.js';
import { ABILITIES } from './abilities.js';
import { CARDS, cardTargets } from './cards.js';
import { EVENTS } from './events.js';
import { aiChoose } from './ai.js';
import { BoardView } from './boardView.js';
import { DuelView } from './duelView.js';
import { DuelSim, SPECIALS } from './duel.js';
import { DroneSim, DRONE_BATTERY } from './drone.js';
import { Controls } from './input.js';
import { initAudio, sfx, setVolumes, setMuted, isMuted, droneBuzz, playMusic } from './audio.js';
import { Net } from './net.js';
import { A, ico, preload } from './assets.js';
import { Workshop, loadLibrary } from './editor.js';

const $ = (id) => document.getElementById(id);
const show = (el, on = true) => (typeof el === 'string' ? $(el) : el).classList.toggle('hidden', !on);

// ---------- settings ----------
const settings = { diff: 1, duel: 'manual', gfx: 'high', music: 60, sfx: 80, cine: true, assist: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem('fg-settings2') || '{}')); } catch (e) { /* ignore */ }
function saveSettings() { try { localStorage.setItem('fg-settings2', JSON.stringify(settings)); } catch (e) { /* ignore */ } }
const bindSet = (id, key, conv = (v) => v, prop = 'value') => {
  const el = $(id);
  el[prop] = settings[key];
  el.onchange = el.oninput = () => { settings[key] = conv(el[prop]); saveSettings(); applySettings(); };
};
bindSet('setDiff', 'diff', Number);
bindSet('setDuel', 'duel');
bindSet('setGfx', 'gfx');
bindSet('setMusic', 'music', Number);
bindSet('setSfx', 'sfx', Number);
bindSet('setCine', 'cine', Boolean, 'checked');
bindSet('setAssist', 'assist', Boolean, 'checked');

// ---------- renderer ----------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const board = new BoardView(renderer);
const duel = new DuelView(renderer);
const workshop = new Workshop(renderer, { onClose: () => { show('menu'); playMusic('menu'); }, sfx });
board.onSound = (n) => sfx(n);
board.onCine = (on) => $('letterbox').classList.toggle('on', on);
const controls = new Controls();
controls.bindSticks($('stickL'), $('stickR'), $('abBtn'), $('reloadBtn'));
controls.bindMouse(canvas, () => app.rtView === 'duel');

function applySettings() {
  renderer.shadowMap.enabled = settings.gfx === 'high';
  renderer.setPixelRatio(settings.gfx === 'high' ? Math.min(window.devicePixelRatio, 2) : Math.min(window.devicePixelRatio, 1.25));
  setVolumes(settings.music / 100, settings.sfx / 100);
  board.cineEnabled = settings.cine;
  controls.aimAssist = settings.assist;
  resize();
}
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  board.resize(w, h);
  duel.resize(w, h);
  workshop.resize(w, h);
}
window.addEventListener('resize', resize);

// ---------- app state ----------
const app = {
  mode: null, state: null, net: null, mySide: 'w',
  sim: null, simKind: null, rtView: null, intro: 0, sel: -1, targeting: null,
  aiTimer: null, remoteInput: null, sendAcc: 0, pendingEv: [], pendingOd: [],
  lastTurnSeen: null, lastLogLen: 0, popupSeen: 0, setup: { map: 'field', events: true, cards: true, custom: true }, pendingMode: null,
};
applySettings();

const authority = () => app.mode !== 'guest';
const localSides = () => (app.mode === 'ai' ? ['w'] : app.mode === 'hot' ? ['w', 'b'] : app.mode === 'host' ? ['w'] : ['b']);
const isAiSide = (side) => side === 'n' || (app.mode === 'ai' && side === 'b');
function myTurn() {
  const s = app.state;
  return s && s.phase === 'board' && !s.winner && localSides().includes(s.turn) && !isAiSide(s.turn);
}
function actingSide() { return app.mode === 'hot' ? (app.state.turn === 'n' ? 'w' : app.state.turn) : app.mySide; }
function viewerSides() { return app.mode === 'hot' ? [actingSide()] : localSides(); }

// ---------- menu ----------
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { sfx('click'); b.closest('.screen').classList.add('hidden'); }));
document.querySelectorAll('#menu [data-act]').forEach((b) => b.addEventListener('click', () => {
  initAudio();
  playMusic('menu');
  sfx('click');
  const a = b.dataset.act;
  if (a === 'ai' || a === 'hot' || a === 'host') { app.pendingMode = a; show('setup'); }
  else if (a === 'join') openLobby(false);
  else if (a === 'workshop') { show('menu', false); workshop.open(); }
  else if (a === 'help') { renderHelp(); show('help'); }
}));
document.querySelectorAll('.map-card').forEach((b) => b.addEventListener('click', () => {
  sfx('select');
  document.querySelectorAll('.map-card').forEach((x) => x.classList.toggle('on', x === b));
  app.setup.map = b.dataset.map;
}));
$('setupBack').onclick = () => { sfx('click'); show('setup', false); };
$('setupGo').onclick = () => {
  sfx('click');
  app.setup.events = $('optEvents').checked;
  app.setup.cards = $('optCards').checked;
  app.setup.custom = $('optCustom').checked;
  show('setup', false);
  if (app.pendingMode === 'host') openLobby(true);
  else startGame(app.pendingMode);
};
$('menuBtn').onclick = () => { sfx('click'); show('pause'); };
$('helpBtn2').onclick = () => { renderHelp(); show('help'); };
$('toggleSnd').onclick = () => { setMuted(!isMuted()); $('sndIcon').src = A.icon(isMuted() ? 'sound_off' : 'sound_on'); toast(isMuted() ? 'Звук выключен' : 'Звук включён'); };
$('quitBtn').onclick = () => quitToMenu();
$('overMenu').onclick = () => quitToMenu();
document.addEventListener('pointerdown', () => initAudio(), { once: true });

function quitToMenu() {
  clearTimeout(app.aiTimer);
  if (app.net) { app.net.destroy(); app.net = null; }
  app.mode = null; app.state = null; app.sim = null;
  endRtView();
  ['hud', 'pause', 'over', 'shop', 'sabo', 'lobby', 'duelHud', 'droneHud', 'sticks', 'banner', 'cards', 'journal', 'eventPop', 'setup', 'vs'].forEach((id) => show(id, false));
  show('menu');
  playMusic('menu');
  droneBuzz(false);
  board.sync(newGame(), ['w']);
}

window.onAndroidBack = () => {
  if (workshop.active) { workshop.close(); return 'ok'; }
  if (!$('menu').classList.contains('hidden')) return 'exit';
  const open = ['help', 'shop', 'sabo', 'pause', 'lobby', 'cards', 'journal', 'setup', 'eventPop'].find((id) => !$(id).classList.contains('hidden'));
  if (open) { if (open === 'lobby') quitToMenu(); else show(open, false); return 'ok'; }
  if (app.targeting) { cancelTargeting(); return 'ok'; }
  show('pause');
  return 'ok';
};

function customDefsForGame() {
  if (!app.setup.custom) return {};
  return loadLibrary();
}

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
    net.host((code) => { $('roomCode').textContent = code; $('lobbyStatus').textContent = 'Ожидание соперника… Вы играете за Синих.'; },
      (err) => { $('lobbyStatus').textContent = 'Ошибка сети: ' + err; });
    net.onOpen = () => { sfx('turn'); startGame('host'); };
  } else {
    $('joinStatus').textContent = '';
    $('joinCode').value = '';
    $('joinGo').onclick = () => {
      const c = $('joinCode').value.trim();
      if (c.length < 5) { $('joinStatus').textContent = 'Код из 5 символов'; return; }
      $('joinStatus').textContent = 'Подключение…';
      net.join(c, (err) => { $('joinStatus').textContent = 'Ошибка: ' + err; });
    };
    net.onOpen = () => { $('joinStatus').textContent = 'Подключено! Ожидание данных…'; net.send({ t: 'hello', defs: loadLibrary() }); };
  }
  net.onMessage = onNetMessage;
  net.onClose = () => {
    if ((app.mode === 'host' || app.mode === 'guest') && app.state && !app.state.winner) {
      toast('Соединение с соперником потеряно');
      setTimeout(quitToMenu, 2500);
    }
  };
}
$('lobbyBack').onclick = () => quitToMenu();

function onNetMessage(m) {
  if (app.mode === 'host') {
    if (m.t === 'cmd') applyCmd('b', m.c, true);
    else if (m.t === 'inp') app.remoteInput = m.i;
    else if (m.t === 'hello') {
      if (app.setup.custom && m.defs) Object.assign(app.state.customDefs, m.defs);
      pushState();
    }
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

function pushState() { if (app.mode === 'host' && app.net) app.net.send({ t: 'state', s: app.state }); }

// ---------- game start ----------
function startGame(mode, guestState) {
  app.mode = mode;
  app.mySide = mode === 'guest' ? 'b' : 'w';
  app.state = guestState || newGame({
    autoDuel: settings.duel === 'auto' && mode !== 'host', map: app.setup.map, events: app.setup.events, cards: app.setup.cards,
    customDefs: customDefsForGame(),
  });
  app.sel = -1; app.targeting = null; app.sim = null; app.lastLogLen = 0; app.lastTurnSeen = null;
  app.popupSeen = app.state.popup ? app.state.popup.seq : 0;
  endRtView();
  ['menu', 'lobby', 'over', 'setup'].forEach((id) => show(id, false));
  show('hud');
  show('ping', mode === 'host' || mode === 'guest');
  board.setViewSide(app.mySide);
  board.userZoomed = false;
  resize();
  board.skipFx(app.state);
  playMusic('board');
  onStateChange();
  banner(mode === 'guest' ? 'ВЫ — КРАСНЫЕ' : mode === 'host' ? 'ВЫ — СИНИЕ' : 'К БОЮ!', app.state.map === 'city' ? 'Бои в городе' : 'Уничтожьте вражеского генерала');
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
  if (s.turn !== app.lastTurnSeen && s.phase !== 'over') {
    const first = app.lastTurnSeen === null;
    app.lastTurnSeen = s.turn;
    if (app.mode === 'hot' && s.turn !== 'n') board.setViewSide(s.turn);
    if (!first && localSides().includes(s.turn) && !isAiSide(s.turn)) {
      sfx('turn');
      banner(app.mode === 'hot' ? `ХОД: ${SIDE_NAME[s.turn].toUpperCase()}` : 'ВАШ ХОД', `+${income(s, s.turn)} дохода`);
    }
    if (s.turn === 'n') banner('ХОД МЯТЕЖНИКОВ', 'Враг для всех');
    app.sel = -1;
    app.targeting = null;
    show('targetBar', false);
  }
  board.sync(s, viewerSides());
  updateHud();
  updateLog();
  updateHighlights();
  // event popups
  if (s.popup && s.popup.seq > app.popupSeen) {
    app.popupSeen = s.popup.seq;
    showEventPopup(s.popup);
  }
  // card offer for the local player
  if (myTurn() && s.offer[actingSide()] && $('cards').classList.contains('hidden') && s.phase === 'board') setTimeout(() => openCards(true), 500);
  if (s.phase === 'over' && s.winner) {
    pushState();
    setTimeout(() => showGameOver(), 1500);
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
    if (board.shots.length || !$('eventPop').classList.contains('hidden')) { scheduleAi(); return; }
    const cmd = aiChoose(s, s.turn, settings.diff);
    const err = apply(s, s.turn, cmd);
    if (err) apply(s, s.turn, { c: 'end' });
    onStateChange();
  }, 600);
}

// ---------- HUD ----------
const EFFECTS = {
  mud: ['boot', 'Распутица'], blizzard: ['st_smoke', 'Метель'], depression: ['coin', 'Депрессия'], ceasefire: ['check', 'Перемирие'],
  blackout: ['warning', 'Блэкаут'], metroflood: ['kp_metro', 'Метро затоплено'], supplycut: ['st_nosupply', 'Перебои'],
};
function hpBlocks(el, hp, max, n = 12) {
  const f = Math.max(0, hp / max);
  const on = Math.ceil(f * n);
  el.className = 'hpblocks' + (f <= 0.3 ? ' low' : f <= 0.6 ? ' mid' : '');
  el.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('');
}

function updateHud() {
  const s = app.state;
  const side = actingSide();
  $('turnBadge').className = 'plate ' + s.turn;
  $('turnFlag').src = A.icon(s.turn === 'b' ? 'flag_b' : s.turn === 'w' ? 'flag_w' : 'skull');
  $('turnText').textContent = `Ход ${s.turnNo}/${MAX_TURNS}`;
  $('actBadge').innerHTML = `<span class="pips">${Array.from({ length: Math.min(5, s.actionsLeft) }, () => ico(A.icon('action'))).join('')}</span>`;
  $('money').textContent = s.money[side];
  $('income').textContent = `+${income(s, side)}`;
  $('factCount').textContent = s.factories[side].length;
  $('armyCount').textContent = `${armySize(s, side)}/${ARMY_CAP}`;
  const terr = territory(s);
  const tw = terr.filter((x) => x === 'w').length, tb = terr.filter((x) => x === 'b').length;
  const pw = Math.round((tw / Math.max(1, tw + tb)) * 100);
  $('terrW').style.width = pw + '%';
  $('terrWl').textContent = pw + '%';
  $('terrBl').textContent = 100 - pw + '%';
  const eff = [];
  for (const [k, [icon, name]] of Object.entries(EFFECTS)) if (s.effects[k] > 0) eff.push(`<div class="fx">${ico(A.icon(icon))}${name} ${s.effects[k]}</div>`);
  if (s.lend[side] > 0) eff.push(`<div class="fx">${ico(A.icon('income'))}Ленд-лиз ${s.lend[side]}</div>`);
  if (s.decoy[side] > 0) eff.push(`<div class="fx">${ico(A.icon('st_stealth'))}Ложные цели</div>`);
  $('effects').innerHTML = eff.join('');
  const mine = myTurn();
  $('endBtn').disabled = !mine;
  $('shopBtn').disabled = !mine;
  $('cardsBtn').disabled = !mine;
  const nCards = s.hands[side].length + (s.offer[side] ? 1 : 0);
  $('cardsCount').textContent = nCards;
  show('cardsCount', nCards > 0);
  show('b2Btn', mine && b2Available(s, side));
  show('waitBar', !mine && s.phase === 'board' && !s.winner);
  $('waitBar').textContent = s.turn === 'n' ? 'Мятежники действуют…' : isAiSide(s.turn) ? 'ИИ планирует операцию…' : 'Ход противника…';
  if (app.net) $('pingVal').textContent = `${app.net.ping} мс`;
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

function portrait(p) { return p.t === 'C' ? A.por('C') : p.s === 'n' && p.t !== 'D' ? A.por('X') : A.por(p.t); }

function updateInfo() {
  const s = app.state;
  const p = app.sel >= 0 ? s.board[app.sel] : null;
  show('info', !!p && !app.targeting);
  if (!p) return;
  const d = unitDef(s, p);
  $('infoPor').src = portrait(p);
  $('infoName').textContent = `${d.name} · ${SIDE_NAME[p.s]}`;
  $('infoRank').textContent = RANKS[p.rank] + (p.rank < 3 ? ` (${p.xp} оп.)` : '');
  $('infoHp').textContent = `${p.hp}/${p.maxHp}`;
  hpBlocks($('infoHpBar'), p.hp, p.maxHp);
  const sup = p.s === 'n' || supplyMap(s, territory(s))[p.s][app.sel];
  const tags = [];
  if (!sup) tags.push('st_nosupply');
  if (p.stun > 0) tags.push('st_stun');
  if (p.dug) tags.push('st_dug');
  for (const [k, ic] of [['shield', 'st_shield'], ['marked', 'st_marked'], ['stealth', 'st_stealth'], ['buff', 'st_buff'], ['overwatch', 'st_overwatch']]) if (p.st[k] > 0) tags.push(ic);
  const f = s.sqfx[app.sel];
  if (f && f.fire) tags.push('st_burn');
  if (f && f.gas) tags.push('st_gas');
  if (f && f.smoke) tags.push('st_smoke');
  $('infoTags').innerHTML = tags.map((t) => ico(A.icon(t))).join('');
  const own = myTurn() && p.s === actingSide();
  const row = $('abRow');
  row.innerHTML = '';
  for (const ab of abilityList(s, app.sel)) {
    const A2 = ABILITIES[ab.id];
    const b = document.createElement('button');
    b.className = 'ab-slot';
    b.innerHTML = `${ico(A.ab(ab.id))}${ab.cd > 0 ? `<span class="cdn">${ab.cd}</span>` : ''}`;
    b.disabled = !own || !ab.targets.length || s.actionsLeft <= 0;
    b.onclick = () => {
      $('infoDesc').textContent = `${A2.name}: ${A2.desc}`;
      if (b.disabled) { sfx('error'); return; }
      sfx('click');
      app.targeting = { kind: 'ability', from: app.sel, id: ab.id, targets: ab.targets };
      $('targetText').textContent = `${A2.name}: выберите цель`;
      show('targetBar');
      updateHighlights();
      updateInfo();
    };
    b.onpointerenter = () => { $('infoDesc').textContent = `${A2.name}: ${A2.desc}`; };
    row.appendChild(b);
  }
  for (const id of d.passives) {
    const b = document.createElement('button');
    b.className = 'ab-slot passive';
    b.innerHTML = ico(A.ab(id));
    b.onclick = () => { $('infoDesc').textContent = `Пассивно — ${ABILITIES[id].name}: ${ABILITIES[id].desc}`; };
    row.appendChild(b);
  }
  if (d.duel) {
    const b = document.createElement('button');
    b.className = 'ab-slot passive duel';
    b.innerHTML = ico(A.ab(d.duel));
    b.onclick = () => { $('infoDesc').textContent = `В бою — ${ABILITIES[d.duel].name}: ${ABILITIES[d.duel].desc}`; };
    row.appendChild(b);
  }
  const kp = s.keypoints.find((k) => k.sq === app.sel);
  $('infoDesc').textContent = d.desc + (kp ? ` Объект: ${KEYPOINTS[kp.type].name} — ${KEYPOINTS[kp.type].desc}` : '');
}

function updateHighlights() {
  const s = app.state;
  const hl = [];
  if (s.lastMove) { hl.push({ sq: s.lastMove.from, kind: 'last' }); hl.push({ sq: s.lastMove.to, kind: 'last' }); }
  if (app.targeting) {
    for (const t of app.targeting.targets) hl.push({ sq: t, kind: 'target' });
    if (app.targeting.from >= 0) hl.push({ sq: app.targeting.from, kind: app.targeting.targets.includes(app.targeting.from) ? 'target' : 'select' });
  } else if (app.sel >= 0 && s.board[app.sel]) {
    hl.push({ sq: app.sel, kind: 'select' });
    const p = s.board[app.sel];
    if (myTurn() && p.s === actingSide()) {
      for (const m of legalMovesFor(s, app.sel)) hl.push({ sq: m.to, kind: m.capture ? 'capture' : m.rail ? 'rail' : m.metro ? 'metro' : 'move' });
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

function showEventPopup(pop) {
  const e = EVENTS[pop.id];
  const title = e ? e.title : 'Режим пал';
  const text = e ? e.text : 'Диктатор повержен, мятежники разбегаются.' + (pop.side ? ` ${SIDE_NAME[pop.side]} получают 150.` : '');
  $('evTitle').textContent = title;
  $('evText').textContent = text;
  $('evArt').src = A.ev(pop.id);
  show('eventPop');
  sfx(e && e.kind === 'history' ? 'alarm' : 'event');
}
$('evOk').onclick = () => { sfx('click'); show('eventPop', false); scheduleAi(); };

// ---------- board interaction ----------
function onTapSquare(i) {
  const s = app.state;
  if (!s || s.phase !== 'board' || i < 0) return;
  if (app.targeting) {
    const T = app.targeting;
    if (T.targets.includes(i)) {
      if (T.kind === 'ability') sendCmd({ c: 'ability', from: T.from, id: T.id, target: i });
      else if (T.kind === 'card') sendCmd({ c: 'card', card: T.card, target: i });
      else if (T.kind === 'b2') sendCmd({ c: 'b2', target: i });
      else sendCmd({ c: 'buy', item: T.item, target: i });
      app.targeting = null;
      app.sel = -1;
      show('targetBar', false);
      updateHighlights();
      updateInfo();
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
$('b2Btn').onclick = () => {
  if (!myTurn()) return;
  sfx('alarm');
  app.targeting = { kind: 'b2', from: -1, targets: b2Targets() };
  $('targetText').textContent = 'B-2: выберите ряд для ковровой бомбардировки';
  show('targetBar');
  app.sel = -1;
  updateHighlights();
  updateInfo();
};
$('logBtn').onclick = () => {
  sfx('click');
  $('journalList').innerHTML = app.state.log.map((l) => `<div>${l}</div>`).join('');
  show('journal');
};

// shop
const SHOP_TABS = [['army', 'unit_P', 'Войска'], ['tech', 'unit_R', 'Техника'], ['strike', 'shop_airstrike', 'Удары'], ['rear', 'factory', 'Тыл'], ['custom', 'wrench', 'Особые']];
let shopTab = 'army';
$('shopBtn').onclick = () => { if (!myTurn()) return; sfx('click'); openShop(); };
function openShop() {
  const s = app.state;
  const side = actingSide();
  $('shopMoney').textContent = s.money[side];
  $('shopTabs').innerHTML = '';
  for (const [id, icon, name] of SHOP_TABS) {
    const b = document.createElement('button');
    b.className = 'sq big' + (id === shopTab ? ' on' : '');
    b.innerHTML = `${ico(A.icon(icon))}<span>${name}</span>`;
    b.onclick = () => { sfx('click'); shopTab = id; openShop(); };
    $('shopTabs').appendChild(b);
  }
  const grid = $('shopGrid');
  grid.innerHTML = '';
  const items = shopTab === 'custom'
    ? Object.entries(s.customDefs || {}).map(([cid, d]) => ['custom:' + cid, { name: d.name, icon: 'unit_C', desc: `${d.hp} HP, очки ${d.points}. ${d.actives.map((a) => ABILITIES[a] ? ABILITIES[a].name : a).join(', ')}`, custom: d }])
    : Object.entries(SHOP).filter(([, it]) => it.cat === shopTab);
  if (!items.length) grid.innerHTML = '<p class="muted">Создайте своих юнитов в Мастерской в главном меню.</p>';
  for (const [key, it] of items) {
    const err = canBuy(s, side, key);
    const b = document.createElement('button');
    b.className = 'shop-item' + (err ? ' off' : '');
    const art = it.custom && it.custom.thumb ? `<img src="${it.custom.thumb}" alt="">` : ico(A.icon(it.icon));
    b.innerHTML = `<div class="si-title">${it.name}</div><div class="si-art">${art}</div>
      <div class="si-price">${ico(A.icon('coin'))}${price(s, side, key)}${it.action ? ` ${ico(A.icon('action'))}` : ''}</div>
      <div class="si-desc">${it.desc}</div>${err ? `<div class="si-err">${err}</div>` : ''}`;
    b.onclick = () => {
      const e2 = canBuy(app.state, side, key);
      if (e2) { toast(e2); sfx('error'); return; }
      sfx('click');
      show('shop', false);
      if (key === 'sabotage') { show('sabo'); return; }
      const targets = shopTargets(app.state, side, key);
      if (targets) {
        app.targeting = { kind: 'shop', item: key, from: -1, targets };
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
document.querySelectorAll('[data-sabo]').forEach((b) => b.addEventListener('click', () => { show('sabo', false); sendCmd({ c: 'buy', item: 'sabotage', sub: b.dataset.sabo }); }));

// cards
$('cardsBtn').onclick = () => { if (!myTurn()) return; sfx('card'); openCards(); };
function openCards(fromOffer) {
  const s = app.state;
  const side = actingSide();
  const grid = $('cardsGrid');
  grid.innerHTML = '';
  const offer = s.offer[side];
  if (offer) {
    $('cardsTitle').textContent = 'Новый приказ — выберите один';
    for (const id of offer) grid.appendChild(cardEl(id, () => { sfx('card'); sendCmd({ c: 'pick', card: id }); show('cards', false); setTimeout(() => openCards(), 300); }));
  } else {
    if (fromOffer) return;
    $('cardsTitle').textContent = 'Приказы в руке';
    if (!s.hands[side].length) grid.innerHTML = '<p class="muted">Приказов нет. Новые приходят каждый третий ход.</p>';
    for (const id of s.hands[side]) grid.appendChild(cardEl(id, () => {
      const t = cardTargets(app.state, side, id);
      show('cards', false);
      if (t === null) { sendCmd({ c: 'card', card: id }); return; }
      if (!t.length) { toast('Нет подходящей цели'); sfx('error'); return; }
      app.targeting = { kind: 'card', card: id, from: -1, targets: t };
      $('targetText').textContent = `${CARDS[id].name}: выберите цель`;
      show('targetBar');
      app.sel = -1;
      updateHighlights();
      updateInfo();
    }));
  }
  show('cards');
}
function cardEl(id, onClick) {
  const c = CARDS[id];
  const b = document.createElement('button');
  b.className = 'order';
  b.innerHTML = `${ico(A.card(id))}<b>${c.name}</b><span>${c.desc}</span>`;
  b.onclick = onClick;
  return b;
}

// board gestures
const touches = new Map();
let gesture = null;
canvas.addEventListener('pointerdown', (e) => {
  initAudio();
  if (workshop.active) return;
  if (app.rtView || !app.state) return;
  canvas.setPointerCapture(e.pointerId);
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, btn: e.button });
  if (touches.size === 2) {
    const [a, b] = [...touches.values()];
    gesture = { dist: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), multi: true };
  } else gesture = { moved: false };
});
canvas.addEventListener('pointermove', (e) => {
  const t = touches.get(e.pointerId);
  if (!t || app.rtView || workshop.active) return;
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
  if (gesture.moved) { if (t.btn === 2) board.rotate(dx * 0.01); else board.pan(dx, dy); }
});
const endPointer = (e) => {
  const t = touches.get(e.pointerId);
  touches.delete(e.pointerId);
  if (!t || app.rtView || workshop.active) return;
  if (gesture && !gesture.moved && !gesture.multi && touches.size === 0) {
    onTapSquare(board.pick((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1));
  }
  if (touches.size === 0) gesture = null;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => { if (!app.rtView && !workshop.active) board.zoom(e.deltaY > 0 ? 1.1 : 0.9); }, { passive: true });

// ---------- real-time phases ----------
function ctrlFor(side, role, rt) {
  if (side === 'n') return 'ai';
  if (app.mode === 'ai') return side === 'w' ? 'local' : 'ai';
  if (app.mode === 'hot') return role === 'att' || (rt && rt.att.s === 'n') ? 'local' : 'ai';
  if (app.mode === 'host') return side === 'w' ? 'local' : 'remote';
  return 'remote';
}

function fighterTags(f) {
  const t = [RANKS[f.rank]];
  if (f.allies) t.push(`+${f.allies} союзн.`);
  if (f.dug) t.push('Окоп');
  if (f.bld) t.push('Здание');
  if (f.smoke) t.push('Дым');
  if (f.buff || f.counter) t.push('Боевой дух');
  if (f.penal) t.push('Штрафбат');
  if (!f.supplied) t.push('Без снабжения');
  return t.map((x) => `<span>${x}</span>`).join('');
}

function startRealtime() {
  const s = app.state;
  const rt = s.rt;
  app.rtOverShown = false;
  app.remoteInput = null;
  app.pendingEv = []; app.pendingOd = [];
  clearTimeout(app.aiTimer);
  app.sel = -1; app.targeting = null;
  ['targetBar', 'info', 'shop', 'sabo', 'cards'].forEach((id) => show(id, false));
  controls.reset();
  if (rt.kind === 'duel') {
    const ca = ctrlFor(rt.att.s, 'att', rt), cd = ctrlFor(rt.def.s, 'def', rt);
    // bots fighting bots: resolve instantly
    if (authority() && ca === 'ai' && cd === 'ai') {
      finishDuel(s, autoResolve(rt));
      onStateChange();
      return;
    }
    let localTeam = null;
    if (app.mode === 'guest') localTeam = rt.att.s === 'b' ? 'att' : rt.def.s === 'b' ? 'def' : null;
    else localTeam = ca === 'local' ? 'att' : cd === 'local' ? 'def' : null;
    app.localTeam = localTeam;
    const boardShot = settings.cine ? 1.3 : 0;
    app.intro = boardShot + 1.7;
    app.showDuelAt = performance.now() + boardShot * 1000;
    if (authority()) {
      app.sim = new DuelSim(rt, { ctrl: { att: ca, def: cd }, difficulty: settings.diff });
      app.simKind = 'duel';
    }
    duel.start(rt, localTeam, (n, v) => sfx(n, v), s.customDefs);
    duel.resize(innerWidth, innerHeight);
    if (app.sim) duel.apply(app.sim.snapshot(), false);
    app.rtView = 'duel';
    // VS screen
    const porOf = (f) => (f.t === 'C' ? A.por('C') : f.s === 'n' && f.t !== 'D' ? A.por('X') : A.por(f.t));
    $('vsPorA').src = porOf(rt.att); $('vsPorD').src = porOf(rt.def);
    $('vsNameA').textContent = `${rt.att.name} · ${SIDE_NAME[rt.att.s]}`;
    $('vsNameD').textContent = `${rt.def.name} · ${SIDE_NAME[rt.def.s]}`;
    $('vsTagsA').innerHTML = fighterTags(rt.att);
    $('vsTagsD').innerHTML = fighterTags(rt.def);
    app.rtT0 = performance.now();
    app.rtStage = 0;
    app.rtBoardShot = boardShot * 1000;
    const f = localTeam ? rt[localTeam] : rt.att;
    $('abName').textContent = SPECIALS[f.duel] ? SPECIALS[f.duel].name : '—';
    $('abIcon').src = A.ab(f.duel || 'd_grenade');
    $('dPorA').src = porOf(rt.att); $('dPorD').src = porOf(rt.def);
    $('dNameA').textContent = `${rt.att.name}${rt.att.allies ? ' +' + rt.att.allies : ''}`;
    $('dNameD').textContent = `${rt.def.allies ? rt.def.allies + '+ ' : ''}${rt.def.name}`;
  } else {
    const local = app.mode === 'guest' ? rt.side === 'b' : ctrlFor(rt.side, 'att') === 'local' && !isAiSide(rt.side);
    app.localTeam = local ? 'drone' : null;
    app.intro = 1.2;
    app.showDuelAt = 0;
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
    show('reloadBtn', false);
    show('spectate', false);
    $('abName').textContent = 'УСКОР.';
    $('abIcon').src = A.icon('action');
    $('fpvSide').textContent = `FPV ${SIDE_NAME[rt.side]}`;
    $('fpvHelp').textContent = local ? 'Стик: поворот и высота. Кнопка — ускорение. Тараньте врага или его завод!' : 'Вражеский дрон в воздухе!';
    banner(local ? 'FPV-ДРОН' : 'ВОЗДУШНАЯ УГРОЗА', local ? 'Найдите и поразите цель' : 'Противник запустил дрон', 1400);
    if (app.sim) applyDroneSnap(app.sim.snapshot());
    playMusic('drone');
    droneBuzz(true);
  }
}

// cinematic -> VS screen -> fight, driven by the frame loop (timers get throttled in background)
function updateRtStage(now) {
  if (app.rtView !== 'duel') return;
  const e = now - app.rtT0;
  if (app.rtStage === 0 && e >= app.rtBoardShot) {
    app.rtStage = 1;
    show('vs'); sfx('vs'); playMusic('duel');
    show('hud', false);
  }
  if (app.rtStage === 1 && e >= app.rtBoardShot + 1500) {
    app.rtStage = 2;
    const lt = app.localTeam;
    show('vs', false);
    show('duelHud');
    show('sticks', !!lt);
    show('stickR', true);
    show('reloadBtn', !!lt);
    show('ammo', !!lt);
    show('spectate', !lt);
    banner('БОЙ!', lt === 'att' ? 'Уничтожьте защитника' : lt === 'def' ? 'Удержите позицию!' : '', 1000);
    sfx('alarm');
  }
}

function applyDroneSnap(d) {
  board.droneSnap = d;
  $('fpvBat').textContent = Math.max(0, Math.round((d.bat / DRONE_BATTERY) * 100));
  $('fpvAlt').textContent = d.y.toFixed(1);
  $('fpvSig').textContent = d.jam ? 'РЭБ! ПОМЕХИ |...' : 'СИГНАЛ ||||';
  $('fpvNoise').classList.toggle('on', !!d.jam || d.bat < 3);
  droneBuzz(!d.over, d.boost ? 1.6 : 1 + d.y * 0.02);
  for (const e of d.ev || []) {
    if (e.k === 'boom') { board.fx.explosion(e.x, Math.max(0.3, e.y), e.z, 2); sfx('boom'); }
    if (e.k === 'flak') { board.fx.flakBurst(e.x + (Math.random() - 0.5) * 3, e.y + (Math.random() - 0.5) * 2, e.z + (Math.random() - 0.5) * 3); sfx('flak', 0.4); }
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
    banner(snap.over.hits.length || snap.over.factory ? 'ЦЕЛЬ ПОРАЖЕНА' : 'ДРОН ПОТЕРЯН', snap.msg || '');
    droneBuzz(false);
  }
}

function endRtView() {
  if (app.rtView === 'duel') duel.dispose();
  board.droneSnap = null;
  app.rtView = null;
  app.sim = null;
  ['duelHud', 'droneHud', 'sticks', 'vs'].forEach((id) => show(id, false));
  droneBuzz(false);
  if (app.state) { show('hud'); if (!app.state.winner) playMusic('board'); }
}

function aimAssist(ax, az) {
  const me = duel.localRaw();
  if (!me) return [ax, az];
  const a = Math.atan2(az, ax);
  let best = null, bd = 0.28;
  for (const e of duel.enemiesRaw()) {
    const ea = Math.atan2(e[4] - me[4], e[3] - me[3]);
    let d = Math.abs(ea - a) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (d < bd && Math.hypot(e[3] - me[3], e[4] - me[4]) < 26) { bd = d; best = ea; }
  }
  if (best === null) return [ax, az];
  let diff = best - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const na = a + diff * 0.65;
  const m = Math.hypot(ax, az);
  return [Math.cos(na) * m, Math.sin(na) * m];
}

function localInput() {
  if (app.rtView === 'duel') {
    const lu = duel.localUnit();
    return controls.duelInput(lu ? { x: lu.x, z: lu.z } : null, (x, y) => duel.groundPoint(x, y), aimAssist);
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
      const slow = app.simKind === 'duel' && duel.slowmo > 0 ? 0.35 : 1;
      const steps = Math.min(4, Math.max(1, Math.round(dt / (1 / 60))));
      const h = (Math.min(dt, 1 / 15) / steps) * slow;
      for (let i = 0; i < steps; i++) {
        if (app.simKind === 'duel') {
          const inputs = {};
          if (app.localTeam) inputs[app.localTeam] = inp;
          const remoteTeam = app.mode === 'host' ? (s.rt.att.s === 'b' ? 'att' : s.rt.def.s === 'b' ? 'def' : null) : null;
          if (remoteTeam) inputs[remoteTeam] = app.remoteInput;
          sim.step(h, inputs);
          if (i === 0 && inp) { inp.ab = false; inp.reload = false; }
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
      if (app.simKind === 'duel') finishDuel(s, res); else finishDrone(s, res);
      endRtView();
      onStateChange();
    }
  } else if (app.mode === 'guest' && app.localTeam) {
    app.sendAcc += dt;
    if (app.sendAcc > 0.033) { app.sendAcc = 0; app.net.send({ t: 'inp', i: localInput() }); }
  }
  if (app.rtView === 'duel' && duel.snap) {
    const sn = duel.snap;
    $('dTimer').textContent = Math.ceil(sn.t);
    for (const u of sn.u) {
      if (!u[12]) continue;
      hpBlocks(u[2] === 'att' ? $('dHpA') : $('dHpD'), u[6], u[7]);
      if (u[2] === app.localTeam) {
        const sp = SPECIALS[app.state.rt && app.state.rt[app.localTeam] ? app.state.rt[app.localTeam].duel : ''];
        $('abCd').style.height = (sp ? Math.min(1, u[11] / sp.cd) : 0) * 100 + '%';
        $('ammoVal').textContent = u[15] ? 'ПЕРЕЗАРЯДКА' : `${u[13]}/${u[14]}`;
        $('reloadFill').style.width = (u[15] ? 100 : (u[13] / u[14]) * 100) + '%';
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
  $('overIco').src = A.icon(youWin === false ? 'skull' : 'trophy');
  sfx(youWin === false ? 'lose' : 'win');
  playMusic(youWin === false ? 'defeat' : 'victory');
  const st = s.stats;
  $('overStats').innerHTML = `${s.byScore ? `Перемирие на ${MAX_TURNS}-м ходу. Очки: Синие ${s.byScore.w} — Красные ${s.byScore.b}<br>` : 'Вражеский генерал уничтожен!<br>'}Ходов: ${s.turnNo}<br>
    <span style="color:var(--blue)">Синие</span>: уничтожено ${st.w.kills}, боёв выиграно ${st.w.duelsWon}, дронов ${st.w.drones}<br>
    <span style="color:var(--red)">Красные</span>: уничтожено ${st.b.kills}, боёв выиграно ${st.b.duelsWon}, дронов ${st.b.drones}`;
  show('hud', false);
  show('over');
}

// ---------- help ----------
function renderHelp() {
  const units = ['P', 'N', 'B', 'R', 'Q', 'K', 'M', 'E', 'A', 'L', 'T'];
  $('helpBody').innerHTML = `<div class="plaque">Как играть</div>
  <p><b>Цель:</b> уничтожить вражеского <b>Генерала</b>. Шаха и мата нет — генерала берут в бою, дронами, артиллерией или авиацией. На 60-м ходу — перемирие и победа по очкам.</p>
  <p><b>Ход:</b> одно действие — ход фигурой, способность, дрон, авиаудар или B-2. Покупки и приказы действие не тратят.</p>
  <p><b>Атака = бой!</b> При взятии начинается схватка на арене: левый стик — движение, правый — прицел и огонь, кнопка — спецприём, отдельная кнопка — перезарядка. Снайперы делают хедшоты, дома рушатся, соседние союзники приходят на помощь.</p>
  <p><b>Звания:</b> за победы фигуры растут от Рядового до Ветерана: больше HP и урона.</p>
  <p><b>Линия фронта и логистика:</b> территория даёт доход, отрезанные от тыла юниты не лечатся. Ж/д перебрасывает войска, бронепоезд ездит по путям. Объекты на карте: нефтевышки (+доход), радары (видят мины и маскировку), аэродромы (дешёвая авиация).</p>
  <p><b>Приказы:</b> каждый третий ход выберите карту — дым, резервы, партизаны, ленд-лиз и другие.</p>
  <p><b>События:</b> распутица, метель, перебежчики, а изредка — исторические потрясения: гражданская война, мятеж диктатора, пакт о ненападении. В городе — аварии, пожары и затопление метро.</p>
  <p><b>B-2:</b> если у вас 39% линии фронта или меньше — командование выделяет бомбардировщик-невидимку для ковровой бомбардировки.</p>
  <p><b>Мастерская:</b> соберите свою фигуру из деталей, раскрасьте, наложите фото и выберите способности — потом покупайте её в Штабе (вкладка «Особые»).</p>
  <div class="plaque small">Юниты</div>
  ${units.map((t) => { const d = unitDef(null, { t }); return `<p>${ico(A.unit(t))} <b>${d.name}</b> — ${d.desc}</p>`; }).join('')}
  <button class="btn" data-close2>Понятно</button>`;
  $('helpBody').querySelector('[data-close2]').onclick = () => show('help', false);
}

// ---------- main loop ----------
let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (workshop.active) { workshop.update(dt); renderer.render(workshop.scene, workshop.camera); return; }
  if (app.state) { updateRtStage(now); tickRealtime(dt); }
  if (app.rtView === 'duel' && duel.scene && now >= app.showDuelAt) {
    $('letterbox').classList.remove('on');
    duel.update(dt);
    renderer.render(duel.scene, duel.camera);
  } else {
    if (!app.state) board.camAz += dt * 0.05;
    board.update(dt);
    renderer.render(board.scene, board.camera);
  }
}
board.sync(newGame(), ['w']);
resize();
requestAnimationFrame(frame);
// status sprites draw pixel icons onto canvases, so redraw them once the icons are loaded
preload(['P', 'N', 'B', 'R', 'Q', 'K', 'M', 'E', 'A', 'L', 'T', 'D', 'X', 'C'].map(A.unit)
  .concat(['st_nosupply', 'st_stun', 'st_dug', 'st_shield', 'st_marked', 'st_stealth', 'st_buff', 'st_overwatch'].map(A.icon)))
  .then(() => { board.iconsReady = 1; board.sync(app.state || newGame(), app.state ? viewerSides() : ['w']); });

window.__fg = { app, board, duel, sendCmd, onTapSquare, startGame, controls, settings, workshop, onStateChange, openCards };
