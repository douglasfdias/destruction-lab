// Phase 3: henchmen (capangas), crates from the sky, traps, repairs and barricades, plus the aerial-view orders.
// Lives inside a Duel. Capangas keep working in real time in every duel mode (also while turns change).
import * as THREE from '../lib/three.module.min.js';
import { MAT, worldToCell, VOX, NX, NZ, OX, OZ } from './world.js';

const R = (a, b) => a + Math.random() * (b - a);
const $ = id => document.getElementById(id);
const NAMES = [['Tião', 'Zeca', 'Nando'], ['Bira', 'Cido', 'Duda'], ['Lalo', 'Juca', 'Pipo']];
const MAX_CREW = 3, CAP_HP = 40, DOWN_TIME = 12;
const CONTENT = [
  { id: 'arma', w: 0 }, { id: 'municao', w: 30 }, { id: 'kit', w: 30 }, { id: 'armadilhas', w: 30 }, { id: 'capanga', w: 10 },
];
const WNAME = { pistola: 'PISTOLA', smg: 'SUBMETRALHADORA', shotgun: 'SHOTGUN 12', rifle50: 'RIFLE .50', granada: 'GRANADA', canhao: 'CANHÃO', rpg: 'LANÇA-FOGUETES', rifle50s: 'TIRO DE .50' };
const WORDER = ['pistola', 'smg', 'shotgun', 'granada', 'rifle50', 'canhao', 'rpg'];
const ORDERS = [
  { id: 'fetch', label: 'Buscar caixa', sub: 'corre até ela e volta' },
  { id: 'repair', label: 'Reparar', sub: 'tapa buracos · 1 kit', cost: 'kit' },
  { id: 'barricade', label: 'Barricada', sub: 'onde você mirar · 1 kit', cost: 'kit', place: true },
  { id: 'mina', label: 'Mina', sub: 'explode quem pisar', cost: 'mina', place: true },
  { id: 'mola', label: 'Mola', sub: 'joga pro alto', cost: 'mola', place: true },
  { id: 'banana', label: 'Banana', sub: 'escorrega e fica tonto', cost: 'banana', place: true },
  { id: 'home', label: 'Voltar', sub: 'pro forte, e pegar caixas sozinho' },
];
// small stroke icons (24x24) used for the henchmen's actions and orders
export const ICON = {
  fetch: '<path d="M4 8h16v12H4zM4 12h16M12 8v12"/>',
  repair: '<path d="M4 20l9-9M12 4l8 8-4 1-5-5z"/>',
  barricade: '<path d="M3 9h18v10H3zM3 14h18M9 9v5M15 14v5"/>',
  mina: '<ellipse cx="12" cy="15" rx="8" ry="3"/><path d="M12 12V8M10 6h4"/>',
  mola: '<path d="M6 20l12-2-12-3 12-3-12-3 12-3"/>',
  banana: '<path d="M4 8c3 9 13 10 16 2-5 4-11 3-16-2z"/>',
  home: '<path d="M3 11l9-7 9 7M6 10v10h12V10"/>',
  grab: '<path d="M4 9h16v11H4zM4 13h16M12 9v11M9 5l3-3 3 3"/>',
  drop: '<path d="M4 9h16v11H4zM4 13h16M12 9v11M9 2l3 3 3-3"/>',
  boss: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/>',
};
export const svgIcon = (k, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
const STATE_TXT = { idle: 'esperando', fetch: 'indo pegar a caixa', carry: 'trazendo a caixa', repair: 'indo reparar', barricade: 'indo erguer barricada', mina: 'indo armar mina', mola: 'indo armar mola', banana: 'indo pôr banana', move: 'indo pro lugar', home: 'voltando pro forte', work: 'trabalhando' };

function mat(color, o = {}) { return new THREE.MeshStandardMaterial({ color, roughness: o.r != null ? o.r : 0.7, metalness: o.m || 0, emissive: o.e || 0 }); }
function bx(w, h, d, m, x, y, z) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; return b; }
const faceOf = f => f.face === -1 ? '-z' : f.face === 1 ? '+z' : f.face;
const FACE_DIR = { '-z': [0, -1], '+z': [0, 1], '+x': [1, 0], '-x': [-1, 0] };

class Capanga {
  constructor(crew, team, idx) {
    this.crew = crew; this.team = team; this.idx = idx; this.crewMember = true;
    const T = crew.duel.bosses[team].T;
    this.T = T; this.name = NAMES[team][idx % 3];
    this.pos = crew.homePoint(team, idx).clone(); this.vel = new THREE.Vector3();
    this.yaw = crew.homeYaw(team); this.hp = CAP_HP; this.ko = false; this.downT = 0;
    this.stunT = 0; this.knockT = 0; this.onGround = true; this.task = null; this.state = 'idle'; this.auto = !!crew.duel.realtime;
    this.pitch = 0; this.bob = 0; this.bobAmp = 0; this.stepT = 0; this.driven = false;
    this.workT = 0; this.stuckT = 0; this.lastPos = this.pos.clone(); this.side = Math.random() < 0.5 ? 1 : -1; this.walk = 0;
    this.build(T);
  }
  build(T) {
    const g = this.model = new THREE.Group();
    const s = 0.62;
    const pants = mat(0x2d3a4f), vest = mat(T.vest, { r: 0.6 }), skin = mat(0xe0ac85), dark = mat(0x1a1a1a), hel = mat(0xffc531, { r: 0.4 });
    this.legs = [bx(0.17 * s, 0.78 * s, 0.2 * s, pants, -0.12 * s, 0.39 * s, 0), bx(0.17 * s, 0.78 * s, 0.2 * s, pants, 0.12 * s, 0.39 * s, 0)];
    g.add(...this.legs);
    g.add(bx(0.5 * s, 0.6 * s, 0.3 * s, vest, 0, 1.06 * s, 0));
    g.add(bx(0.51 * s, 0.06 * s, 0.31 * s, mat(0xf2f2f2), 0, 1.06 * s, 0));
    this.arms = [bx(0.15 * s, 0.5 * s, 0.15 * s, vest, -0.33 * s, 1.1 * s, 0), bx(0.15 * s, 0.5 * s, 0.15 * s, vest, 0.33 * s, 1.1 * s, 0)];
    g.add(...this.arms);
    const head = bx(0.36 * s, 0.36 * s, 0.34 * s, skin, 0, 1.55 * s, 0); g.add(head);
    g.add(bx(0.06 * s, 0.07 * s, 0.02 * s, dark, -0.08 * s, 1.58 * s, -0.18 * s), bx(0.06 * s, 0.07 * s, 0.02 * s, dark, 0.08 * s, 1.58 * s, -0.18 * s));
    g.add(bx(0.42 * s, 0.12 * s, 0.4 * s, hel, 0, 1.78 * s, 0));
    // ring on the ground: shows whose henchman it is (bright for the team on this phone)
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.44, 24), new THREE.MeshBasicMaterial({ color: T.vest, transparent: true, opacity: 0.8, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.04; g.add(this.ring);
    this.stars = new THREE.Group();
    const sm = new THREE.MeshBasicMaterial({ color: 0xffe14a });
    for (let i = 0; i < 3; i++) { const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.05, 0), sm); st.userData.a = i / 3 * Math.PI * 2; this.stars.add(st); }
    this.stars.position.y = 1.35; g.add(this.stars);
    this.crew.scene.add(g);
  }
  chest() { return new THREE.Vector3(this.pos.x, this.pos.y + 0.65, this.pos.z); }
  headPos() { return new THREE.Vector3(this.pos.x, this.pos.y + 0.98, this.pos.z); }
  busy() { return !!this.task && this.task.type !== 'home'; }
  setTask(task) {
    if (this.carrying) this.crew.dropCrate(this);
    if (this.task && this.task.crate && this.task.crate.claimed[this.team] === this) this.task.crate.claimed[this.team] = null;
    this.task = task; this.state = task ? task.type : 'idle'; this.workT = 0; this.stuckT = 0;
    if (task && task.crate) task.crate.claimed[this.team] = this;
  }
  dispose() { this.crew.scene.remove(this.model); }
}

export class Crew {
  constructor(duel) {
    this.duel = duel; this.game = duel.game; this.scene = duel.game.scene;
    this.layout = duel.layout; this.n = duel.n;
    this.center = new THREE.Vector3(...(this.layout.center || [0, 0, 0]));
    this.caps = []; this.crates = []; this.traps = [];
    this.stock = []; for (let t = 0; t < this.n; t++) this.stock.push({ kit: 1, mina: 1, mola: 1, banana: 2 });
    this.crateT = duel.unlockMode ? 20 : 30; this.aiT = 0; this.selected = null; this.pending = null; this.aerial = false; this._uiT = 0;
    this.recordForts();
    for (let t = 0; t < this.n; t++) for (let i = 0; i < 2; i++) this.caps.push(new Capanga(this, t, i));
    this.mats = { crate: mat(0xb88a52), crateEdge: mat(0x7d5a30), chute: [mat(0xff8a2a, { r: 0.8 }), mat(0xffffff, { r: 0.8 })] };
    this.buildUI();
  }

  dispose() {
    for (const c of this.caps) c.dispose();
    for (const k of this.crates) this.removeCrate(k);
    for (const t of this.traps) this.scene.remove(t.mesh);
    this.caps.length = 0; this.traps.length = 0;
    this.setAerial(false);
    $('crewbar').innerHTML = ''; $('crewrow').style.display = 'none';
    $('orders').style.display = 'none'; $('aerialhint').style.display = 'none';
  }

  // ---------- geometry of the arena ----------
  fort(t) { return this.layout.forts[t]; }
  frontPoint(t) {
    const f = this.fort(t), face = faceOf(f), cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2;
    return face === '-z' ? new THREE.Vector3(cx, 0, f.z0) : face === '+z' ? new THREE.Vector3(cx, 0, f.z1) : face === '+x' ? new THREE.Vector3(f.x1, 0, cz) : new THREE.Vector3(f.x0, 0, cz);
  }
  faceDir(t) { const d = FACE_DIR[faceOf(this.fort(t))]; return new THREE.Vector3(d[0], 0, d[1]); }
  // fort-local coordinates (cells): a across the front, left to right as seen from inside looking out; b = depth from the front
  fortDims(t) {
    const f = this.fort(t), w = this.game.world, face = faceOf(f);
    const I0 = w.ci(f.x0), I1 = w.ci(f.x1) - 1, K0 = w.ck(f.z0), K1 = w.ck(f.z1) - 1;
    const alongX = face === '-z' || face === '+z';
    return { face, I0, I1, K0, K1, W: alongX ? I1 - I0 + 1 : K1 - K0 + 1, D: alongX ? K1 - K0 + 1 : I1 - I0 + 1 };
  }
  local(t, a, b) {
    const F = this.fortDims(t);
    const [i, k] = { '-z': [F.I0 + a, F.K0 + b], '+z': [F.I1 - a, F.K1 - b], '+x': [F.I1 - b, F.K0 + a], '-x': [F.I0 + b, F.K1 - a] }[F.face];
    const p = new THREE.Vector3(OX + (i + 0.5) * VOX, 0, OZ + (k + 0.5) * VOX);
    p.y = this.ground(p.x, p.z, 1.2);
    return p;
  }
  toLocal(t, p) {
    const F = this.fortDims(t), i = (p.x - OX) / VOX - 0.5, k = (p.z - OZ) / VOX - 0.5;
    return { '-z': { a: i - F.I0, b: k - F.K0 }, '+z': { a: F.I1 - i, b: F.K1 - k }, '+x': { a: k - F.K0, b: F.I1 - i }, '-x': { a: F.K1 - k, b: i - F.I0 } }[F.face];
  }
  // home = inside, on the ground floor, one at each end (one rocket doesn't get them both)
  homePoint(t, i = 0) {
    const F = this.fortDims(t);
    const spots = [[3, F.D >> 1], [F.W - 4, F.D >> 1], [8, F.D - 3]];
    const [a, b] = spots[i % 3];
    return this.local(t, a, b);
  }
  inOwn(t, p) { const f = this.fort(t); return p.x > f.x0 && p.x < f.x1 && p.z > f.z0 && p.z < f.z1; }
  // waypoints between the inside of the fort and the yard, through the back door and around the corner
  route(c, target) {
    const t = c.team, F = this.fortDims(t), fromIn = this.inOwn(t, c.pos), toIn = this.inOwn(t, target);
    if (fromIn === toIn) return [];
    const L = this.toLocal(t, fromIn ? target : c.pos);
    const sa = L.a < F.W / 2 ? -3.5 : F.W + 2.5, front = L.b < F.D / 2;
    const inDoor = this.local(t, 5.5, F.D - 2.2), outDoor = this.local(t, 5.5, F.D + 2.6);
    const back = this.local(t, sa, F.D + 2.6), frontC = this.local(t, sa, -3);
    return fromIn ? [inDoor, outDoor, back, ...(front ? [frontC] : [])] : [...(front ? [frontC] : []), back, outDoor, inDoor];
  }
  homeYaw(t) { const d = this.faceDir(t); return Math.atan2(-d.x, -d.z); }
  ground(x, z, y = 3) { return this.game.groundUnder(x, y, z); }
  inFort(x, z, m = 0) { return this.layout.forts.some(f => x > f.x0 - m && x < f.x1 + m && z > f.z0 - m && z < f.z1 + m); }
  clampYard(p) { p.x = Math.max(-22, Math.min(22, p.x)); p.z = Math.max(-24, Math.min(21.5, p.z)); return p; }
  solidAt(x, y, z) {
    for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) for (const dy of [0.3, 0.85]) {
      const c = worldToCell(x + dx, y + dy, z + dz);
      if (c >= 0 && this.game.world.mat[c]) return true;
    }
    return false;
  }

  // remember every block of each fort so a henchman can rebuild what was blown away
  recordForts() {
    const w = this.game.world;
    this.fortCells = [];
    for (let t = 0; t < this.n; t++) this.fortCells.push([]);
    for (let c = 0; c < w.mat.length; c++) {
      const f = w.flags[c];
      if (!w.mat[c] || !(f & 14)) continue;
      for (let t = 0; t < this.n; t++) if (f & (2 << t)) this.fortCells[t].push({ c, m: w.mat[c], tint: w.tint[c], f });
    }
  }

  // ---------- the team on this phone ----------
  myTeam() {
    const d = this.duel;
    if (d.realtime) return d.me;
    if (d.state === 'over') return -1;
    return d.seats[d.turn] === 'human' ? d.turn : -1;
  }
  isCPU(t) { return this.duel.seats[t] === 'cpu'; }
  teamCaps(t) { return this.caps.filter(c => c.team === t); }
  teamOut(t) { return this.duel.eliminated(t); }

  // ---------- per frame ----------
  update(dt, rdt) {
    const g = this.game;
    if (this.duel.state === 'intro' || this.duel.state === 'over') { this.updateVisuals(rdt); return; }
    // crates from the sky
    this.crateT -= dt;
    if (this.crateT <= 0) { this.crateT = this.duel.unlockMode ? R(32, 44) : R(40, 55); if (this.crates.filter(k => k.state !== 'gone').length < 2) this.spawnCrate(); }
    for (const k of this.crates) this.updateCrate(k, dt);
    this.crates = this.crates.filter(k => k.state !== 'gone');
    // computer-run teams decide what their henchmen do
    this.aiT -= dt;
    if (this.aiT <= 0) { this.aiT = 1.2; if (this.duel.realtime) for (let t = 0; t < this.n; t++) if (this.isCPU(t) && !this.teamOut(t)) this.thinkAI(t); }
    this.autoFetch();
    for (const c of this.caps) this.updateCap(c, dt);
    for (const tr of this.traps) this.updateTrap(tr, dt);
    this.traps = this.traps.filter(tr => !tr.gone);
    this.updateVisuals(rdt);
    this._uiT -= rdt;
    if (this._uiT <= 0) { this._uiT = 0.25; this.updateUI(); }
  }

  // idle henchmen run for crates on their own: one per team per crate, the closest one
  autoFetch() {
    if (!this.duel.realtime) return; // by turns nobody runs for a crate on his own
    for (const k of this.crates) {
      if (k.state === 'carried' || k.state === 'gone') continue;
      for (let t = 0; t < this.n; t++) {
        if (k.claimed[t] || this.teamOut(t)) continue;
        let best = null, bd = 1e9;
        for (const c of this.caps) {
          if (c.team !== t || c.ko || c.busy() || (!c.auto && c.task && c.task.type !== 'home')) continue;
          if (c.task && c.task.type === 'move') continue;
          const d = c.pos.distanceTo(k.landing);
          if (d < bd) { bd = d; best = c; }
        }
        if (best) best.setTask({ type: 'fetch', crate: k });
      }
    }
  }

  // by turns: at the start of the computer's turn, maybe send a henchman (crate, repair, a trap) before shooting
  aiTurn(t) {
    const st = this.stock[t], caps = this.teamCaps(t).filter(c => !c.ko);
    if (!caps.length) return false;
    if (caps.some(c => c.task && (c.task.type === 'carry' || c.task.type === 'fetch'))) return true;
    if (this.duel.fortPct(t) > 0.08 && st.kit > 0) { const c = caps[0]; c.setTask({ type: 'repair', target: this.homePoint(t, c.idx) }); return true; }
    const k = this.crates.find(k => k.state === 'ground' || (k.state === 'fall' && k.pos.y - k.landing.y < 10));
    if (k) {
      let best = null, bd = 1e9;
      for (const c of caps) { const dd = c.pos.distanceTo(k.landing); if (dd < bd) { bd = dd; best = c; } }
      if (best && bd < 30) { best.setTask({ type: 'fetch', crate: k }); return true; }
    }
    const traps = ['mina', 'mola', 'banana'].filter(x => st[x] > 0);
    if (traps.length && Math.random() < 0.3) {
      const p = this.center.clone().add(new THREE.Vector3(R(-6, 6), 0, R(-5, 5)));
      if (!this.inFort(p.x, p.z, 1.5)) { caps[(Math.random() * caps.length) | 0].setTask({ type: traps[(Math.random() * traps.length) | 0], target: this.clampYard(p) }); return true; }
    }
    return false;
  }
  aiTurnDone(t) { return !this.teamCaps(t).some(c => !c.ko && c.task && c.task.type !== 'home'); }

  thinkAI(t) {
    const st = this.stock[t], caps = this.teamCaps(t).filter(c => !c.ko);
    const idle = caps.filter(c => !c.busy());
    if (!idle.length) return;
    const dmg = this.duel.fortPct(t);
    if (dmg > 0.05 && st.kit > 0 && !caps.some(c => c.task && c.task.type === 'repair')) { idle[0].setTask({ type: 'repair', target: this.homePoint(t, idle[0].idx) }); return; }
    const c = idle[(Math.random() * idle.length) | 0];
    const traps = ['mina', 'mola', 'banana'].filter(k => st[k] > 0);
    // traps now and then, not all at once (more likely when a crate is coming down)
    const falling0 = this.crates.some(k => k.state === 'fall');
    if (traps.length && this.duel.liveTime() > 12 && Math.random() < (falling0 ? 0.22 : 0.06)) {
      const falling = this.crates.find(k => k.state === 'fall');
      let p;
      if (falling && Math.random() < 0.5) p = falling.landing.clone().add(new THREE.Vector3(R(-1.6, 1.6), 0, R(-1.6, 1.6)));
      else p = this.center.clone().add(new THREE.Vector3(R(-7, 7), 0, R(-6, 6)));
      if (!this.inFort(p.x, p.z, 1.5)) c.setTask({ type: traps[(Math.random() * traps.length) | 0], target: this.clampYard(p) });
      return;
    }
    if (st.kit >= 2 && Math.random() < 0.15) {
      const d = this.faceDir(t), side = new THREE.Vector3(-d.z, 0, d.x);
      const p = this.frontPoint(t).addScaledVector(d, R(4.5, 6.5)).addScaledVector(side, R(-3, 3));
      if (!this.inFort(p.x, p.z, 1.5)) c.setTask({ type: 'barricade', target: this.clampYard(p) });
    }
  }

  // ---------- henchmen ----------
  updateCap(c, dt) {
    const g = this.game;
    if (c.ko) {
      c.downT -= dt;
      if (c.downT <= 0) { c.ko = false; c.hp = CAP_HP; c.pos.copy(this.homePoint(c.team, c.idx)); c.vel.set(0, 0, 0); c.setTask(null); c.auto = !!this.duel.realtime; }
      return;
    }
    if (this.teamOut(c.team) && !c.ko) { c.hp = 0; c.ko = true; c.downT = 1e9; if (c.carrying) this.dropCrate(c); return; }
    if (c.stunT > 0) c.stunT -= dt;
    if (c.knockT > 0) c.knockT -= dt;
    if (c.driven) {
      const busy = c.stunT > 0 || c.workT > 0;
      g.updatePlayer(dt, c, busy ? this.duel.zeroInput : g.input, false);
      if (busy && c.workT > 0) this.driveWork(c, dt);
      if (c.carrying && this.inOwn(c.team, c.pos)) { const k = c.carrying; c.carrying = null; this.removeCrate(k); this.grant(c.team, c); }
      c.walk += dt * Math.hypot(c.vel.x, c.vel.z) * 2.2;
      return;
    }
    // by turns only the team whose turn it is moves; everyone else stays put
    const canAct = this.duel.realtime || (c.team === this.duel.turn && this.duel.state === 'aim');
    // nothing to do and away from the fort: walk back
    if (this.duel.realtime && !c.task && c.auto && c.stunT <= 0 && Math.hypot(c.pos.x - this.homePoint(c.team, c.idx).x, c.pos.z - this.homePoint(c.team, c.idx).z) > 1.5) c.setTask({ type: 'home' });
    let want = null, speed = c.carrying ? 2.7 : 3.4;
    const task = c.task;
    if (task && canAct && c.stunT <= 0 && c.knockT <= 0) {
      let target = task.target;
      if (task.type === 'fetch') {
        const k = task.crate;
        if (!k || k.state === 'gone' || (k.state === 'carried' && k.carrier !== c)) { c.setTask(null); return; }
        target = k.state === 'ground' ? k.pos : k.landing;
      }
      if (task.type === 'carry' || task.type === 'home') target = this.homePoint(c.team, c.idx);
      if (!task.wps) task.wps = this.route(c, target);
      let wp = false;
      if (task.wps.length) { const w0 = task.wps[0]; if (Math.hypot(w0.x - c.pos.x, w0.z - c.pos.z) < 0.7) task.wps.shift(); if (task.wps.length) { target = task.wps[0]; wp = true; } }
      const dx = target.x - c.pos.x, dz = target.z - c.pos.z, dist = Math.hypot(dx, dz);
      const arrive = task.type === 'fetch' ? 0.9 : task.type === 'repair' ? 1.2 : 0.7;
      if (dist > arrive || wp) want = new THREE.Vector3(dx / dist, 0, dz / dist);
      else this.arrive(c, dt);
    }
    // steering around walls and crates of blocks
    if (want) {
      const base = Math.atan2(want.x, want.z);
      let dirOk = null;
      for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, 2.6, -2.6]) {
        const a = base + off * c.side;
        const px = c.pos.x + Math.sin(a) * 0.55, pz = c.pos.z + Math.cos(a) * 0.55;
        if (!this.solidAt(px, c.pos.y + 0.5, pz) || !this.solidAt(px, c.pos.y, pz)) { dirOk = a; break; }
      }
      if (dirOk == null) dirOk = base;
      c.vel.x += (Math.sin(dirOk) * speed - c.vel.x) * Math.min(1, dt * 10);
      c.vel.z += (Math.cos(dirOk) * speed - c.vel.z) * Math.min(1, dt * 10);
      c.yaw = Math.atan2(-Math.sin(dirOk), -Math.cos(dirOk));
      // stuck: hop and try the other way round
      c.stuckT += dt;
      if (c.stuckT > 1.4) {
        if (c.pos.distanceTo(c.lastPos) < 0.5) { c.side *= -1; if (c.onGround) { c.vel.y = 6; c.onGround = false; } }
        c.stuckT = 0; c.lastPos.copy(c.pos);
      }
    } else if (c.onGround) { c.vel.x *= 1 - Math.min(1, dt * 10); c.vel.z *= 1 - Math.min(1, dt * 10); }
    // move with block collisions and 0.5 m step-ups
    const tryAxis = (dx, dz) => {
      const nx = c.pos.x + dx, nz = c.pos.z + dz;
      if (!this.solidAt(nx, c.pos.y, nz)) { c.pos.x = nx; c.pos.z = nz; return; }
      if (c.onGround && !this.solidAt(nx, c.pos.y + 0.55, nz)) { c.pos.x = nx; c.pos.z = nz; c.pos.y += 0.5; }
    };
    tryAxis(c.vel.x * dt, 0); tryAxis(0, c.vel.z * dt);
    this.clampYard(c.pos);
    c.vel.y -= 16 * dt;
    c.pos.y += c.vel.y * dt;
    const gr = this.ground(c.pos.x, c.pos.z, c.pos.y);
    if (c.pos.y <= gr) {
      if (!c.onGround && c.vel.y < -11) this.damageCap(c, Math.min(30, (-c.vel.y - 11) * 4), 'queda');
      c.pos.y = gr; c.vel.y = 0; c.onGround = true;
    } else c.onGround = c.pos.y - gr < 0.05;
    c.walk += dt * Math.hypot(c.vel.x, c.vel.z) * 2.2;
  }

  arrive(c, dt) {
    const task = c.task, st = this.stock[c.team], g = this.game, mine = c.team === this.myTeam();
    c.vel.x *= 0.5; c.vel.z *= 0.5;
    if (task.type === 'fetch') {
      const k = task.crate;
      if (k.state !== 'ground') return; // wait under it
      k.state = 'carried'; k.carrier = c; c.carrying = k;
      for (let t = 0; t < this.n; t++) if (t !== c.team && k.claimed[t]) { const o = k.claimed[t]; k.claimed[t] = null; if (o.task && o.task.crate === k) o.setTask(null); }
      g.audio.play('woodhit', { pos: k.pos, vol: 0.5, rate: 1.3 });
      if (mine) g.toast(`${c.name.toUpperCase()} PEGOU A CAIXA!`);
      c.task = { type: 'carry', crate: k }; c.state = 'carry'; // route home is planned on the next step
      return;
    }
    if (task.type === 'carry') {
      const k = c.carrying; c.carrying = null;
      if (k) { this.removeCrate(k); this.grant(c.team, c); }
      c.setTask(null);
      return;
    }
    if (task.type === 'home' || task.type === 'move') { c.state = 'idle'; if (task.type === 'home') { c.task = null; c.auto = !!this.duel.realtime; } return; }
    // jobs that take a moment of work on the spot
    c.state = 'work'; c.workT += dt;
    c.yaw += Math.sin(c.workT * 18) * 0.02;
    const need = task.type === 'repair' ? 3.5 : task.type === 'barricade' ? 2.8 : 1.2;
    if (Math.floor(c.workT * 3) !== Math.floor((c.workT - dt) * 3)) g.audio.play(task.type === 'repair' || task.type === 'barricade' ? 'stones' : 'click', { pos: c.pos, vol: 0.35, rate: R(0.9, 1.3) });
    if (c.workT < need) return;
    const cost = ORDERS.find(o => o.id === task.type).cost;
    if (cost && st[cost] <= 0) { if (mine) g.toast('ACABOU O ESTOQUE'); c.setTask({ type: 'home' }); return; }
    let ok = true;
    if (task.type === 'repair') ok = this.repairFort(c.team, c.pos);
    else if (task.type === 'barricade') ok = this.buildBarricade(c.team, c.pos);
    else this.placeTrap(task.type, c.team, c.pos);
    if (ok && cost) st[cost]--;
    if (mine) g.toast(task.type === 'repair' ? (ok ? 'FORTE REPARADO!' : 'NADA PRA REPARAR') : task.type === 'barricade' ? 'BARRICADA ERGUIDA!' : task.type === 'mina' ? 'MINA ARMADA' : task.type === 'mola' ? 'MOLA ARMADA' : 'BANANA NO CHÃO');
    // real time: walk back in; by turns: stay where the job was done (moving costs turns)
    c.setTask(this.duel.realtime ? { type: 'home' } : null);
  }

  damageCap(c, dmg, cause, at) {
    if (c.ko || dmg <= 0.3) return;
    const g = this.game;
    c.hp -= dmg;
    g.floaterText(`-${Math.round(dmg)}`, at || c.headPos(), c.T.css);
    if (c.hp <= 0) {
      c.hp = 0; c.ko = true; c.downT = DOWN_TIME;
      if (c.carrying) this.dropCrate(c);
      if (c.task && c.task.crate && c.task.crate.claimed[c.team] === c) c.task.crate.claimed[c.team] = null;
      c.task = null; c.state = 'idle';
      if (c.team === this.myTeam()) g.toast(`${c.name.toUpperCase()} DESMAIOU! VOLTA EM ${DOWN_TIME} s`);
      g.audio.play('hit', { pos: c.chest(), vol: 0.6, rate: 1.3 });
    } else if (dmg >= 12) { c.stunT = Math.max(c.stunT, Math.min(5, 1 + dmg / 10)); if (c.carrying) this.dropCrate(c); }
  }

  // ---------- crates ----------
  spawnCrate() {
    let p = null;
    for (let i = 0; i < 30 && !p; i++) {
      const q = this.center.clone().add(new THREE.Vector3(R(-9, 9), 0, R(-8, 8)));
      if (this.inFort(q.x, q.z, 2.2)) continue;
      const gy = this.ground(q.x, q.z, 3);
      if (gy > 1.2) continue;
      q.y = gy; p = q;
    }
    if (!p) return;
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.7), this.mats.crate); box.castShadow = true; g.add(box);
    for (const [w, h, d] of [[0.74, 0.08, 0.74], [0.08, 0.6, 0.74], [0.74, 0.6, 0.08]]) g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.mats.crateEdge));
    const chute = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const seg = new THREE.Mesh(new THREE.SphereGeometry(1.35, 4, 4, i / 8 * Math.PI * 2, Math.PI * 2 / 8, 0, Math.PI / 2.6), this.mats.chute[i % 2]);
      seg.material.side = THREE.DoubleSide; chute.add(seg);
    }
    chute.position.y = 1.5; g.add(chute);
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([0, 1, 2, 3].flatMap(i => { const a = i / 4 * Math.PI * 2 + 0.4; return [new THREE.Vector3(0, 0.28, 0), new THREE.Vector3(Math.cos(a) * 1.05, 2.2, Math.sin(a) * 1.05)]; })), new THREE.LineBasicMaterial({ color: 0x3a2a1c }));
    g.add(lines);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.05, 32), new THREE.MeshBasicMaterial({ color: 0xffc531, transparent: true, opacity: 0.85, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, p.y + 0.06, p.z);
    this.scene.add(g, ring);
    const k = { crate: true, pos: new THREE.Vector3(p.x, p.y + 24, p.z), vel: new THREE.Vector3(), landing: p.clone(), state: 'fall', mesh: g, chute, lines, ring, hp: 16, claimed: {}, T: { css: '#FFC531' }, ko: false, knockT: 0, onGround: false };
    g.position.copy(k.pos);
    this.crates.push(k);
    this.game.toast('CAIXA DO CÉU!');
    this.game.audio.play('whoosh', { vol: 0.5, rate: 0.6 });
  }
  updateCrate(k, dt) {
    const g = this.game;
    if (k.state === 'fall') {
      k.pos.y -= 2.6 * dt;
      k.pos.x += g.wind.x * 0.05 * dt; k.pos.z += g.wind.z * 0.05 * dt;
      k.landing.x = k.pos.x; k.landing.z = k.pos.z;
      const gy = this.ground(k.pos.x, k.pos.z, k.pos.y);
      k.landing.y = gy;
      k.ring.position.set(k.pos.x, gy + 0.06, k.pos.z);
      k.mesh.rotation.z = Math.sin(performance.now() / 600) * 0.08;
      if (k.pos.y <= gy + 0.28) {
        k.pos.y = gy + 0.28; k.state = 'ground'; k.mesh.rotation.z = 0;
        k.mesh.remove(k.chute); k.mesh.remove(k.lines);
        g.audio.play('woodfall', { pos: k.pos, vol: 0.6 });
        g.fx.dust(k.pos.clone(), [0.55, 0.45, 0.33], { a: 0.4, s1: 1.6 });
      }
    } else if (k.state === 'carried') {
      const c = k.carrier;
      if (!c || c.ko) { k.state = 'ground'; k.carrier = null; }
      else k.pos.set(c.pos.x, c.pos.y + 1.35, c.pos.z);
      k.ring.visible = false;
    } else if (k.state === 'ground') {
      const gy = this.ground(k.pos.x, k.pos.z, k.pos.y + 0.3);
      if (k.pos.y - 0.28 > gy + 0.05) k.pos.y = Math.max(gy + 0.28, k.pos.y - 8 * dt);
      k.ring.visible = true; k.ring.position.set(k.pos.x, gy + 0.06, k.pos.z);
      k.landing.copy(k.pos);
    }
    k.mesh.position.copy(k.pos);
  }
  dropCrate(c) {
    const k = c.carrying; c.carrying = null;
    if (!k) return;
    k.state = 'ground'; k.carrier = null;
    k.claimed[c.team] = null;
  }
  removeCrate(k) { k.state = 'gone'; this.scene.remove(k.mesh); this.scene.remove(k.ring); if (k.carrier) k.carrier.carrying = null; }
  hitCrate(k, dmg) {
    if (k.state === 'gone') return;
    k.hp -= dmg;
    this.game.audio.play('woodhit', { pos: k.pos, vol: 0.5 });
    if (k.hp > 0) return;
    const g = this.game;
    for (let i = 0; i < 8; i++) g.physics.spawnDebris(MAT.WOOD, k.pos.clone().add(new THREE.Vector3(R(-0.3, 0.3), R(-0.2, 0.2), R(-0.3, 0.3))), new THREE.Vector3(R(-4, 4), R(2, 6), R(-4, 4)), R(0.25, 0.45), 0xb88a52);
    g.audio.play('woodbreak', { pos: k.pos, vol: 0.8 });
    g.toast('CAIXA ESTOURADA!');
    for (const c of this.caps) if (c.task && c.task.crate === k) c.setTask(null);
    this.removeCrate(k);
  }
  grant(t, c) {
    const st = this.stock[t], boss = this.duel.bosses[t];
    const W = CONTENT.map(x => ({ id: x.id, w: x.id === 'arma' ? (boss.locked.size ? 40 : 0) : x.id === 'municao' && this.duel.unlockMode ? 12 : x.w }));
    let tot = W.reduce((a, x) => a + x.w, 0), r = Math.random() * tot, pick = W[1].id;
    for (const x of W) { r -= x.w; if (r <= 0) { pick = x.id; break; } }
    let msg = '';
    if (pick === 'capanga' && this.teamCaps(t).length >= MAX_CREW) pick = 'kit';
    if (pick === 'arma') {
      // the next weapon in line most of the time, sometimes a surprise
      const left = WORDER.filter(id => boss.locked.has(id));
      const id = Math.random() < 0.65 ? left[0] : left[(Math.random() * left.length) | 0];
      this.duel.unlockWeapon(boss, id);
      msg = `ARMA NOVA: ${WNAME[id]}!`;
    }
    if (pick === 'municao' && !['rifle50', 'granada', 'canhao', 'rpg'].some(id => !boss.locked.has(id))) pick = 'kit';
    if (pick === 'municao') {
      const ids = ['rifle50', 'granada', 'canhao', 'rpg'].filter(id => !boss.locked.has(id)), id = ids[(Math.random() * ids.length) | 0];
      const names = { rifle50: 'TIRO DE .50', granada: 'GRANADA', canhao: 'BALA DE CANHÃO', rpg: 'FOGUETE' };
      if (boss.stock[id] !== Infinity) boss.stock[id]++;
      msg = `+1 ${names[id]}`;
    } else if (pick === 'kit') { st.kit++; msg = '+1 KIT DE REPARO'; }
    else if (pick === 'armadilhas') {
      const k = ['mina', 'mola', 'banana'][(Math.random() * 3) | 0], n = k === 'banana' ? 2 : 1;
      st[k] += n; msg = `+${n} ${k === 'mina' ? 'MINA' : k === 'mola' ? 'MOLA' : 'BANANAS'}`;
    } else if (pick === 'capanga') {
      const nc = new Capanga(this, t, this.teamCaps(t).length); nc.pos.copy(c.pos); this.caps.push(nc);
      msg = `+1 CAPANGA: ${nc.name.toUpperCase()}`;
    }
    this.game.audio.play('ui', { vol: 0.5, rate: 1.2 });
    if (t === this.myTeam()) this.game.toast(pick === 'arma' ? msg : `CAIXA: ${msg}`);
    else this.game.toast(`${this.duel.bosses[t].T.name.toUpperCase()} PEGARAM UMA CAIXA`);
    this.duel.updateHUD(true);
  }

  // ---------- traps ----------
  placeTrap(type, team, pos) {
    const g = new THREE.Group();
    if (type === 'mina') {
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.12, 14), mat(0x2b2b2b, { m: 0.4 })));
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3030 })); led.position.y = 0.08; g.add(led); g.userData.led = led;
    } else if (type === 'mola') {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.6), mat(0x6b6f76, { m: 0.5 })));
      for (let i = 0; i < 4; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.025, 6, 16), mat(0xd8dde3, { m: 0.7, r: 0.3 })); r.rotation.x = Math.PI / 2; r.position.y = 0.08 + i * 0.07; g.add(r); }
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.5), mat(0xff3b2b)); top.position.y = 0.36; g.add(top);
    } else {
      const peel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.06, 6, 14, Math.PI * 1.3), mat(0xffd23a, { r: 0.5 }));
      peel.rotation.x = Math.PI / 2; peel.position.y = 0.05; g.add(peel);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    const p = pos.clone(); p.y = this.ground(p.x, p.z, p.y + 0.5);
    g.position.copy(p);
    this.scene.add(g);
    this.traps.push({ type, team, pos: p, mesh: g, armT: 1.0, gone: false });
    this.game.audio.play('click', { pos: p, vol: 0.5, rate: 0.8 });
  }
  victims(team) {
    const out = [];
    for (const c of this.caps) if (c.team !== team && !c.ko) out.push(c);
    for (const b of this.duel.bosses) if (b.team !== team && !b.ko) out.push(b);
    return out;
  }
  updateTrap(tr, dt) {
    if (tr.armT > 0) { tr.armT -= dt; return; }
    if (tr.type === 'mina' && tr.mesh.userData.led) tr.mesh.userData.led.visible = Math.floor(performance.now() / 400) % 2 === 0;
    for (const v of this.victims(tr.team)) {
      const dx = v.pos.x - tr.pos.x, dz = v.pos.z - tr.pos.z;
      if (dx * dx + dz * dz < 0.75 * 0.75 && Math.abs(v.pos.y - tr.pos.y) < 0.7) { this.trigger(tr, v); break; }
    }
  }
  trigger(tr, v) {
    if (tr.gone) return;
    tr.gone = true; this.scene.remove(tr.mesh);
    const g = this.game, isBoss = !v.crewMember;
    if (tr.type === 'mina') {
      g.explode(tr.pos.clone().add(new THREE.Vector3(0, 0.25, 0)), 1.5, 3.8, { source: 'mine' });
      g.toast('MINA!');
    } else if (tr.type === 'mola') {
      const a = Math.random() * Math.PI * 2;
      v.vel.set(Math.cos(a) * 4, 12.5, Math.sin(a) * 4); v.onGround = false; v.knockT = 1.4;
      g.audio.play('snap', { pos: tr.pos, vol: 0.9, rate: 0.6 }); g.audio.play('stretch', { pos: tr.pos, vol: 0.7, rate: 1.6 });
      g.toast('BOIIING!');
      if (v.carrying) this.dropCrate(v);
    } else {
      const a = (v.yaw || 0);
      v.vel.x += -Math.sin(a) * 4; v.vel.z += -Math.cos(a) * 4; v.knockT = 0.8;
      if (isBoss) { if (this.duel.realtime) v.stunT = Math.max(v.stunT || 0, 3); else v.dizzy = Math.max(v.dizzy, 1); }
      else { v.stunT = Math.max(v.stunT, 3.5); if (v.carrying) this.dropCrate(v); }
      g.audio.play('stretch', { pos: tr.pos, vol: 0.8, rate: 2 }); g.audio.play('hit', { pos: tr.pos, vol: 0.5, rate: 1.4 });
      g.toast('ESCORREGOU NA BANANA!');
    }
  }

  // ---------- building ----------
  repairFort(t, near) {
    const w = this.game.world;
    const missing = this.fortCells[t].filter(e => !w.mat[e.c]);
    if (!missing.length) return false;
    const pos = (c) => { const i = c % NX, k = ((c / NX) | 0) % NZ, j = (c / (NX * NZ)) | 0; return [i, j, k]; };
    // rebuild from the bottom up, only blocks that have something to stand on, nearest to the worker first
    let restored = 0;
    for (let pass = 0; pass < 6 && restored < 40; pass++) {
      const cand = missing.filter(e => !w.mat[e.c]).map(e => { const [i, j, k] = pos(e.c); return { e, i, j, k }; })
        .filter(o => o.j <= 1 || w.mat[o.e.c - NX * NZ]).sort((a, b) => a.j - b.j);
      if (!cand.length) break;
      for (const o of cand) {
        if (restored >= 40) break;
        w.set(o.i, o.j, o.k, o.e.m, o.e.tint, o.e.f);
        if (o.e.f & 1) w.removedHouse = Math.max(0, w.removedHouse - 1);
        w.teamRemoved[t] = Math.max(0, w.teamRemoved[t] - 1);
        restored++;
      }
    }
    if (!restored) return false;
    w.buildMeshes(this.game.q);
    this.game.audio.play('rubble', { pos: near, vol: 0.6, rate: 1.3 });
    return true;
  }
  buildBarricade(t, at, alongX0) {
    const w = this.game.world, d = alongX0 != null ? new THREE.Vector3() : this.faceDir(t);
    const alongX = alongX0 != null ? alongX0 : Math.abs(d.z) > 0.5;
    const i0 = w.ci(at.x), k0 = w.ck(at.z);
    const j0 = Math.max(0, Math.floor(this.game.terrain.heightAt(at.x, at.z) / VOX));
    let placed = 0;
    for (let a = -2; a <= 2; a++) for (let j = j0; j <= j0 + 2; j++) {
      const i = alongX ? i0 + a : i0 + Math.sign(d.x), k = alongX ? k0 + Math.sign(d.z) : k0 + a;
      if (w.get(i, j, k)) continue;
      w.set(i, j, k, MAT.CONCRETE, 0xb0aea8, false); placed++;
    }
    if (!placed) return false;
    w.buildMeshes(this.game.q);
    this.game.audio.play('stones', { pos: at, vol: 0.7 });
    return true;
  }

  // ---------- damage hooks used by the duel ----------
  targets() { return [...this.caps.filter(c => !c.ko), ...this.crates.filter(k => k.state === 'fall' || k.state === 'ground')]; }
  explosionHit(pos, P, R0) {
    for (const c of this.caps) {
      if (c.ko) continue;
      const ch = c.chest(), d = ch.distanceTo(pos), RR = R0 * 1.25;
      if (d > RR) continue;
      let f = 1 - d / RR;
      const dir = ch.clone().sub(pos); const len = dir.length(); dir.divideScalar(len || 1);
      if (this.game.world.raycast(pos, dir, Math.max(0, len - 0.3))) f *= 0.35;
      this.damageCap(c, 32 * P * f, 'explosão', c.headPos());
      const k = 12 * P * f;
      c.vel.x += dir.x * k; c.vel.z += dir.z * k; c.vel.y += 4 * P * f + Math.max(0, dir.y) * k * 0.5;
      c.knockT = 0.5 + f * 0.6; c.onGround = false;
      if (c.carrying && f > 0.2) this.dropCrate(c);
    }
    for (const k of this.crates) if (k.state === 'fall' || k.state === 'ground') { const d = k.pos.distanceTo(pos); if (d < R0) this.hitCrate(k, 40 * P * (1 - d / R0)); }
    // mines go off in a chain
    for (const tr of this.traps) if (!tr.gone && tr.type === 'mina' && tr.pos.distanceTo(pos) < R0 * 0.6 && tr.pos.distanceTo(pos) > 0.3) {
      setTimeout(() => this.trigger(tr, { crewMember: true, pos: tr.pos, vel: new THREE.Vector3() }), 120);
    }
  }

  // ---------- visuals ----------
  updateVisuals(rdt) {
    const t = performance.now() / 1000, my = this.myTeam();
    for (const c of this.caps) {
      const m = c.model;
      m.position.copy(c.pos);
      m.rotation.set(c.ko ? -Math.PI / 2 * 0.95 : 0, c.yaw, 0);
      if (c.ko) m.position.y += 0.12;
      const sw = Math.sin(c.walk) * 0.5 * Math.min(1, Math.hypot(c.vel.x, c.vel.z) / 2);
      c.legs[0].rotation.x = sw; c.legs[1].rotation.x = -sw;
      const carry = !!c.carrying || c.state === 'work';
      c.arms[0].rotation.x = carry ? -2.6 + (c.state === 'work' ? Math.sin(t * 14) * 0.6 : 0) : -sw;
      c.arms[1].rotation.x = carry ? -2.6 - (c.state === 'work' ? Math.sin(t * 14) * 0.6 : 0) : sw;
      const showStars = c.ko || c.stunT > 0;
      c.stars.visible = showStars;
      if (showStars) c.stars.children.forEach((s, i) => { const a = s.userData.a + t * 3.4; s.position.set(Math.cos(a) * 0.22, Math.sin(t * 5 + i) * 0.03, Math.sin(a) * 0.22); });
      c.ring.visible = !c.ko && (c.team === my || this.aerial);
      c.ring.scale.setScalar(this.aerial ? 2.2 : 1);
      c.ring.material.color.setHex(this.selected === c ? 0xffe14a : c.T.vest);
      c.ring.material.opacity = this.selected === c ? 1 : 0.75;
    }
    for (const k of this.crates) if (k.ring) k.ring.material.opacity = 0.55 + Math.sin(t * 6) * 0.3;
  }

  // ---------- UI: henchmen cards, orders, aerial view ----------
  buildUI() {
    $('crewrow').style.display = 'flex';
    const tap = (el, fn) => {
      el.addEventListener('click', e => { e.stopPropagation(); fn(); });
      el.addEventListener('touchstart', e => { e.stopPropagation(); e.preventDefault(); fn(); }, { passive: false });
    };
    this._tap = tap;
    const cur = () => this.game.duel && this.game.duel.crew;
    if (!this.game._crewUIBound) {
      this.game._crewUIBound = true;
      tap($('orders-close'), () => cur() && cur().closeOrders());
      tap($('aerial'), () => cur() && cur().setAerial(!cur().aerial));
      // actions while driving a henchman (by turns)
      const col = $('capact');
      for (const id of ['mina', 'mola', 'banana', 'barricade', 'repair']) {
        const b = document.createElement('button');
        b.className = 'actbtn'; b.dataset.id = id; b.setAttribute('aria-label', ORDERS.find(o => o.id === id).label);
        b.innerHTML = svgIcon(id, 20) + '<span class="cnt"></span>';
        tap(b, () => cur() && cur().act(id));
        col.appendChild(b);
      }
      tap($('capgrab'), () => cur() && cur().act('grab'));
    }
    const grid = $('orders-grid');
    grid.innerHTML = '';
    this.orderBtns = {};
    for (const o of ORDERS) {
      const b = document.createElement('button');
      b.className = 'ordbtn'; b.setAttribute('aria-label', o.label);
      b.innerHTML = svgIcon(o.id === 'fetch' ? 'fetch' : o.id, 20) + '<span class="cnt"></span>';
      tap(b, () => this.order(o.id));
      grid.appendChild(b); this.orderBtns[o.id] = b;
    }
    this._barKey = '';
    this.updateUI();
  }
  // round avatars: by turns, the boss first, then the henchmen (tap = take control); in real time, tap = orders
  updateUI() {
    const my = this.myTeam(), bar = $('crewbar'), d = this.duel;
    const show = my >= 0 && d.state !== 'over';
    $('crewrow').style.display = show ? 'flex' : 'none';
    if (!show) { if ($('orders').style.display !== 'none') this.closeOrders(); if (this.aerial) this.setAerial(false); return; }
    if (this.selected && this.selected.team !== my) this.closeOrders();
    const caps = this.teamCaps(my);
    const key = my + ':' + caps.length + ':' + d.realtime;
    if (key !== this._barKey) {
      this._barKey = key; bar.innerHTML = '';
      if (!d.realtime) {
        const bb = document.createElement('button');
        bb.className = 'capav boss'; bb.setAttribute('aria-label', 'Chefe');
        bb.innerHTML = svgIcon('boss', 18) + '<u></u>';
        this._tap(bb, () => this.takeControl(null));
        this.bossAv = bb; bar.appendChild(bb);
      }
      for (const c of caps) {
        const b = document.createElement('button');
        b.className = 'capav'; b.setAttribute('aria-label', c.name);
        b.innerHTML = `<i>${c.name[0]}</i><u></u>`;
        this._tap(b, () => d.realtime ? this.select(c) : this.takeControl(c));
        c.card = b; bar.appendChild(b);
      }
    }
    const boss = d.bosses[my];
    if (this.bossAv) {
      this.bossAv.style.borderColor = !d.ctrl ? '#FFC531' : boss.T.css;
      this.bossAv.querySelector('u').style.width = Math.max(0, boss.hp) + '%';
      this.bossAv.querySelector('u').style.background = boss.T.css;
    }
    for (const c of caps) {
      const b = c.card; if (!b) continue;
      const u = b.querySelector('u');
      u.style.width = Math.max(0, c.hp / CAP_HP * 100) + '%'; u.style.background = c.T.css;
      b.style.borderColor = d.ctrl === c || this.selected === c ? '#FFC531' : c.T.css;
      b.classList.toggle('ko', c.ko || c.stunT > 0);
      b.querySelector('i').textContent = c.ko ? 'z' : c.name[0];
      b.title = c.name;
    }
    // action column while driving
    const st = this.stock[my];
    document.querySelectorAll('#capact .actbtn').forEach(b => {
      const id = b.dataset.id, o = ORDERS.find(x => x.id === id);
      b.querySelector('.cnt').textContent = o.cost ? st[o.cost] : '';
      b.classList.toggle('off', !!o.cost && st[o.cost] <= 0);
    });
    const dc = d.ctrl;
    if (dc) { const g = $('capgrab'); g.innerHTML = svgIcon(dc.carrying ? 'drop' : 'grab', 30) + `<span>${dc.carrying ? 'LARGAR' : 'PEGAR'}</span>`; }
    if ($('orders').style.display !== 'none' && this.selected) this.fillOrders();
  }
  // by turns: switch between the boss and a henchman, only on your own turn before the shot
  takeControl(c) {
    const d = this.duel, g = this.game;
    g.audio.resume();
    if (d.realtime) return;
    if (d.state !== 'aim' || d.isAI()) { g.toast('SÓ NA SUA VEZ'); return; }
    if (d.firedAny) { g.toast('DEPOIS DO TIRO, SÓ O CHEFE SE MEXE'); return; }
    if (c && c.ko) { g.toast(`${c.name.toUpperCase()} ESTÁ DESMAIADO`); return; }
    if (c && c.team !== d.turn) return;
    d.setCtrl(c);
    g.notice(c ? `Você está com o ${c.name}` : 'De volta ao chefe');
  }
  // actions of the henchman you are driving
  act(id) {
    const d = this.duel, c = d.ctrl, g = this.game;
    if (!c || c.stunT > 0 || c.workT > 0) return;
    const st = this.stock[c.team];
    if (id === 'grab') {
      if (c.carrying) { this.dropCrate(c); g.notice('Largou a caixa'); return; }
      const k = this.crates.find(k => k.state === 'ground' && Math.hypot(k.pos.x - c.pos.x, k.pos.z - c.pos.z) < 1.5 && Math.abs(k.pos.y - c.pos.y) < 1.4);
      if (!k) { g.notice(this.crates.some(k => k.state === 'fall') ? 'Espere a caixa cair' : 'Chegue perto de uma caixa'); return; }
      k.state = 'carried'; k.carrier = c; c.carrying = k;
      for (let t = 0; t < this.n; t++) if (k.claimed[t] && k.claimed[t] !== c) { const o = k.claimed[t]; k.claimed[t] = null; if (o.task && o.task.crate === k) o.setTask(null); }
      g.audio.play('woodhit', { pos: k.pos, vol: 0.5, rate: 1.3 });
      g.notice('Pegou! Leve para dentro do forte');
      this.updateUI();
      return;
    }
    const o = ORDERS.find(x => x.id === id);
    if (o.cost && st[o.cost] <= 0) { g.notice('Sem estoque: pegue caixas'); return; }
    if (id === 'repair') {
      const f = this.fort(c.team), m = 2.5;
      if (!(c.pos.x > f.x0 - m && c.pos.x < f.x1 + m && c.pos.z > f.z0 - m && c.pos.z < f.z1 + m)) { g.notice('Chegue perto do seu forte'); return; }
    }
    c.workT = 0.001; c.workJob = id; c.vel.x = 0; c.vel.z = 0; c.state = 'work';
  }
  driveWork(c, dt) {
    const g = this.game, st = this.stock[c.team], id = c.workJob;
    c.workT += dt;
    const need = id === 'repair' ? 3 : id === 'barricade' ? 2.4 : 0.9;
    if (Math.floor(c.workT * 3) !== Math.floor((c.workT - dt) * 3)) g.audio.play(id === 'repair' || id === 'barricade' ? 'stones' : 'click', { pos: c.pos, vol: 0.35, rate: R(0.9, 1.3) });
    if (c.workT < need) return;
    const cost = ORDERS.find(o => o.id === id).cost;
    const fwd = new THREE.Vector3(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
    const at = c.pos.clone().addScaledVector(fwd, id === 'barricade' ? 1.6 : 0.9);
    let ok = true;
    if (id === 'repair') ok = this.repairFort(c.team, c.pos);
    else if (id === 'barricade') ok = this.buildBarricade(c.team, at, Math.abs(fwd.z) > Math.abs(fwd.x));
    else this.placeTrap(id, c.team, at);
    if (ok && cost) st[cost]--;
    g.notice(id === 'repair' ? (ok ? 'Forte reparado' : 'Nada para reparar') : id === 'barricade' ? 'Barricada erguida' : id === 'mina' ? 'Mina armada' : id === 'mola' ? 'Mola armada' : 'Banana no chão');
    c.workT = 0; c.workJob = null; c.state = 'idle';
    this.updateUI();
  }
  select(c) {
    this.game.audio.resume();
    this.selected = c; this.pending = null;
    // under the row of avatars, so the map button stays free
    $('orders').style.top = (parseInt($('crewrow').style.top || '112', 10) + 52) + 'px';
    $('orders').style.display = 'flex';
    this.fillOrders();
    this.updateUI();
  }
  fillOrders() {
    const c = this.selected, st = this.stock[c.team];
    $('orders').classList.toggle('mini', !!(this.pending && this.aerial));
    $('orders-name').textContent = c.name.toUpperCase();
    const pend = this.pending && ORDERS.find(o => o.id === this.pending);
    $('orders-hint').textContent = pend ? `${pend.label}: ${this.aerial ? 'toque no mapa' : 'mire no chão e toque de novo'}` : c.ko ? 'desmaiado' : (this._lastOrder || 'escolha uma ordem');
    for (const o of ORDERS) {
      const b = this.orderBtns[o.id];
      const none = (o.cost && st[o.cost] <= 0) || (o.id === 'fetch' && !this.crates.some(k => k.state === 'fall' || k.state === 'ground'));
      b.classList.toggle('off', !!none || c.ko);
      b.querySelector('.cnt').textContent = o.cost ? st[o.cost] : '';
      b.classList.toggle('hl', this.pending === o.id);
    }
  }
  closeOrders() { $('orders').style.display = 'none'; this.pending = null; if (!this.aerial) this.selected = null; this.updateUI(); }
  // where the boss is aiming, on the ground of the yard
  aimPoint() {
    const d = this.duel, b = d.bosses[this.myTeam()], g = this.game;
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(b.pivot.matrixWorld);
    // from standing eye height (the boss may be crouched while giving orders)
    const o = new THREE.Vector3(b.pos.x, b.pos.y + 1.6, b.pos.z).addScaledVector(dir, 0.6);
    let T = 60;
    const wh = g.world.raycast(o, dir, 60); if (wh) T = Math.min(T, wh.t);
    const th = g.terrain.raycast(o, dir, 60); if (th) T = Math.min(T, th.t);
    if (T >= 60) return null;
    const p = o.addScaledVector(dir, T - 0.2);
    p.y = this.ground(p.x, p.z, p.y + 0.3);
    return this.clampYard(p);
  }
  order(id) {
    const c = this.selected, g = this.game;
    if (!c) return;
    if (c.ko) { g.toast(`${c.name.toUpperCase()} ESTÁ DESMAIADO`); return; }
    const o = ORDERS.find(x => x.id === id), st = this.stock[c.team];
    this._lastOrder = o.label;
    if (o.cost && st[o.cost] <= 0) { g.toast('SEM ESTOQUE: PEGUE CAIXAS'); return; }
    if (id === 'fetch') {
      const ks = this.crates.filter(k => k.state === 'fall' || k.state === 'ground');
      if (!ks.length) { g.toast('NENHUMA CAIXA NO CAMPO'); return; }
      ks.sort((a, b) => a.landing.distanceTo(c.pos) - b.landing.distanceTo(c.pos));
      const k = ks[0];
      if (k.claimed[c.team] && k.claimed[c.team] !== c) k.claimed[c.team].setTask(null);
      c.setTask({ type: 'fetch', crate: k }); c.auto = true;
      g.toast(`${c.name.toUpperCase()}: TÔ INDO!`); this.closeOrders(); return;
    }
    if (id === 'repair') { c.setTask({ type: 'repair', target: this.homePoint(c.team, c.idx) }); g.toast(`${c.name.toUpperCase()} VAI REPARAR`); this.closeOrders(); return; }
    if (id === 'home') { c.setTask({ type: 'home' }); c.auto = true; this.closeOrders(); return; }
    if (o.place) {
      if (this.aerial) { this.pending = id; this.fillOrders(); return; }
      // normal view: the spot is where the crosshair meets the ground; a second tap confirms
      if (this.pending !== id) { this.pending = id; this.fillOrders(); g.toast('MIRE NO CHÃO E TOQUE DE NOVO'); return; }
      const p = this.aimPoint();
      if (!p || this.inFort(p.x, p.z, 0.8)) { g.toast('MIRE NO CHÃO DO CANTEIRO'); return; }
      this.sendTo(c, id, p);
    }
  }
  sendTo(c, id, p) {
    c.setTask({ type: id, target: p }); c.auto = false;
    this.game.toast(`${c.name.toUpperCase()}: ${id === 'barricade' ? 'BARRICADA LÁ' : 'ARMADILHA LÁ'}`);
    this.pending = null;
    this.closeOrders();
  }

  setAerial(on) {
    this.aerial = on;
    this.duel.aerial = on;
    $('aerial').classList.toggle('on', on);
    $('aerialhint').style.display = on ? 'block' : 'none';
    if (!on) { this.pending = null; if ($('orders').style.display === 'none') this.selected = null; }
    if (on && this.game.zoomed) this.game.toggleZoom(false);
    const w = this.game.weapons && this.game.weapons[this.game.wi];
    if (on && w && w.isDown) this.game.fireUp();
  }
  // a tap on the aerial map: select a henchman, place a pending trap/barricade, send him somewhere or after a crate
  aerialTap(sx, sy) {
    const g = this.game, cam = g.camera, my = this.myTeam();
    if (my < 0) return;
    const ndc = new THREE.Vector2(sx / window.innerWidth * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, cam);
    const t = (0.3 - ray.ray.origin.y) / ray.ray.direction.y;
    if (!(t > 0)) return;
    const p = ray.ray.origin.clone().addScaledVector(ray.ray.direction, t);
    p.y = this.ground(p.x, p.z, 3);
    // own henchman under the finger? (measured on the screen, so the tiny figures are easy to hit)
    let hit = null, hd = 44;
    for (const c of this.teamCaps(my)) {
      const v = c.chest().project(cam), x = (v.x + 1) / 2 * window.innerWidth, y = (1 - v.y) / 2 * window.innerHeight;
      const d = Math.hypot(x - sx, y - sy); if (d < hd) { hd = d; hit = c; }
    }
    if (hit && !this.pending) { this.select(hit); return; }
    const c = this.selected;
    if (!c || c.team !== my) { g.toast('TOQUE NUM CAPANGA SEU PRIMEIRO'); return; }
    if (c.ko) { g.toast(`${c.name.toUpperCase()} ESTÁ DESMAIADO`); return; }
    if (this.inFort(p.x, p.z, 0.5)) { g.toast('DENTRO DO FORTE NÃO DÁ'); return; }
    this.clampYard(p);
    if (this.pending) { this.sendTo(c, this.pending, p); return; }
    const k = this.crates.find(k => (k.state === 'fall' || k.state === 'ground') && Math.hypot(k.landing.x - p.x, k.landing.z - p.z) < 1.8);
    if (k) { if (k.claimed[my] && k.claimed[my] !== c) k.claimed[my].setTask(null); c.setTask({ type: 'fetch', crate: k }); c.auto = true; g.toast(`${c.name.toUpperCase()}: TÔ INDO!`); return; }
    c.setTask({ type: 'move', target: p }); c.auto = false;
    g.toast(`${c.name.toUpperCase()} VAI PRA LÁ`);
  }
}
