// Duel mode: two forts, two bosses, turns, cameras (over-the-shoulder, projectile follow, impact orbit), wind, damage, dizzy, AI.
import * as THREE from '../lib/three.module.min.js';
import { makeWeapons, setSleeveColor } from './weapons.js';
import { MAT } from './world.js';

const R = (a, b) => a + Math.random() * (b - a);
const $ = id => document.getElementById(id);

export const DUEL_LAYOUT = {
  mode: 'duel', size: 64,
  forts: [
    { x0: -5, x1: 5, z0: 9, z1: 15, face: -1, upper: 0xf2c7a0, trim: 0xffffff, banner: 0xff8a2a, tank: 0xff8a2a },
    { x0: -5, x1: 5, z0: -19, z1: -13, face: 1, upper: 0xb9d3ea, trim: 0xffffff, banner: 0x3d6fd1, tank: 0x3d6fd1 },
  ],
  // fields used by shared code paths
  house: { x0: -5, x1: 5, z0: -3, z1: 3 },
};

export const TEAMS = [
  { name: 'Marretões', boss: 'Dona Marreta', css: '#FF8A2A', vest: 0xff8a2a, helmet: 0xffc531, sleeve: 0xff8a2a, roofY: 7.5, spawn: new THREE.Vector3(0, 7.5, 12.6), yaw: 0 },
  { name: 'Betoneiras', boss: 'Seu Betão', css: '#5B8CFF', vest: 0x3d6fd1, helmet: 0xf4f4f4, sleeve: 0x3d6fd1, roofY: 7.5, spawn: new THREE.Vector3(0, 7.5, -16.6), yaw: Math.PI },
];

// shots per turn and stock per match
export const RULES = {
  pedra: { shots: 2, stock: Infinity }, estilingue: { shots: 2, stock: Infinity }, pistola: { shots: 6, stock: Infinity },
  shotgun: { shots: 2, stock: Infinity }, rifle50: { shots: 1, stock: 4 }, granada: { shots: 1, stock: 3 },
  canhao: { shots: 1, stock: 3 }, rpg: { shots: 1, stock: 2 },
};

// what the AI knows about each weapon's ballistics (full charge)
const AI_SPEC = {
  pedra: { kind: 'arc', speed: 26, up: 2.5, grav: -13, wind: 0.35, hold: 0.75 },
  estilingue: { kind: 'arc', speed: 52, up: 0, grav: -9.81, wind: 0.25, hold: 1.15 },
  pistola: { kind: 'ray', hold: 0.05 }, shotgun: { kind: 'ray', hold: 0.05 }, rifle50: { kind: 'ray', hold: 0.05 },
  granada: { kind: 'arc', speed: 17, up: 3.5, grav: -13, wind: 0.3, hold: 0.45 },
  canhao: { kind: 'arc', speed: 62, up: 1.5, grav: -13, wind: 0.08, hold: 0.05 },
  rpg: { kind: 'rocket', hold: 0.05 },
};
const NOISE = { facil: [0.075, 0.07], medio: [0.032, 0.03], dificil: [0.012, 0.01] };

function mat(color, o = {}) { return new THREE.MeshStandardMaterial({ color, roughness: o.r != null ? o.r : 0.7, metalness: o.m || 0 }); }
function bx(w, h, d, m, x, y, z) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; return b; }

class Boss {
  constructor(game, team) {
    this.game = game; this.team = team; this.T = TEAMS[team];
    this.pos = this.T.spawn.clone(); this.vel = new THREE.Vector3();
    this.yaw = this.T.yaw; this.pitch = 0.05;
    this.onGround = true; this.bob = 0; this.bobAmp = 0; this.stepT = 0; this.knockT = 0;
    this.hp = 100; this.dizzy = 0; this.ko = false;
    const f = DUEL_LAYOUT.forts[team];
    this.bounds = { x0: f.x0 + 0.35, x1: f.x1 - 0.35, z0: f.z0 + 0.35, z1: f.z1 - 0.35 };
    this.stock = {}; for (const k in RULES) this.stock[k] = RULES[k].stock;
    this.wi = team === 0 ? 7 : 6;
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
    const showStars = this.ko || this.dizzy > 0;
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
  constructor(game, opts) {
    this.game = game;
    this.vsCPU = !!opts.cpu; this.diff = opts.diff || 'medio';
    this.bosses = [new Boss(game, 0), new Boss(game, 1)];
    this.turn = 0; this.round = 1;
    this.state = 'intro'; this.stateT = 0;
    this.camPos = new THREE.Vector3(26, 14, 4); this.camLook = new THREE.Vector3(0, 3, -2);
    this.zeroInput = { mx: 0, mz: 0, jump: false, lookDX: 0, lookDY: 0, keys: {} };
    this.ai = null;
    this.timer = 45;
    this.newWind();
    this.trajPts = this.makeTrajectory();
    this.turnShots = 0; this.lockedWeapon = null; this.firedAny = false;
    this.followP = null; this.impact = null; this.bulletCam = null;
    this.lastFireT = 0; this.result = null;
    this.activate(0, true);
    this.banner('DUELO!', `${TEAMS[0].name} × ${TEAMS[1].name}`, 2.2);
    $('duelhud').style.display = 'block';
    this.updateHUD(true);
  }

  get boss() { return this.bosses[this.turn]; }
  isAI(team = this.turn) { return this.vsCPU && team === 1; }

  dispose() {
    for (const b of this.bosses) { for (const w of b.weapons) w.unequip(); b.dispose(); }
    this.game.scene.remove(this.trajPts);
    $('duelhud').style.display = 'none';
    $('banner').style.display = 'none'; $('handoff').style.display = 'none'; $('result').style.display = 'none';
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

  // switch the active boss: weapons set, sleeves, player binding
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

  // ---------- turn flow ----------
  setState(s) { this.state = s; this.stateT = 0; }

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
    this.banner(`VEZ ${b.team === 0 ? 'DOS' : 'DOS'} ${b.T.name.toUpperCase()}`, b.T.boss + (this.isAI() ? ' (computador)' : ''), 1.4);
    if (this.isAI()) this.ai = { t: 0, phase: 'choose', shot: 0 };
  }

  endTurn() {
    this.ai = null;
    this.trajPts.visible = false;
    if (this.checkWin()) return;
    const next = 1 - this.turn;
    if (next === 0) this.round++;
    this.activate(next);
    if (!this.vsCPU) { this.showHandoff(); this.setState('handoff'); }
    else { this.setState('transition'); }
  }

  checkWin() {
    const w = this.game.world;
    const fortPct = t => w.teamTotal[t] ? w.teamRemoved[t] / w.teamTotal[t] : 0;
    let loser = -1;
    for (let t = 0; t < 2; t++) if (this.bosses[t].ko || fortPct(t) >= 0.75) loser = loser === -1 ? t : 2;
    if (loser === -1) return false;
    this.setState('over');
    const res = $('result');
    const titles = ['', ''];
    if (loser === 2) { titles[0] = 'EMPATE!'; titles[1] = 'Os dois chefes foram pro chão'; }
    else {
      const win = 1 - loser;
      titles[0] = `VITÓRIA DOS ${TEAMS[win].name.toUpperCase()}!`;
      titles[1] = this.bosses[loser].ko ? `${TEAMS[loser].boss} foi nocauteado` : `O forte dos ${TEAMS[loser].name} foi abaixo`;
      res.querySelector('.rt').style.color = TEAMS[win].css;
      this.game.audio.play('explosion', { vol: 0.5, rate: 1.4 });
    }
    res.querySelector('.rt').textContent = titles[0];
    res.querySelector('.rs').textContent = titles[1];
    res.querySelector('.rst').innerHTML = [0, 1].map(t => `<div><b style="color:${TEAMS[t].css}">${TEAMS[t].name}</b> · forte destruído ${Math.round(fortPct(t) * 100)}% · energia do chefe ${Math.max(0, Math.round(this.bosses[t].hp))}</div>`).join('') + `<div>${this.round} rodadas</div>`;
    setTimeout(() => { res.style.display = 'flex'; }, 1500);
    return true;
  }

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
    if (this.state !== 'aim' || this.result) return false;
    const w = this.game.weapons[this.game.wi];
    if (this.lockedWeapon && this.lockedWeapon !== w) return false;
    if (this.firedAny && this.turnShots <= 0) return false;
    if (!this.firedAny && this.boss.stock[w.id] <= 0) { this.game.toast('SEM ESTOQUE DESSA ARMA'); return false; }
    return true;
  }
  canSwitch() { return !this.firedAny && (this.state === 'aim' || this.state === 'transition'); }

  onFired(w, info = {}) {
    if (this.game.mode !== 'duel') return;
    const b = this.boss;
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
    if (this.turnShots <= 0 || ['cannonball', 'rocket', 'grenade'].includes(p.type)) this.followP = p;
  }
  onImpact(pos) { this.impact = { pos: pos.clone(), t: 0 }; }

  // ---------- damage ----------
  damage(b, dmg, cause, at) {
    if (b.ko || dmg <= 0.5 || this.state === 'over') return;
    b.hp -= dmg;
    const g = this.game;
    g.floaterText(`-${Math.round(dmg)}`, at || b.headPos(), b.T.css);
    g.audio.play('hit', { pos: b.chest(), vol: Math.min(1, 0.4 + dmg / 40), rate: 0.8 });
    if (b === this.boss) g.haptic(Math.min(1, dmg / 40));
    if (b.hp <= 0) {
      b.hp = 0; b.ko = true;
      g.toast(`${b.T.boss.toUpperCase()} NOCAUTEADO!`);
      g.audio.play('bigimpact', { pos: b.chest(), vol: 0.8 });
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
  }

  // ray vs boss spheres (chest + head) -> {b, t, head}
  rayBosses(o, d, maxT, exclude) {
    let best = null, bt = maxT;
    for (const b of this.bosses) {
      if (b === exclude || b.ko) continue;
      for (const [c, r, head] of [[b.chest(), 0.38, false], [b.headPos(), 0.26, true]]) {
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
  aiSolve(w) {
    const g = this.game, b = this.boss, enemy = this.bosses[1 - this.turn];
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

  updateAI(dt) {
    const ai = this.ai, g = this.game, b = this.boss;
    if (!ai) return;
    ai.t += dt;
    const w = g.weapons[g.wi];
    if (ai.phase === 'choose') {
      if (ai.t < 0.6) return;
      const opts = [];
      const add = (i, wgt) => { const id = b.weapons[i].id; if (b.stock[id] > 0) opts.push([i, wgt]); };
      add(7, 5); add(6, 5); add(5, 3); add(4, 3); add(3, 2); add(2, 1.5); add(1, 0.8); add(0, 0.4);
      let tot = opts.reduce((a, o) => a + o[1], 0), r = Math.random() * tot, pick = opts[0][0];
      for (const [i, wg] of opts) { r -= wg; if (r <= 0) { pick = i; break; } }
      g.selectWeapon(pick, true);
      ai.phase = 'ready'; ai.t = 0;
      return;
    }
    if (ai.phase === 'ready') {
      if (!w.ready || w.anim) { if (ai.t > 8) { this.passTurn(); } return; }
      ai.sol = this.aiSolve(w); ai.from = { yaw: b.yaw, pitch: b.pitch }; ai.phase = 'turning'; ai.t = 0;
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

  passTurn() {
    if (this.state !== 'aim') return;
    if (this.game.weapons[this.game.wi].isDown) this.game.weapons[this.game.wi].up();
    this.setState('flight');
  }

  // ---------- per-frame ----------
  update(rdt, dt) {
    const g = this.game, t = performance.now() / 1000;
    this.stateT += rdt;
    const b = this.boss;
    // bosses: active one takes input when it's a human aiming; both get physics (falls, knockback)
    for (const bb of this.bosses) {
      if (bb.knockT > 0) bb.knockT -= dt;
      const active = bb === b && this.state === 'aim' && !this.isAI() && !bb.ko;
      g.player = bb;
      g.updatePlayer(dt, bb, active ? g.input : this.zeroInput, false);
      bb.update(dt, t);
    }
    g.player = b;
    if (!this.isAI()) { g.input.lookDX = 0; g.input.lookDY = 0; }
    // weapons of the active boss
    for (const w of b.weapons) if (w.model.visible) w.update(dt);
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
      wantPos.set(28 - k * 10, 15 - k * 3, 6 - k * 4); wantLook.set(0, 3, -2); rate = 3;
    } else if (st === 'over') {
      const loser = this.bosses.find(x => x.ko) || this.bosses[0];
      const a = this.stateT * 0.3;
      wantLook.copy(loser.pos).add(new THREE.Vector3(0, 1, 0));
      wantPos.copy(wantLook).add(new THREE.Vector3(Math.sin(a) * 8, 4, Math.cos(a) * 8)); rate = 2;
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
    } else if (st === 'aim' && g.zoomed) {
      wantPos.copy(b.headPos()).addScaledVector(new THREE.Vector3(0, 0, -1).transformDirection(b.pivot.matrixWorld), 0.35);
      wantLook.copy(wantPos).addScaledVector(new THREE.Vector3(0, 0, -1).transformDirection(b.pivot.matrixWorld), 10);
      rate = 40; fov = g.weapons[g.wi].id === 'rifle50' ? 14 : 34;
    } else {
      this.shoulderCam(b, wantPos, wantLook);
      rate = st === 'transition' || st === 'skip' ? 3.2 : 16;
    }
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
    const scoped = st === 'aim' && g.zoomed;
    b.model.visible = !scoped && cam.position.distanceTo(b.headPos()) > 1.3;
    for (const w of b.weapons) if (w.model.visible && scoped) w.model.visible = !scoped || !!w.anim;
    $('cross').style.display = st === 'aim' && !this.isAI() ? 'block' : 'none';
  }

  updateTrajectory() {
    const g = this.game, b = this.boss, pts = this.trajPts;
    const w = g.weapons[g.wi];
    const spec = this.state === 'aim' && !(this.isAI() && this.diff !== 'facil') && w.preview ? w.preview() : null;
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
    const b = this.boss, w = this.game.world;
    const el = $('turn');
    el.style.borderColor = b.T.css;
    $('turn-team').textContent = this.isAI() ? `${b.T.name.toUpperCase()} · COMPUTADOR` : `VEZ DOS ${b.T.name.toUpperCase()}`;
    $('turn-team').style.color = b.T.css;
    $('turn-boss').textContent = b.T.boss;
    $('turn-round').textContent = `Rodada ${this.round}`;
    const tm = $('turn-timer');
    tm.textContent = this.state === 'aim' && !this.isAI() ? Math.ceil(Math.max(0, this.timer)) : '·';
    tm.style.borderColor = b.T.css;
    for (let t = 0; t < 2; t++) {
      const bb = this.bosses[t];
      $(`hp${t}`).style.width = Math.max(0, bb.hp) + '%';
      $(`hpn${t}`).textContent = bb.ko ? 'NOCAUTE' : (bb.dizzy ? 'TONTO · ' : '') + Math.round(bb.hp);
      const fp = w.teamTotal[t] ? w.teamRemoved[t] / w.teamTotal[t] : 0;
      $(`fort${t}`).textContent = `Forte ${Math.round(fp * 100)}% destruído`;
    }
    // wind relative to the active boss's view
    const right = new THREE.Vector3(Math.cos(b.yaw), 0, -Math.sin(b.yaw));
    const side = this.game.wind.dot(right);
    const kmh = Math.round(this.game.wind.length() * 3.6);
    const arrows = kmh === 0 ? '—' : side > 0 ? '▶'.repeat(1 + Math.min(2, Math.floor(kmh / 9))) : '◀'.repeat(1 + Math.min(2, Math.floor(kmh / 9)));
    $('wind-a').textContent = arrows; $('wind-v').textContent = `${kmh} km/h`;
    const gw = this.game.weapons[this.game.wi];
    const st = this.boss.stock[gw.id];
    let info = '';
    if (this.state === 'aim') {
      if (this.firedAny) info = `Tiros restantes neste turno: ${Math.max(0, this.turnShots)}`;
      else info = `${RULES[gw.id].shots} tiro${RULES[gw.id].shots > 1 ? 's' : ''} por turno · estoque ${st === Infinity ? '∞' : st}`;
    } else if (this.state === 'flight' || this.state === 'impact' || this.state === 'settle') info = 'Vendo o estrago…';
    $('turninfo').textContent = info;
    $('turninfo').style.display = info ? 'block' : 'none';
    $('pass').style.display = this.state === 'aim' && !this.isAI() ? 'flex' : 'none';
    // arsenal stock badges
    document.querySelectorAll('.wcard').forEach((c, i) => {
      const id = b.weapons[i].id, s = b.stock[id];
      const sp = c.querySelector('.stock');
      if (sp) sp.textContent = s === Infinity ? `${RULES[id].shots}/turno` : `x${s} · ${RULES[id].shots}/turno`;
      c.classList.toggle('empty', s <= 0);
    });
  }
}
