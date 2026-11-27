// Duel mode: 2 or 3 forts/bosses, by turns (pass the phone / vs computer) or in real time (you vs computers),
// cameras (over-the-shoulder, projectile follow, impact orbit), wind, damage, dizzy, AI.
import * as THREE from '../lib/three.module.min.js';
import { makeWeapons, setSleeveColor } from './weapons.js';
import { MAT } from './world.js';
import { Crew } from './crew.js';

const R = (a, b) => a + Math.random() * (b - a);
const $ = id => document.getElementById(id);

export const DUEL_LAYOUT = {
  mode: 'duel', size: 64, n: 2,
  spawns: [[0, 7.5, 12.6, 0], [0, 7.5, -16.6, Math.PI]],
  hills: [{ x: -10.5, z: -3, h: 1.6, rx: 4.5, rz: 3.5 }, { x: 11.5, z: 2.5, h: 1.3, rx: 4, rz: 3 }, { x: 1.5, z: 4.5, h: 0.6, rx: 2.2, rz: 1.5 }],
  cars: [[-14, -1, Math.PI / 2, 0xd8392b], [14.5, -3, -Math.PI / 2, 0x2f9e6a]],
  barrels: [[6.6, 9.6], [7.3, 10.2], [-6.6, -12.6], [-7.3, -13.2], [-1.2, -2.8]],
  introLook: [0, 3, -2], center: [0, 0, -2],
  forts: [
    { x0: -5, x1: 5, z0: 9, z1: 15, face: -1, upper: 0xf2c7a0, trim: 0xffffff, banner: 0xff8a2a, tank: 0xff8a2a },
    { x0: -5, x1: 5, z0: -19, z1: -13, face: 1, upper: 0xb9d3ea, trim: 0xffffff, banner: 0x3d6fd1, tank: 0x3d6fd1 },
  ],
  // fields used by shared code paths
  house: { x0: -5, x1: 5, z0: -3, z1: 3 },
};

// three forts in a triangle around a central yard, every front facing the middle: each one for itself
const C3 = [0, 0.7];
const faceYaw = (x, z) => Math.atan2(-(C3[0] - x), -(C3[1] - z));
export const DUEL3_LAYOUT = {
  mode: 'duel', size: 64, n: 3,
  spawns: [[0, 7.5, 18.6, faceYaw(0, 18.6)], [-15.6, 7.5, -8, faceYaw(-15.6, -8)], [15.6, 7.5, -8, faceYaw(15.6, -8)]],
  hills: [{ x: -9, z: 6, h: 1.3, rx: 3.6, rz: 3 }, { x: 9, z: 6, h: 1.3, rx: 3.6, rz: 3 }, { x: 0, z: -5, h: 0.7, rx: 3, rz: 2.2 }],
  cars: [[-6.5, -17.5, 0.3, 0xd8392b], [6.5, -17.5, -0.3, 0x2f6fd1]],
  barrels: [[6.6, 16.5], [-6.6, 16.5], [-15, -1.2], [15, -1.2], [-15, -14.8], [15, -14.8], [0.6, -2.5], [-0.6, -3]],
  introLook: [0, 3, 1], center: [0, 0, 0.7],
  forts: [
    { x0: -5, x1: 5, z0: 15, z1: 21, face: '-z', upper: 0xf2c7a0, trim: 0xffffff, banner: 0xff8a2a, tank: 0xff8a2a },
    { x0: -18, x1: -12, z0: -13, z1: -3, face: '+x', upper: 0xb9d3ea, trim: 0xffffff, banner: 0x3d6fd1, tank: 0x3d6fd1 },
    { x0: 12, x1: 18, z0: -13, z1: -3, face: '-x', upper: 0xc8e6b8, trim: 0xffffff, banner: 0x2f9e4f, tank: 0x2f9e4f },
  ],
  house: { x0: -5, x1: 5, z0: -3, z1: 3 },
};

export const TEAMS = [
  { name: 'Marretões', boss: 'Dona Marreta', f: true, css: '#FF8A2A', vest: 0xff8a2a, helmet: 0xffc531, sleeve: 0xff8a2a, roofY: 7.5, spawn: new THREE.Vector3(0, 7.5, 12.6), yaw: 0 },
  { name: 'Betoneiras', boss: 'Seu Betão', css: '#5B8CFF', vest: 0x3d6fd1, helmet: 0xf4f4f4, sleeve: 0x3d6fd1, roofY: 7.5, spawn: new THREE.Vector3(0, 7.5, -16.6), yaw: Math.PI },
  { name: 'Guindastes', boss: 'Mestre Guincho', css: '#45C266', vest: 0x2f9e4f, helmet: 0xffd23a, sleeve: 0x2f9e4f, roofY: 7.5, spawn: new THREE.Vector3(15, 7.5, -16.6), yaw: 0 },
];

// real time: no per-turn limit, the strong weapons have a stock per match
const RT_STOCK = { rifle50: 5, granada: 4, canhao: 4, rpg: 3 };
// pause between the computer's shots in real time (seconds)
const RT_THINK = { facil: [4, 7], medio: [2.8, 5], dificil: [1.5, 2.8] };

// shots per turn and stock per match
export const RULES = {
  pedra: { shots: 2, stock: Infinity }, estilingue: { shots: 2, stock: Infinity }, pistola: { shots: 6, stock: Infinity }, smg: { shots: 20, stock: 4 },
  shotgun: { shots: 2, stock: Infinity }, rifle50: { shots: 1, stock: 4 }, granada: { shots: 1, stock: 3 },
  canhao: { shots: 1, stock: 3 }, rpg: { shots: 1, stock: 2 },
};

// what the AI knows about each weapon's ballistics (full charge)
const AI_SPEC = {
  pedra: { kind: 'arc', speed: 26, up: 2.5, grav: -13, wind: 0.35, hold: 0.75 },
  estilingue: { kind: 'arc', speed: 52, up: 0, grav: -9.81, wind: 0.25, hold: 1.15 },
  pistola: { kind: 'ray', hold: 0.05 }, smg: { kind: 'ray', hold: 2.4 }, shotgun: { kind: 'ray', hold: 0.05 }, rifle50: { kind: 'ray', hold: 0.05 },
  granada: { kind: 'arc', speed: 17, up: 3.5, grav: -13, wind: 0.3, hold: 0.45 },
  canhao: { kind: 'arc', speed: 62, up: 1.5, grav: -13, wind: 0.08, hold: 0.05 },
  rpg: { kind: 'rocket', hold: 0.05 },
};
const NOISE = { facil: [0.075, 0.07], medio: [0.032, 0.03], dificil: [0.012, 0.01] };

function mat(color, o = {}) { return new THREE.MeshStandardMaterial({ color, roughness: o.r != null ? o.r : 0.7, metalness: o.m || 0 }); }
function bx(w, h, d, m, x, y, z) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; return b; }

class Boss {
  constructor(game, team, layout, realtime) {
    this.game = game; this.team = team; this.T = TEAMS[team];
    const sp = layout.spawns[team];
    this.pos = new THREE.Vector3(sp[0], sp[1], sp[2]); this.vel = new THREE.Vector3();
    this.yaw = sp[3]; this.pitch = 0.05;
    this.onGround = true; this.bob = 0; this.bobAmp = 0; this.stepT = 0; this.knockT = 0;
    this.hp = 100; this.dizzy = 0; this.ko = false; this.out = false; this.stunT = 0;
    const f = layout.forts[team];
    this.bounds = { x0: f.x0 + 0.35, x1: f.x1 - 0.35, z0: f.z0 + 0.35, z1: f.z1 - 0.35 };
    this.stock = {}; for (const k in RULES) this.stock[k] = realtime ? (RT_STOCK[k] != null ? RT_STOCK[k] : Infinity) : RULES[k].stock;
    this.wi = realtime ? 2 : team === 0 ? 8 : 7;
    this.weapons = makeWeapons(game);
    this.pivot = new THREE.Object3D(); this.pivot.rotation.order = 'YXZ';
    game.scene.add(this.pivot);
    for (const w of this.weapons) { w.model.visible = false; this.pivot.add(w.model); w.model.traverse(o => { if (o.isMesh) o.castShadow = true; }); }
    this.buildModel();
    this.onLand = (speed) => { if (speed > 8.5) this.game.duel.damage(this, Math.min(40, (speed - 8.5) * 5), 'queda', this.pos.clone().add(new THREE.Vector3(0, 0.2, 0))); };
  }
  buildModel() {
    const T = this.T, g = this.model = new THREE.Group();
    const pants = mat(0x2d3a4f), vest = mat(T.vest, { r: 0.6 }), stripe = mat(0xf2f2f2), skin = mat(0xe0ac85), dark = mat(0x1a1a1a), helmet = mat(T.helmet, { r: 0.35 });
    g.add(bx(0.17, 0.78, 0.2, pants, -0.12, 0.39, 0), bx(0.17, 0.78, 0.2, pants, 0.12, 0.39, 0));
    g.add(bx(0.2, 0.12, 0.28, dark, -0.12, 0.06, -0.04), bx(0.2, 0.12, 0.28, dark, 0.12, 0.06, -0.04));
    g.add(bx(0.52, 0.62, 0.32, vest, 0, 1.08, 0));
    g.add(bx(0.53, 0.06, 0.33, stripe, 0, 0.98, 0), bx(0.53, 0.06, 0.33, stripe, 0, 1.18, 0));
    g.add(bx(0.16, 0.5, 0.16, vest, -0.34, 1.12, 0), bx(0.16, 0.5, 0.16, vest, 0.34, 1.12, 0));
    const head = this.head = new THREE.Group(); head.position.set(0, 1.58, 0);
    head.add(bx(0.4, 0.4, 0.38, skin, 0, 0, 0));
    head.add(bx(0.06, 0.08, 0.02, dark, -0.09, 0.04, -0.195), bx(0.06, 0.08, 0.02, dark, 0.09, 0.04, -0.195));
    const hel = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), helmet);
    hel.position.y = 0.14; hel.castShadow = true; head.add(hel);
    head.add(bx(0.56, 0.035, 0.5, helmet, 0, 0.14, -0.04));
    if (this.team === 1) head.add(bx(0.24, 0.05, 0.03, mat(0x3a2a1c), 0, -0.07, -0.2)); // moustache
    else if (this.team === 2) { head.add(bx(0.34, 0.12, 0.05, mat(0x8a8a8a), 0, -0.14, -0.18)); head.add(bx(0.34, 0.05, 0.02, mat(0x111111), 0, 0.04, -0.2)); } // grey beard + glasses
    else { const tail = bx(0.1, 0.22, 0.1, mat(0x6b3a1c), 0, -0.05, 0.24); tail.rotation.x = 0.4; head.add(tail); } // ponytail
    g.add(head);
    // dizzy stars
    this.stars = new THREE.Group();
    const sm = new THREE.MeshBasicMaterial({ color: 0xffe14a });
    for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), sm); s.userData.a = i / 4 * Math.PI * 2; this.stars.add(s); }
    this.stars.position.y = 1.95; this.stars.visible = false;
    g.add(this.stars);
    this.game.scene.add(g);
  }
  chest() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.05, this.pos.z); }
  headPos() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.6, this.pos.z); }
  update(dt, t) {
    const g = this.model;
    g.position.copy(this.pos);
    g.rotation.set(0, this.yaw, 0);
    if (this.ko) { g.rotation.x = -Math.PI / 2 * 0.95; g.position.y += 0.2; }
    this.head.rotation.x = this.ko ? 0 : this.pitch * 0.6;
    const showStars = this.ko || this.dizzy > 0 || this.stunT > 0;
    this.stars.visible = showStars;
    if (showStars) this.stars.children.forEach((s, i) => { const a = s.userData.a + t * 3.2; s.position.set(Math.cos(a) * 0.32, Math.sin(t * 5 + i) * 0.04, Math.sin(a) * 0.32); s.rotation.y = t * 4; });
    if (this.ko) this.stars.position.set(0, 0.35, -1.6); else this.stars.position.set(0, 1.95, 0);
    this.pivot.position.copy(this.headPos());
    this.pivot.rotation.set(this.pitch, this.yaw, 0);
    this.pivot.updateMatrixWorld(true);
  }
  dispose() {
    this.game.scene.remove(this.model); this.game.scene.remove(this.pivot);
  }
}

export class Duel {
  // opts: { n: 2|3, realtime, seats: ['human'|'cpu', ...], diff } ; legacy { cpu: true } = human vs computer
  constructor(game, opts) {
    this.game = game;
    this.n = opts.n || 2;
    this.realtime = !!opts.realtime;
    this.layout = opts.layout || DUEL_LAYOUT;
    this.seats = opts.seats || (opts.cpu ? ['human', 'cpu'] : ['human', 'human']);
    this.vsCPU = this.seats.includes('cpu');
    this.diff = opts.diff || 'medio';
    this.me = this.realtime ? 0 : -1;
    this.bosses = [];
    for (let t = 0; t < this.n; t++) this.bosses.push(new Boss(game, t, this.layout, this.realtime));
    this.turn = 0; this.round = 1;
    this.state = 'intro'; this.stateT = 0;
    this.camPos = new THREE.Vector3(26, 14, 4); this.camLook = new THREE.Vector3(...this.layout.introLook);
    this.zeroInput = { mx: 0, mz: 0, jump: false, lookDX: 0, lookDY: 0, keys: {} };
    this.ai = null;
    this.timer = 45; this.windT = 25; this.liveT = 0;
    this.newWind();
    this.trajPts = this.makeTrajectory();
    this.turnShots = 0; this.lockedWeapon = null; this.firedAny = false;
    this.followP = null; this.impact = null; this.bulletCam = null;
    this.lastFireT = 0; this.result = null; this.outSeen = new Set();
    this.buildBossHUD();
    this.aerial = false;
    this.crew = new Crew(this);
    $('crewbar').style.top = this.realtime ? '112px' : '156px';
    if (this.realtime) this.activateAll();
    else this.activate(0, true);
    const names = this.bosses.map(b => b.T.name).join(' × ');
    this.banner(this.realtime ? 'TEMPO REAL!' : 'DUELO!', this.realtime ? `${names} · cada um por si` : names, 2.2);
    $('duelhud').style.display = 'block';
    this.updateHUD(true);
  }

  get boss() { return this.bosses[this.turn]; }
  isAI(team = this.turn) { return this.seats[team] === 'cpu'; }
  liveTime() { return this.realtime ? this.liveT : this.totalT || 0; }
  get humans() { return this.seats.filter(s => s === 'human').length; }

  dispose() {
    if (this.crew) this.crew.dispose();
    for (const b of this.bosses) { for (const w of b.weapons) w.unequip(); b.dispose(); }
    this.game.scene.remove(this.trajPts);
    this.game.ctxAI = false; this.game.audio.ctxPos = null;
    $('duelhud').style.display = 'none';
    $('banner').style.display = 'none'; $('handoff').style.display = 'none'; $('result').style.display = 'none';
  }

  buildBossHUD() {
    const el = $('bosses');
    el.style.gridTemplateColumns = `repeat(${this.n}, minmax(0, 1fr))`;
    el.style.width = this.n === 3 ? 'min(540px, 48vw)' : '';
    $('duelhud').classList.toggle('n3', this.n === 3);
    el.innerHTML = this.bosses.map(b => `<div class="bcol"><div class="bl" style="color:${b.T.css}">${this.realtime && b.team === this.me ? 'VOCÊ' : b.T.boss.toUpperCase()}</div><div class="hpw"><div id="hp${b.team}" class="hp" style="background:${b.T.css};width:100%"></div></div><div class="bn"><span id="hpn${b.team}">100</span><span id="fort${b.team}"></span></div></div>`).join('');
  }

  makeTrajectory() {
    const n = 90;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffe14a, size: 0.32, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false }));
    p.frustumCulled = false; p.visible = false; p.renderOrder = 6;
    this.game.scene.add(p);
    return p;
  }

  newWind() {
    const s = R(-1, 1);
    const mag = Math.abs(s) < 0.15 ? 0 : s * 7;
    this.game.wind.set(mag, 0, R(-0.8, 0.8));
  }

  // ---------- turn mode: switch the active boss (weapons, sleeves, player binding) ----------
  activate(team, first = false) {
    const g = this.game;
    const prev = this.bosses[this.turn];
    if (!first) for (const w of prev.weapons) w.unequip();
    this.turn = team;
    const b = this.bosses[team];
    g.player = b;
    g.weapons = b.weapons;
    g.wi = b.wi;
    g.aimFrame = b.pivot;
    setSleeveColor(b.T.sleeve);
    this.turnShots = 0; this.lockedWeapon = null; this.firedAny = false;
    this.timer = 45;
    g.recoilP = 0;
    if (g.zoomed) g.toggleZoom(false);
  }

  // ---------- real time: every boss holds a weapon; the game is bound to "me" except inside withCtx ----------
  activateAll() {
    const g = this.game;
    for (const b of this.bosses) this.withCtx(b, () => { g.wi = -1; g.selectWeapon(b.wi, true); });
    const me = this.bosses[this.me];
    this.turn = this.me; g.player = me; g.weapons = me.weapons; g.wi = me.wi; g.aimFrame = me.pivot;
    setSleeveColor(me.T.sleeve);
    g.recoilP = 0;
    if (g.zoomed) g.toggleZoom(false);
  }
  // run fn as if bb were the player (weapons, aim, sounds placed at bb, no camera shake/vibration for others)
  withCtx(bb, fn) {
    const g = this.game;
    const save = [g.player, g.weapons, g.wi, g.aimFrame, this.turn, g.ctxAI, g.audio.ctxPos];
    g.player = bb; g.weapons = bb.weapons; g.wi = bb.wi; g.aimFrame = bb.pivot; this.turn = bb.team;
    const other = bb.team !== this.me;
    g.ctxAI = other; g.audio.ctxPos = other ? bb.headPos() : null;
    try { fn(); } finally {
      bb.wi = g.wi;
      [g.player, g.weapons, g.wi, g.aimFrame, this.turn, g.ctxAI, g.audio.ctxPos] = save;
    }
  }

  // ---------- turn flow ----------
  setState(s) { this.state = s; this.stateT = 0; }

  fortPct(t) { const w = this.game.world; return w.teamTotal[t] ? w.teamRemoved[t] / w.teamTotal[t] : 0; }
  eliminated(t) { const b = this.bosses[t]; return b.ko || b.out || this.fortPct(t) >= 0.75; }
  alive() { return this.bosses.filter(b => !this.eliminated(b.team)); }

  startTurn() {
    const b = this.boss;
    if (b.dizzy > 0) {
      b.dizzy--;
      this.banner(`${b.T.boss.toUpperCase()} ESTÁ TONTO!`, 'Perde a vez', 1.8);
      this.setState('skip');
      return;
    }
    this.newWind();
    const g = this.game;
    g.selectWeapon(b.wi, true);
    this.setState('aim');
    this.banner(`VEZ DOS ${b.T.name.toUpperCase()}`, b.T.boss + (this.isAI() ? ' (computador)' : ''), 1.4);
    if (this.isAI()) this.ai = { t: 0, phase: 'choose', shot: 0 };
  }

  endTurn() {
    this.ai = null;
    this.trajPts.visible = false;
    if (this.checkWin()) return;
    let next = this.turn;
    for (let i = 1; i <= this.n; i++) { const t = (this.turn + i) % this.n; if (!this.eliminated(t)) { next = t; break; } }
    if (next <= this.turn) this.round++;
    this.activate(next);
    if (this.seats[next] === 'human' && this.humans > 1) { this.showHandoff(); this.setState('handoff'); }
    else this.setState('transition');
  }

  // announces bosses that just dropped out; ends the match when one (or none) is left
  checkWin() {
    if (this.state === 'over') return true;
    for (const b of this.bosses) if (this.eliminated(b.team) && !this.outSeen.has(b.team)) {
      this.outSeen.add(b.team);
      b.out = true;
      if (b.isDownFire) b.isDownFire = false;
      const alive = this.alive().length;
      if (alive >= 2) this.game.toast(`${b.T.name.toUpperCase()} FORA DO JOGO!`);
    }
    const alive = this.alive();
    const meOut = this.realtime && this.eliminated(this.me);
    if (alive.length > 1 && !meOut) return false;
    this.setState('over');
    this.trajPts.visible = false;
    for (const b of this.bosses) for (const w of b.weapons) if (w.isDown) this.withCtx(b, () => w.up());
    const res = $('result');
    let t0, t1, color = '#fff';
    if (alive.length === 1 && (!meOut || alive[0].team === this.me)) {
      const win = alive[0];
      t0 = this.realtime && win.team === this.me ? 'VOCÊ VENCEU!' : `VITÓRIA DOS ${win.T.name.toUpperCase()}!`;
      t1 = this.realtime ? `${win.T.boss} foi ${win.T.f ? 'a última' : 'o último'} de pé` : this.n === 2 ? this.loserLine(this.bosses[1 - win.team]) : `${win.T.boss} sobrou ${win.T.f ? 'sozinha' : 'sozinho'} no canteiro`;
      color = win.T.css; this.focusOver = this.bosses.find(b => b !== win && b.ko) || win;
      this.game.audio.play('explosion', { vol: 0.5, rate: 1.4 });
    } else if (meOut) {
      const me = this.bosses[this.me];
      t0 = 'VOCÊ FOI ELIMINADO!'; t1 = this.loserLine(me) + (alive.length ? ` · ${alive.map(b => b.T.name).join(' e ')} continuam de pé` : '');
      color = me.T.css; this.focusOver = me;
    } else { t0 = 'EMPATE!'; t1 = 'Todo mundo foi pro chão'; }
    res.querySelector('.rt').textContent = t0;
    res.querySelector('.rt').style.color = color;
    res.querySelector('.rs').textContent = t1;
    res.querySelector('.rst').innerHTML = this.bosses.map(b => `<div><b style="color:${b.T.css}">${b.T.name}</b> · forte destruído ${Math.round(this.fortPct(b.team) * 100)}% · energia do chefe ${Math.max(0, Math.round(b.hp))}</div>`).join('') +
      `<div>${this.realtime ? `${Math.round(this.liveT)} segundos de briga` : `${this.round} rodadas`}</div>`;
    setTimeout(() => { res.style.display = 'flex'; }, 1500);
    return true;
  }
  loserLine(b) { return b.ko ? `${b.T.boss} foi ${b.T.f ? 'nocauteada' : 'nocauteado'}` : `O forte dos ${b.T.name} foi abaixo`; }

  showHandoff() {
    const b = this.boss, el = $('handoff');
    el.querySelector('.ht').textContent = `Passe o celular para ${b.T.boss}`;
    el.querySelector('.ht').style.color = b.T.css;
    el.querySelector('.hs').textContent = `${b.T.name} · rodada ${this.round}`;
    el.style.display = 'flex';
  }
  handoffReady() { $('handoff').style.display = 'none'; if (this.state === 'handoff') this.setState('transition'); }

  banner(title, sub, dur) {
    const el = $('banner');
    el.querySelector('.bt').textContent = title;
    el.querySelector('.bs').textContent = sub || '';
    el.style.display = 'flex';
    el.classList.remove('out'); void el.offsetWidth; el.classList.add('in');
    clearTimeout(this._bt);
    this._bt = setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.style.display = 'none'; }, 400); }, dur * 1000);
  }

  // ---------- firing hooks ----------
  canFire() {
    const b = this.boss, w = this.game.weapons[this.game.wi];
    if (this.realtime) {
      if (this.state !== 'live' || b.ko || b.out || b.stunT > 0) return false;
      if (b.stock[w.id] <= 0) { if (!this.isAI()) this.game.toast('ACABOU A MUNIÇÃO DESSA ARMA'); return false; }
      return true;
    }
    if (this.state !== 'aim' || this.result) return false;
    if (this.lockedWeapon && this.lockedWeapon !== w) return false;
    if (this.firedAny && this.turnShots <= 0) return false;
    if (!this.firedAny && b.stock[w.id] <= 0) { this.game.toast('SEM ESTOQUE DESSA ARMA'); return false; }
    return true;
  }
  canSwitch() {
    if (this.realtime) { const b = this.boss; return this.state === 'live' && !b.ko && !b.out && !(b.stunT > 0); }
    return !this.firedAny && (this.state === 'aim' || this.state === 'transition');
  }
  switchBlockedMsg() { return this.realtime ? (this.boss.stunT > 0 ? 'TONTO! ESPERE PASSAR' : 'AGORA NÃO DÁ') : 'ARMA TRAVADA ATÉ O FIM DO TURNO'; }

  onFired(w, info = {}) {
    if (this.game.mode !== 'duel') return;
    const b = this.boss;
    if (this.realtime) {
      if (b.stock[w.id] !== Infinity) b.stock[w.id]--;
      if (b.team === this.me) this.updateHUD(true);
      return;
    }
    if (!this.firedAny) {
      this.firedAny = true; this.lockedWeapon = w;
      this.turnShots = RULES[w.id].shots;
      if (b.stock[w.id] !== Infinity) b.stock[w.id]--;
    }
    this.turnShots--;
    this.lastFireT = 0;
    if (w.id === 'rifle50' && info.hitscan) this.bulletCam = { from: info.from.clone(), to: info.hitscan.clone(), t: 0 };
    if (this.turnShots <= 0) this.setState('flight');
    this.updateHUD(true);
  }
  onProjectile(p) {
    p.owner = this.boss;
    p.windK = { rock: 0.35, ball: 0.25, grenade: 0.3, cannonball: 0.08, rocket: 0.2 }[p.type] || 0;
    if (this.realtime) return;
    if (this.turnShots <= 0 || ['cannonball', 'rocket', 'grenade'].includes(p.type)) this.followP = p;
  }
  onImpact(pos) { if (!this.realtime) this.impact = { pos: pos.clone(), t: 0 }; }

  // ---------- damage ----------
  damage(b, dmg, cause, at) {
    if (b.crewMember) return this.crew.damageCap(b, dmg, cause, at);
    if (b.crate) return this.crew.hitCrate(b, dmg);
    if (b.ko || dmg <= 0.5 || this.state === 'over') return;
    b.hp -= dmg;
    const g = this.game;
    g.floaterText(`-${Math.round(dmg)}`, at || b.headPos(), b.T.css);
    g.audio.play('hit', { pos: b.chest(), vol: Math.min(1, 0.4 + dmg / 40), rate: 0.8 });
    const mine = this.realtime ? b.team === this.me : b === this.boss;
    if (mine) { const save = g.ctxAI; g.ctxAI = false; g.haptic(Math.min(1, dmg / 40)); g.ctxAI = save; }
    if (b.hp <= 0) {
      b.hp = 0; b.ko = true; b.stunT = 0;
      g.toast(`${b.T.boss.toUpperCase()} ${b.T.f ? 'NOCAUTEADA' : 'NOCAUTEADO'}!`);
      g.audio.play('bigimpact', { pos: b.chest(), vol: 0.8 });
      for (const w of b.weapons) if (w.isDown) this.withCtx(b, () => w.up());
    } else if (this.realtime) {
      // real time: dizzy = a few seconds frozen, longer for harder hits
      if (dmg >= 20) {
        const s = Math.min(6, 1.5 + dmg / 10);
        if (s > b.stunT) {
          b.stunT = s;
          g.toast(b.team === this.me ? `VOCÊ FICOU TONTO! (${Math.ceil(s)} s)` : `${b.T.boss.toUpperCase()} FICOU TONTO!`);
          for (const w of b.weapons) if (w.isDown) this.withCtx(b, () => w.up());
        }
      }
    } else if (dmg >= 28 && b.dizzy === 0) {
      b.dizzy = 1;
      g.toast(`${b.T.boss.toUpperCase()} FICOU TONTO!`);
    }
    this.updateHUD(true);
  }

  explosionHit(pos, P, R0) {
    for (const b of this.bosses) {
      const c = b.chest();
      const d = c.distanceTo(pos);
      const RR = R0 * 1.25;
      if (d > RR) continue;
      let f = 1 - d / RR;
      const dir = c.clone().sub(pos);
      const len = dir.length(); dir.divideScalar(len || 1);
      const h = this.game.world.raycast(pos, dir, Math.max(0, len - 0.35));
      if (h) f *= 0.35;
      this.damage(b, 26 * P * f, 'explosão', b.headPos());
      // knockback: can push a boss right off the roof
      const k = 11 * P * f;
      b.vel.x += dir.x * k; b.vel.z += dir.z * k; b.vel.y += 3.5 * P * f + Math.max(0, dir.y) * k * 0.5;
      b.knockT = 0.5 + f * 0.6; b.onGround = false;
    }
    if (this.crew) this.crew.explosionHit(pos, P, R0);
  }

  // ray vs boss spheres (chest + head) -> {b, t, head}
  // ...also henchmen and crates in the air or on the ground (they can be shot too)
  rayBosses(o, d, maxT, exclude) {
    let best = null, bt = maxT;
    const list = this.crew ? [...this.bosses, ...this.crew.targets()] : this.bosses;
    for (const b of list) {
      if (b === exclude || b.ko) continue;
      const spheres = b.crate ? [[b.pos, 0.5, false]] : b.crewMember ? [[b.chest(), 0.3, false], [b.headPos(), 0.2, true]] : [[b.chest(), 0.38, false], [b.headPos(), 0.26, true]];
      for (const [c, r, head] of spheres) {
        const oc = o.clone().sub(c);
        const bb = oc.dot(d), cc = oc.lengthSq() - r * r, disc = bb * bb - cc;
        if (disc < 0) continue;
        const t = -bb - Math.sqrt(disc);
        if (t > 0 && t < bt) { bt = t; best = { b, t, head }; }
      }
    }
    return best;
  }

  crush(body, speed) {
    for (const b of this.bosses) {
      if (body.pos.distanceTo(b.chest()) < body.radius * 0.75 + 0.5) this.damage(b, Math.min(30, body.mass * speed * 4), 'escombros', b.headPos());
    }
  }

  // ---------- AI ----------
  pickTarget(b) {
    const foes = this.bosses.filter(x => x !== b && !this.eliminated(x.team));
    if (!foes.length) return null;
    // weaker bosses are a bit juicier; in real time the human gets more or less attention by difficulty
    let tot = 0;
    const meK = { facil: 0.8, medio: 0.95, dificil: 1.15 }[this.diff];
    const wts = foes.map(f => { const w = (1.25 - f.hp / 400) * (this.realtime && f.team === this.me ? meK : 1); tot += w; return w; });
    let r = Math.random() * tot;
    for (let i = 0; i < foes.length; i++) { r -= wts[i]; if (r <= 0) return foes[i]; }
    return foes[0];
  }
  aiSolve(w, b = this.boss, enemy = this.pickTarget(b)) {
    const g = this.game;
    const spec = AI_SPEC[w.id];
    const target = enemy.chest();
    // explosives sometimes go for the wall under the enemy, to make the roof collapse
    if ((w.id === 'canhao' || w.id === 'rpg' || w.id === 'granada') && Math.random() < 0.35) target.y -= R(2.5, 4.5);
    const o = b.headPos();
    const dx = target.x - o.x, dz = target.z - o.z, dist = Math.hypot(dx, dz);
    const yaw0 = Math.atan2(-dx, -dz);
    let pitch0 = Math.atan2(target.y - o.y, dist);
    let best = { yaw: yaw0, pitch: pitch0 };
    if (spec.kind === 'rocket') best.pitch += 0.012 * dist / 25;
    if (spec.kind === 'arc') {
      let bd = 1e9;
      const wind = g.wind;
      for (let py = -0.35; py <= 1.1; py += 0.02) {
        for (let yo = -0.22; yo <= 0.22; yo += 0.02) {
          const yaw = yaw0 + yo;
          const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(py), Math.sin(py), -Math.cos(yaw) * Math.cos(py));
          const p = o.clone().addScaledVector(dir, 0.5);
          const v = dir.multiplyScalar(spec.speed); v.y += spec.up;
          let md = 1e9;
          for (let s = 0; s < 160; s++) {
            const h = 0.025;
            v.y += spec.grav * h; v.addScaledVector(wind, spec.wind * h);
            p.addScaledVector(v, h);
            const dd = p.distanceToSquared(target);
            if (dd < md) md = dd;
            if (p.y < g.terrain.heightAt(p.x, p.z) || (s > 6 && g.world.matAt(p.x, p.y, p.z))) break;
            if (dd > md + 30 && s > 20) break;
          }
          if (md < bd) { bd = md; best = { yaw, pitch: py }; }
        }
      }
    }
    const nz = NOISE[this.diff];
    best.yaw += R(-1, 1) * nz[1]; best.pitch += R(-1, 1) * nz[0];
    return best;
  }
  aiPickWeapon(b) {
    const opts = [];
    const W = { rpg: 5, canhao: 5, granada: 3, rifle50: 3, shotgun: 2, smg: 2.2, pistola: 1.5, estilingue: 0.8, pedra: 0.4 };
    for (let i = 0; i < b.weapons.length; i++) { const id = b.weapons[i].id; if (b.stock[id] > 0) opts.push([i, W[id] || 1]); }
    let tot = opts.reduce((a, o) => a + o[1], 0), r = Math.random() * tot, pick = opts[0][0];
    for (const [i, wg] of opts) { r -= wg; if (r <= 0) { pick = i; break; } }
    return pick;
  }

  updateAI(dt) {
    const ai = this.ai, g = this.game, b = this.boss;
    if (!ai) return;
    ai.t += dt;
    const w = g.weapons[g.wi];
    if (ai.phase === 'choose') {
      if (ai.t < 0.6) return;
      g.selectWeapon(this.aiPickWeapon(b), true);
      ai.target = this.pickTarget(b);
      ai.phase = 'ready'; ai.t = 0;
      return;
    }
    if (ai.phase === 'ready') {
      if (!w.ready || w.anim) { if (ai.t > 8) { this.passTurn(); } return; }
      if (!ai.target || this.eliminated(ai.target.team)) ai.target = this.pickTarget(b);
      if (!ai.target) { this.passTurn(); return; }
      ai.sol = this.aiSolve(w, b, ai.target); ai.from = { yaw: b.yaw, pitch: b.pitch }; ai.phase = 'turning'; ai.t = 0;
      return;
    }
    if (ai.phase === 'turning') {
      const k = Math.min(1, ai.t / 1.1), e = k * k * (3 - 2 * k);
      let dy = ai.sol.yaw - ai.from.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      b.yaw = ai.from.yaw + dy * e; b.pitch = ai.from.pitch + (ai.sol.pitch - ai.from.pitch) * e;
      if (k >= 1 && ai.t > 1.4) { ai.phase = 'hold'; ai.t = 0; g.fireDown(true); }
      return;
    }
    if (ai.phase === 'hold') {
      if (ai.t >= AI_SPEC[w.id].hold) { g.fireUp(true); ai.phase = 'after'; ai.t = 0; }
      return;
    }
    if (ai.phase === 'after') {
      if (this.state !== 'aim') return;
      if (ai.t > 0.6 && w.ready && !w.anim) { ai.phase = 'ready'; ai.t = 0; }
      else if (ai.t > 10) this.passTurn();
    }
  }

  // real time: each computer boss loops wait -> pick weapon & target -> turn -> shoot
  updateAIRT(b, dt) {
    const g = this.game, w = g.weapons[g.wi];
    const ai = b.ai || (b.ai = { phase: 'wait', t: 0, wait: R(1.5, 3.5) });
    ai.t += dt;
    if (b.stunT > 0) { if (w.isDown) g.fireUp(true); ai.phase = 'wait'; ai.t = 0; ai.wait = R(0.4, 1.2); return; }
    const think = RT_THINK[this.diff];
    if (ai.phase === 'wait') {
      if (ai.t < ai.wait) return;
      const pick = this.aiPickWeapon(b);
      if (pick !== g.wi) g.selectWeapon(pick, true);
      ai.target = this.pickTarget(b);
      ai.phase = 'ready'; ai.t = 0;
      return;
    }
    if (ai.phase === 'ready') {
      if (!ai.target || this.eliminated(ai.target.team)) ai.target = this.pickTarget(b);
      if (!ai.target) return;
      if (!w.ready || w.anim) { if (ai.t > 6) { ai.phase = 'wait'; ai.t = 0; ai.wait = 0.5; } return; }
      ai.sol = this.aiSolve(w, b, ai.target); ai.from = { yaw: b.yaw, pitch: b.pitch }; ai.phase = 'turning'; ai.t = 0;
      return;
    }
    if (ai.phase === 'turning') {
      const k = Math.min(1, ai.t / 0.8), e = k * k * (3 - 2 * k);
      let dy = ai.sol.yaw - ai.from.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      b.yaw = ai.from.yaw + dy * e; b.pitch = ai.from.pitch + (ai.sol.pitch - ai.from.pitch) * e;
      if (k >= 1 && ai.t > 0.95) { ai.phase = 'hold'; ai.t = 0; g.fireDown(true); }
      return;
    }
    if (ai.phase === 'hold') {
      const hold = w.id === 'smg' ? 1.3 : AI_SPEC[w.id].hold;
      if (ai.t >= hold) { g.fireUp(true); ai.phase = 'wait'; ai.t = 0; ai.wait = R(think[0], think[1]); }
    }
  }

  // safety net: a weapon that is not ready and has nothing running to make it ready again gets prepared again
  watchdog(rdt) {
    const g = this.game, w = g.weapons[g.wi];
    const active = this.realtime ? this.state === 'live' : this.state === 'aim';
    if (!active || !w || !w.equipped || w.ready || w.anim) { this.stuckT = 0; return; }
    this.stuckT = (this.stuckT || 0) + rdt;
    if (this.stuckT > 1.5) { this.stuckT = 0; w.isDown = false; w.prep(); }
  }

  passTurn() {
    if (this.realtime || this.state !== 'aim') return;
    if (this.game.weapons[this.game.wi].isDown) this.game.weapons[this.game.wi].up();
    this.setState('flight');
  }

  // ---------- per-frame ----------
  update(rdt, dt) {
    this.totalT = (this.totalT || 0) + rdt;
    if (this.realtime) return this.updateRT(rdt, dt);
    const g = this.game, t = performance.now() / 1000;
    this.stateT += rdt;
    const b = this.boss;
    // bosses: active one takes input when it's a human aiming; all get physics (falls, knockback)
    for (const bb of this.bosses) {
      if (bb.knockT > 0) bb.knockT -= dt;
      const active = bb === b && this.state === 'aim' && !this.isAI() && !bb.ko && !this.aerial;
      g.player = bb;
      g.updatePlayer(dt, bb, active ? g.input : this.zeroInput, false);
      bb.update(dt, t);
    }
    g.player = b;
    if (!this.isAI()) { g.input.lookDX = 0; g.input.lookDY = 0; }
    // weapons of the active boss
    for (const w of b.weapons) if (w.equipped) w.update(dt);
    this.watchdog(rdt);
    this.crew.update(dt, rdt);
    // state machine
    switch (this.state) {
      case 'intro':
        if (this.stateT > 2.4) this.setState('transition');
        break;
      case 'transition':
        if (this.stateT > 1.1) this.startTurn();
        break;
      case 'skip':
        if (this.stateT > 2) this.endTurn();
        break;
      case 'aim':
        if (!this.isAI()) {
          this.timer -= rdt;
          if (this.timer <= 0) { g.toast('TEMPO ESGOTADO'); this.passTurn(); }
        } else this.updateAI(rdt);
        break;
      case 'flight': {
        this.lastFireT += rdt;
        const live = g.projectiles.some(p => !p.dead && p.owner === b && !p.rolling);
        const bc = this.bulletCam && this.bulletCam.t < 1;
        if (!live && !bc && this.lastFireT > 0.9) {
          if (this.impact && this.impact.t < 0.2) this.setState('impact');
          else if (this.stateT > 1.2) this.setState('settle');
        }
        if (this.stateT > 12) this.setState('settle');
        break;
      }
      case 'impact':
        if (this.stateT > 2.6) this.setState('settle');
        break;
      case 'settle': {
        const moving = g.physics.bodies.some(x => x.kind === 'chunk' && !x.sleeping && x.vel.lengthSq() > 2);
        const bossMoving = this.bosses.some(x => !x.onGround || x.knockT > 0);
        if ((!moving && !bossMoving && this.stateT > 0.6) || this.stateT > 4) this.endTurn();
        break;
      }
    }
    if (this.impact) this.impact.t += rdt;
    if (this.bulletCam) this.bulletCam.t += rdt / 0.7;
    this.updateCamera(rdt);
    this.updateTrajectory();
    this.updateHUD();
  }

  updateRT(rdt, dt) {
    const g = this.game, t = performance.now() / 1000;
    this.stateT += rdt;
    const me = this.bosses[this.me];
    if (this.state === 'intro' && this.stateT > 2.4) { this.setState('live'); g.toast('VALENDO! CADA UM POR SI'); }
    const live = this.state === 'live';
    if (live) this.liveT += rdt;
    for (const bb of this.bosses) {
      if (bb.knockT > 0) bb.knockT -= dt;
      if (bb.stunT > 0) bb.stunT = Math.max(0, bb.stunT - rdt);
      const control = bb === me && live && !bb.ko && !bb.out && !(bb.stunT > 0) && !this.aerial;
      g.player = bb;
      g.updatePlayer(dt, bb, control ? g.input : this.zeroInput, false);
      bb.update(dt, t);
    }
    g.player = me;
    g.input.lookDX = 0; g.input.lookDY = 0;
    // every boss's weapon keeps running (reloads, automatic fire), each in its own context
    for (const bb of this.bosses) this.withCtx(bb, () => { for (const w of bb.weapons) if (w.equipped) w.update(dt); });
    if ((me.stunT > 0 || me.ko || me.out) && g.weapons[g.wi].isDown) g.weapons[g.wi].up();
    this.watchdog(rdt);
    this.crew.update(dt, rdt);
    if (live) {
      for (const bb of this.bosses) if (bb !== me && !bb.ko && !bb.out) this.withCtx(bb, () => { this.watchdog(rdt); this.updateAIRT(bb, rdt); });
      this.windT -= rdt;
      if (this.windT <= 0) { this.windT = 25; this.newWind(); g.toast('O VENTO MUDOU'); }
      this._winT = (this._winT || 0) + rdt;
      if (this._winT > 0.3) { this._winT = 0; this.checkWin(); }
    }
    this.updateCamera(rdt);
    this.updateTrajectory();
    this.updateHUD();
  }

  // ---------- cameras ----------
  shoulderCam(b, outPos, outLook) {
    const piv = b.pivot;
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(piv.matrixWorld);
    const head = b.headPos();
    // aim point: where the straight line from the head meets the world (crosshair = that point)
    const g = this.game;
    let T = 70;
    const wh = g.world.raycast(head.clone().addScaledVector(dir, 0.6), dir, 70);
    if (wh) T = Math.max(9, wh.t + 0.6);
    const th = g.terrain.raycast(head.clone().addScaledVector(dir, 0.6), dir, 70);
    if (th) T = Math.min(T, Math.max(9, th.t + 0.6));
    outLook.copy(head).addScaledVector(dir, T);
    // camera over the right shoulder, built in the yaw frame so pitching doesn't drop it into the roof
    const right = new THREE.Vector3(Math.cos(b.yaw), 0, -Math.sin(b.yaw));
    const back = new THREE.Vector3(Math.sin(b.yaw), 0, Math.cos(b.yaw));
    const want = head.clone().addScaledVector(right, 1.15).addScaledVector(back, 3.1);
    want.y += 0.75 - b.pitch * 1.3;
    const to = want.clone().sub(head); const tl = to.length(); to.divideScalar(tl);
    const hb = g.world.raycast(head, to, tl);
    if (hb) { outPos.copy(head).addScaledVector(to, Math.max(0.5, hb.t - 0.3)); outPos.y += 0.9; }
    else outPos.copy(want);
    const fl = g.physics.floorAt(outPos.x, outPos.z) + 0.4;
    if (outPos.y < fl) outPos.y = fl;
  }

  updateCamera(rdt) {
    const g = this.game, cam = g.camera, b = this.boss;
    const wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
    let rate = 7, fov = 62;
    const st = this.state;
    if (st === 'intro') {
      const k = this.stateT / 2.4;
      wantPos.set(28 - k * 10, 15 - k * 3, 6 - k * 4); wantLook.set(...this.layout.introLook); rate = 3;
    } else if (st === 'over') {
      const loser = this.focusOver || this.bosses.find(x => x.ko) || this.bosses[0];
      const a = this.stateT * 0.3;
      wantLook.copy(loser.pos).add(new THREE.Vector3(0, 1, 0));
      wantPos.copy(wantLook).add(new THREE.Vector3(Math.sin(a) * 8, 4, Math.cos(a) * 8)); rate = 2;
    } else if (this.aerial) {
      // aerial view: the whole yard from above, to give orders to the henchmen
      // frame all the forts, leaving room for the HUD at the top and bottom
      const F = this.layout.forts;
      const x0 = Math.min(...F.map(f => f.x0)) - 3, x1 = Math.max(...F.map(f => f.x1)) + 3, z0 = Math.min(...F.map(f => f.z0)) - 3, z1 = Math.max(...F.map(f => f.z1)) + 3;
      fov = 55;
      const tv = Math.tan(fov / 2 * Math.PI / 180), asp = cam.aspect || 2;
      const h = Math.max((z1 - z0) / (2 * tv) * 1.3, (x1 - x0) / (2 * tv * asp) * 1.15);
      wantLook.set((x0 + x1) / 2, 0, (z0 + z1) / 2); wantPos.set((x0 + x1) / 2, h, (z0 + z1) / 2 + h * 0.08); rate = 5;
    } else if ((st === 'flight' || st === 'impact') && this.bulletCam && this.bulletCam.t < 1.6) {
      const bc = this.bulletCam, k = Math.min(1, bc.t);
      const p = bc.from.clone().lerp(bc.to, k * k);
      const d = bc.to.clone().sub(bc.from).normalize();
      wantPos.copy(p).addScaledVector(d, -1.6).add(new THREE.Vector3(0, 0.35, 0));
      wantLook.copy(p).addScaledVector(d, 3); rate = 30; fov = 55;
      if (k < 1) g.targetScale = 0.35, g.slowmoT = 0.3;
      if (k >= 1 && !this.impact) this.onImpact(bc.to);
    } else if (st === 'flight' && this.followP && !this.followP.dead) {
      const p = this.followP;
      const v = p.vel.clone(); const sp = v.length() || 1; v.divideScalar(sp);
      v.y *= 0.5; v.normalize();
      wantPos.copy(p.pos).addScaledVector(v, -4.5).add(new THREE.Vector3(0, 1.4, 0));
      wantLook.copy(p.pos).addScaledVector(v, 2.5); rate = 9;
    } else if ((st === 'flight' || st === 'impact' || st === 'settle') && this.impact) {
      const c = this.impact.pos;
      if (!this.impact.ang) { const d = cam.position.clone().sub(c); this.impact.ang = Math.atan2(d.x, d.z); }
      const a = this.impact.ang + this.impact.t * 0.22;
      wantLook.copy(c).add(new THREE.Vector3(0, 1.5, 0));
      wantPos.copy(c).add(new THREE.Vector3(Math.sin(a) * 13, 6.5, Math.cos(a) * 13)); rate = 3.5;
    } else if ((st === 'aim' || st === 'live') && g.zoomed) {
      wantPos.copy(b.headPos()).addScaledVector(new THREE.Vector3(0, 0, -1).transformDirection(b.pivot.matrixWorld), 0.35);
      wantLook.copy(wantPos).addScaledVector(new THREE.Vector3(0, 0, -1).transformDirection(b.pivot.matrixWorld), 10);
      rate = 40; fov = g.weapons[g.wi].id === 'rifle50' ? 14 : 34;
    } else if ((st === 'aim' || st === 'live') && g.firstPerson && !(st === 'aim' && this.isAI()) && !b.ko && !b.out) {
      // first person: eyes at the boss's head, looking where the gun points (the gun is seen like in the Laboratório)
      const fwd = new THREE.Vector3(0, 0, -1).transformDirection(b.pivot.matrixWorld);
      wantPos.copy(b.headPos()).addScaledVector(fwd, 0.06);
      wantLook.copy(wantPos).addScaledVector(fwd, 10);
      rate = 40; fov = 70;
    } else {
      this.shoulderCam(b, wantPos, wantLook);
      rate = st === 'transition' || st === 'skip' ? 3.2 : 16;
      if (b.ko || b.out) { const a = this.stateT * 0.2; wantLook.copy(b.pos); wantPos.copy(b.pos).add(new THREE.Vector3(Math.sin(a) * 7, 4, Math.cos(a) * 7)); rate = 3; }
    }
    // keep orbit/fly-by cameras inside the yard, away from the city blocks around it
    if (st !== 'aim' && st !== 'live') { wantPos.x = Math.max(-23, Math.min(23, wantPos.x)); wantPos.z = Math.max(-27, Math.min(24, wantPos.z)); }
    const k = 1 - Math.exp(-rate * rdt);
    this.camPos.lerp(wantPos, k); this.camLook.lerp(wantLook, k);
    cam.position.copy(this.camPos);
    // shake
    const sh = g.trauma * g.trauma, tt = performance.now() / 1000;
    cam.position.x += Math.sin(tt * 47) * 0.12 * sh; cam.position.y += Math.sin(tt * 53 + 3) * 0.12 * sh;
    g.trauma = Math.max(0, g.trauma - rdt * 1.4);
    cam.lookAt(this.camLook);
    g.fovKick *= Math.exp(-rdt * 6);
    cam.fov += (fov + g.fovKick - cam.fov) * Math.min(1, rdt * 10);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    g.audio.setListener(cam.position, cam.getWorldDirection(new THREE.Vector3()));
    // hide the boss + gun when looking through the scope
    const scoped = (st === 'aim' || st === 'live') && g.zoomed;
    b.model.visible = !scoped && cam.position.distanceTo(b.headPos()) > 1.3;
    for (const w of b.weapons) if (w.equipped) w.model.visible = !scoped || !!w.anim;
    $('cross').style.display = !this.aerial && ((st === 'aim' && !this.isAI()) || (st === 'live' && !b.ko && !b.out)) ? 'block' : 'none';
    if (this.aerial) b.model.visible = true;
  }

  updateTrajectory() {
    const g = this.game, b = this.boss, pts = this.trajPts;
    const w = g.weapons[g.wi];
    const aiming = this.realtime ? this.state === 'live' && !b.ko && !b.out : this.state === 'aim' && !(this.isAI() && this.diff !== 'facil');
    const spec = aiming && !this.aerial && w.preview ? w.preview() : null;
    if (!spec) { pts.visible = false; return; }
    const pos = pts.geometry.attributes.position, n = pos.count;
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(b.pivot.matrixWorld);
    const p = spec.off ? new THREE.Vector3(...spec.off).applyMatrix4(b.pivot.matrixWorld) : w.muzzleWorld();
    const v = dir.multiplyScalar(spec.speed); v.y += spec.up;
    let k = 0;
    const h = 0.035;
    for (let s = 0; s < 400 && k < n; s++) {
      v.y += spec.grav * h; v.addScaledVector(g.wind, spec.wind * h);
      p.addScaledVector(v, h);
      if (s % 3 === 0) { pos.setXYZ(k++, p.x, p.y, p.z); }
      if (p.y < g.terrain.heightAt(p.x, p.z) || (s > 8 && g.world.matAt(p.x, p.y, p.z))) break;
    }
    for (let i = k; i < n; i++) pos.setXYZ(i, p.x, p.y, p.z);
    pos.needsUpdate = true;
    pts.geometry.setDrawRange(0, k);
    pts.visible = true;
  }

  // ---------- HUD ----------
  updateHUD(force) {
    const now = performance.now();
    if (!force && now - (this._hudT || 0) < 120) return;
    this._hudT = now;
    const g = this.game;
    const b = this.realtime ? this.bosses[this.me] : this.boss, w = g.world;
    const el = $('turn');
    el.style.borderColor = b.T.css;
    const tm = $('turn-timer');
    if (this.realtime) {
      $('turn-team').textContent = 'AO VIVO · CADA UM POR SI';
      $('turn-round').textContent = `Vento muda em ${Math.ceil(this.windT)} s`;
      tm.textContent = b.stunT > 0 ? Math.ceil(b.stunT) : '·';
    } else {
      $('turn-team').textContent = this.isAI() ? `${b.T.name.toUpperCase()} · COMPUTADOR` : `VEZ DOS ${b.T.name.toUpperCase()}`;
      $('turn-round').textContent = `Rodada ${this.round}`;
      tm.textContent = this.state === 'aim' && !this.isAI() ? Math.ceil(Math.max(0, this.timer)) : '·';
    }
    $('turn-team').style.color = b.T.css;
    $('turn-boss').textContent = b.T.boss;
    tm.style.borderColor = b.T.css;
    for (const bb of this.bosses) {
      const t = bb.team;
      $(`hp${t}`).style.width = Math.max(0, bb.hp) + '%';
      $(`hpn${t}`).textContent = bb.ko ? 'NOCAUTE' : bb.out ? 'FORA' : (bb.dizzy || bb.stunT > 0 ? 'TONTO · ' : '') + Math.round(bb.hp);
      $(`fort${t}`).textContent = `Forte ${Math.round(this.fortPct(t) * 100)}%`;
    }
    // wind relative to the view of the boss on screen
    const right = new THREE.Vector3(Math.cos(b.yaw), 0, -Math.sin(b.yaw));
    const side = g.wind.dot(right);
    const kmh = Math.round(g.wind.length() * 3.6);
    const arrows = kmh === 0 ? '—' : side > 0 ? '▶'.repeat(1 + Math.min(2, Math.floor(kmh / 9))) : '◀'.repeat(1 + Math.min(2, Math.floor(kmh / 9)));
    $('wind-a').textContent = arrows; $('wind-v').textContent = `${kmh} km/h`;
    const gw = b.weapons[b.wi];
    const st = b.stock[gw.id];
    let info = '';
    if (this.realtime) {
      if (this.state === 'live') {
        if (b.ko || b.out) info = 'Você está fora. Assistindo…';
        else if (b.stunT > 0) info = `TONTO! Volta em ${Math.ceil(b.stunT)} s`;
        else if (st !== Infinity) info = `Munição pesada: ${st}`;
      }
    } else if (this.state === 'aim') {
      if (this.firedAny) info = `Tiros restantes neste turno: ${Math.max(0, this.turnShots)}`;
      else info = `${RULES[gw.id].shots} tiro${RULES[gw.id].shots > 1 ? 's' : ''} por turno · estoque ${st === Infinity ? '∞' : st}`;
    } else if (this.state === 'flight' || this.state === 'impact' || this.state === 'settle') info = 'Vendo o estrago…';
    $('turninfo').textContent = info;
    $('turninfo').style.display = info ? 'block' : 'none';
    $('pass').style.display = !this.realtime && this.state === 'aim' && !this.isAI() ? 'flex' : 'none';
    // arsenal stock badges
    document.querySelectorAll('.wcard').forEach((c, i) => {
      if (!b.weapons[i]) return;
      const id = b.weapons[i].id, s = b.stock[id];
      const sp = c.querySelector('.stock');
      if (sp) sp.textContent = this.realtime ? (s === Infinity ? '∞' : `x${s}`) : s === Infinity ? `${RULES[id].shots}/turno` : `x${s} · ${RULES[id].shots}/turno`;
      c.classList.toggle('empty', s <= 0);
    });
  }
}
