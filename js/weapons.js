// The test weapons: view models, preparation rituals, firing, reloads.
import * as THREE from '../lib/three.module.min.js';

const R = (a, b) => a + Math.random() * (b - a);
const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
const easeOut = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const pulse = (t, a, b) => (t < a || t > b) ? 0 : Math.sin((t - a) / (b - a) * Math.PI);

const matCache = {};
function M(color, opts = {}) {
  const k = color + JSON.stringify(opts);
  if (!matCache[k]) matCache[k] = new THREE.MeshStandardMaterial({ color, roughness: opts.r != null ? opts.r : 0.6, metalness: opts.m || 0, emissive: opts.e || 0, emissiveIntensity: opts.ei || 1 });
  return matCache[k];
}
function box(w, h, d, color, x = 0, y = 0, z = 0, o) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(color, o)); m.position.set(x, y, z); return m; }
function cyl(r1, r2, len, color, x = 0, y = 0, z = 0, axis = 'z', o, seg = 14) {
  const g = new THREE.CylinderGeometry(r1, r2, len, seg);
  if (axis === 'z') g.rotateX(Math.PI / 2); else if (axis === 'x') g.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(g, M(color, o)); m.position.set(x, y, z); return m;
}
const SKIN = 0xe0ac85, SLEEVE = 0xff8a2a, GLOVE = 0x2b2b2b, GUNMETAL = 0x2f3238, WOODC = 0x8a5a32, STRIPE = 0xf2f2f2;

function arm(side = 1, glove = true) {
  const g = new THREE.Group();
  const sleeve = box(0.07, 0.07, 0.3, SLEEVE, 0, -0.02, 0.17);
  sleeve.rotation.x = 0.12;
  const stripe = box(0.073, 0.073, 0.022, STRIPE, 0, -0.012, 0.11, { e: 0x333333 });
  const hand = box(0.075, 0.07, 0.09, glove ? GLOVE : SKIN, 0, 0, -0.03, { r: 0.8 });
  const thumb = box(0.025, 0.03, 0.05, glove ? GLOVE : SKIN, -side * 0.045, 0.01, -0.03);
  g.add(sleeve, stripe, hand, thumb);
  return g;
}

class Weapon {
  constructor(game, def) {
    this.game = game;
    Object.assign(this, def);
    this.model = new THREE.Group();
    this.base = new THREE.Vector3(0.2, -0.2, -0.42);
    this.baseRot = new THREE.Euler(0, 0, 0);
    this.kick = { z: 0, rx: 0, ry: 0, y: 0 };
    this.anim = null; this.queue = [];
    this.isDown = false; this.ready = false;
    this.status = '';
    this.muzzle = new THREE.Object3D();
    this.equipT = 0;
    this.charge = 0;
  }
  play(name, dur, onEnd, events) { this.anim = { name, t: 0, dur, onEnd, events: events ? events.slice().sort((a, b) => a[0] - b[0]) : [] }; }
  busy() { return !!this.anim; }
  equip() {
    this.equipT = 0; this.ready = false; this.isDown = false; this.charge = 0;
    this.model.visible = true; this.equipped = true;
    this.prep();
  }
  prep() { this.play('raise', 0.4, () => { this.ready = true; }); }
  unequip() { this.model.visible = false; this.equipped = false; this.anim = null; this.isDown = false; this.stopLoops && this.stopLoops(); }
  down() { this.isDown = true; }
  up() { this.isDown = false; }
  update(dt) {
    this.equipT += dt;
    if (this.anim) {
      const a = this.anim;
      a.t += dt;
      while (a.events.length && a.t >= a.events[0][0]) a.events.shift()[1]();
      if (a.t >= a.dur) { this.anim = null; if (a.onEnd) a.onEnd(); }
    }
    const k = this.kick, d = Math.exp(-dt * 10);
    k.z *= d; k.rx *= Math.exp(-dt * 8); k.ry *= d; k.y *= d;
    this.pose(dt);
    const g = this.game, p = g.player;
    const bob = p.bobAmp;
    const raise = this.anim && this.anim.name === 'raise' ? 1 - easeOut(this.anim.t / this.anim.dur) : 0;
    this.model.position.set(
      this.base.x + Math.cos(p.bob) * 0.012 * bob + g.sway.x * 0.6,
      this.base.y + Math.abs(Math.sin(p.bob)) * 0.014 * bob - raise * 0.35 + k.y + g.sway.y * 0.6,
      this.base.z + k.z);
    this.model.rotation.set(this.baseRot.x + k.rx + raise * -0.6, this.baseRot.y + k.ry - g.sway.x * 1.5, this.baseRot.z + g.sway.x * 0.5);
  }
  pose() {}
  // [current, capacity] for the HUD, or null for unlimited throwables
  ammo() { return null; }
  // trajectory preview spec for arc weapons (duel), or null
  preview() { return null; }
  muzzleWorld(out = new THREE.Vector3()) {
    this.model.updateMatrixWorld(true);
    this.muzzle.getWorldPosition(out);
    // lab: view-model scene space == camera space; duel: the model hangs from the boss's aim pivot in the world
    return this.game.mode === 'duel' ? out : out.applyMatrix4(this.game.camera.matrixWorld);
  }
  aimDir(spread = 0) {
    const d = new THREE.Vector3(0, 0, -1);
    if (spread) { d.x += R(-spread, spread); d.y += R(-spread, spread); }
    return d.normalize().transformDirection(this.game.aimFrame.matrixWorld);
  }
  // muzzle flash in world + view model light
  flash(size = 0.5, light = 3) {
    const g = this.game, mp = this.muzzleWorld();
    g.fx.flashSprite(mp, size * 6, [1, 0.85, 0.55], 0.06);
    g.fx.light(mp, light * 3, 0.08, 0xffc070);
    g.vmFlash(light);
    for (let i = 0; i < 4; i++) g.fx.smoke(mp, { dark: 0.6, s0: 0.15 * size, s1: 0.9 * size, life: R(0.5, 1.1), vy: R(0.2, 0.6), a: 0.25, spread: 0.2 });
  }
  ejectCasing(color = 0xc9a24a, shape = new THREE.Vector3(0.6, 0.6, 1.6), size = 0.03, side = 1) {
    const g = this.game, cam = g.aimFrame;
    const p = new THREE.Vector3(this.base.x + 0.03, this.base.y + 0.06, this.base.z + 0.05).applyMatrix4(cam.matrixWorld);
    const v = new THREE.Vector3(side * R(1.5, 2.5), R(2, 3), R(-0.4, 0.4)).transformDirection(cam.matrixWorld).multiplyScalar(R(2.2, 3));
    g.fx.chip(p, v, size, color, { shape, life: 6, snd: (pos, s) => g.audio.play('casing', { pos, vol: Math.min(0.5, s * 0.12), ref: 3 }) });
  }
}

// ---------------- 1. Pedra ----------------
class Rock extends Weapon {
  constructor(game) {
    super(game, { id: 'pedra', name: 'Pedra', level: 1, hint: 'Segure para tomar impulso, solte para jogar' });
    this.arm = arm(1, false);
    this.rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.06, 0), M(0x8b8a86, { r: 0.95 }));
    this.rock.position.set(0, 0.05, -0.06);
    this.arm.add(this.rock);
    this.model.add(this.arm);
    this.base.set(0.24, -0.2, -0.42);
  }
  preview() { return { speed: 12 + this.charge * 14, up: 2.5, grav: -13, wind: 0.35, off: [0.15, 0.05, -0.5] }; }
  prep() {
    this.status = 'Pegando uma pedra…';
    this.play('fetch', 0.9, () => { this.ready = true; this.status = this.hint; }, [
      [0.45, () => this.game.audio.play('stones', { vol: 0.35, rate: 1.3 })],
      [0.62, () => this.game.audio.play('hit', { vol: 0.15, rate: 1.6 })],
      [0.8, () => this.game.audio.play('hit', { vol: 0.12, rate: 1.7 })],
    ]);
  }
  down() { super.down(); if (!this.ready || this.anim) return; this.charge = 0; this.status = 'Impulso…'; }
  up() {
    const was = this.isDown; super.up();
    if (!was || !this.ready || this.anim) return;
    const power = this.charge;
    this.ready = false;
    this.play('throw', 0.35, () => this.prep(), [[0.1, () => this.release(power)]]);
  }
  release(power) {
    const g = this.game, cam = g.aimFrame;
    const p = new THREE.Vector3(0.15, 0.05, -0.5).applyMatrix4(cam.matrixWorld);
    const v = this.aimDir(0.01).multiplyScalar(12 + power * 14).add(new THREE.Vector3(0, 2.5, 0));
    g.spawnProjectile('rock', p, v);
    g.onFired(this);
    g.audio.play('whoosh', { vol: 0.5, rate: 1.2 });
    this.rock.visible = false;
    this.charge = 0;
  }
  pose(dt) {
    if (this.isDown && this.ready && !this.anim) this.charge = Math.min(1, this.charge + dt / 0.7);
    const a = this.anim;
    this.arm.position.set(0, 0, 0); this.arm.rotation.set(0, 0, 0);
    const c = this.charge;
    this.arm.position.x = c * 0.06; this.arm.position.z = c * 0.06; this.arm.position.y = c * 0.12; this.arm.rotation.x = c * 0.5; this.arm.rotation.z = -c * 0.3;
    if (a && a.name === 'throw') { const t = easeOut(a.t / a.dur); this.arm.position.x = 0.06 - t * 0.1; this.arm.position.z = 0.06 - t * 0.32; this.arm.rotation.x = 0.5 - t * 0.35; this.arm.rotation.z = -0.3 + t * 0.3; this.arm.position.y = 0.12 - t * 0.2; }
    if (a && a.name === 'fetch') {
      const t = a.t / a.dur;
      this.rock.visible = t > 0.45;
      this.arm.position.y = -pulse(t, 0, 0.6) * 0.35;
      // toss & catch twice
      this.rock.position.y = 0.05 + pulse(t, 0.6, 0.78) * 0.09 + pulse(t, 0.8, 0.96) * 0.05;
      this.rock.rotation.x += dt * 9;
    } else this.rock.position.y = 0.05;
    if (!a && this.ready) this.rock.visible = true;
  }
}

// ---------------- 2. Estilingue ----------------
class Slingshot extends Weapon {
  constructor(game) {
    super(game, { id: 'estilingue', name: 'Estilingue', level: 1, hint: 'Segure para esticar, solte para atirar' });
    this.left = arm(-1, false); this.left.position.set(-0.02, -0.06, 0.12);
    const fork = new THREE.Group();
    fork.add(cyl(0.014, 0.016, 0.12, 0x9c6b3c, 0, 0.0, 0, 'y'));
    const l = cyl(0.011, 0.013, 0.1, 0x9c6b3c, -0.03, 0.09, 0, 'y'); l.rotation.z = 0.45;
    const r = cyl(0.011, 0.013, 0.1, 0x9c6b3c, 0.03, 0.09, 0, 'y'); r.rotation.z = -0.45;
    fork.add(l, r);
    fork.position.set(0, 0.04, -0.06);
    this.left.add(fork);
    this.fork = fork;
    this.model.add(this.left);
    // bands + pouch (pouch moves toward the camera when drawing)
    this.pouch = new THREE.Group();
    this.pouch.add(box(0.03, 0.02, 0.02, 0x5a3a1c));
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), M(0xbfc5cc, { m: 0.9, r: 0.25 }));
    this.pouch.add(this.ball);
    this.model.add(this.pouch);
    this.right = arm(1, false); this.right.scale.setScalar(0.9);
    this.model.add(this.right);
    this.bandL = box(0.006, 0.006, 1, 0xd8392b); this.bandR = box(0.006, 0.006, 1, 0xd8392b);
    this.model.add(this.bandL, this.bandR);
    this.base.set(0.14, -0.15, -0.42);
    this.tipL = new THREE.Vector3(); this.tipR = new THREE.Vector3();
    this.creak = null;
  }
  preview() { return this.charge > 0.05 ? { speed: 16 + Math.min(1, this.charge) * 36, up: 0, grav: -9.81, wind: 0.25, off: [0, 0.02, -0.5] } : null; }
  prep() {
    this.status = 'Testando o elástico…';
    this.play('test', 0.8, () => { this.ready = true; this.status = this.hint; }, [
      [0.1, () => this.game.audio.play('stretch', { vol: 0.25, rate: 1.4 })],
      [0.5, () => this.game.audio.play('snap', { vol: 0.35 })],
    ]);
  }
  down() { super.down(); if (!this.ready || this.anim) return; this.charge = 0; this.game.audio.play('stretch', { vol: 0.35, rate: 1.1 }); }
  up() {
    const was = this.isDown; super.up();
    if (!was || !this.ready || this.anim) return;
    const p = this.charge;
    if (p < 0.08) { this.charge = 0; return; }
    this.fire(p);
  }
  fire(power) {
    const g = this.game;
    this.ready = false;
    const pos = new THREE.Vector3(0, 0.02, -0.5).applyMatrix4(g.aimFrame.matrixWorld);
    const wob = this.charge > 0.85 ? (this.charge - 0.85) * 0.12 : 0;
    g.spawnProjectile('ball', pos, this.aimDir(0.004 + wob).multiplyScalar(16 + power * 36));
    g.onFired(this);
    g.audio.play('snap', { vol: 0.7, rate: 0.9 + power * 0.3 });
    g.audio.play('whoosh', { vol: 0.35 * power, rate: 1.5 });
    g.haptic(0.2 + power * 0.2);
    this.kick.z = 0.03 * power;
    this.charge = 0;
    this.ball.visible = false;
    this.play('reload', 0.75, () => { this.ready = true; this.status = this.hint; }, [[0.45, () => { this.ball.visible = true; this.game.audio.play('click', { vol: 0.12, rate: 1.4 }); }]]);
  }
  pose(dt) {
    if (this.isDown && this.ready && !this.anim) {
      const before = this.charge;
      this.charge = Math.min(1.25, this.charge + dt / 1.1);
      if (this.charge > 0.85) this.game.haptic(0.05);
      if (before < 0.5 && this.charge >= 0.5) this.game.audio.play('stretch', { vol: 0.3, rate: 0.9 });
      this.status = this.charge >= 1 ? 'No limite! (mira tremendo)' : 'Esticando…';
    }
    const c = Math.min(1, this.charge);
    const shake = this.charge > 0.85 ? (this.charge - 0.85) * 0.03 : 0;
    const a = this.anim;
    let draw = c;
    if (a && a.name === 'test') draw = pulse(a.t / a.dur, 0.05, 0.6) * 0.7;
    if (a && a.name === 'reload') draw = 0;
    // left hand holds fork forward
    this.left.position.set(-0.02 + R(-shake, shake), -0.06 + R(-shake, shake), 0.12);
    this.fork.updateMatrixWorld(true);
    this.model.updateMatrixWorld(true);
    // band anchors at the prong tips (in model space)
    this.tipL.set(-0.052, 0.13, -0.06).add(this.left.position);
    this.tipR.set(0.052, 0.13, -0.06).add(this.left.position);
    const snap = a && a.name === 'reload' ? Math.max(0, 1 - a.t / 0.08) : 0;
    const pz = 0.07 + draw * 0.28 - (1 - snap) * 0;
    this.pouch.position.set(0 + R(-shake, shake), 0.13 - draw * 0.03, -0.06 + pz);
    this.right.position.set(0.02, 0.05 - draw * 0.03, this.pouch.position.z + 0.06);
    this.right.rotation.set(0.2, 0, 0);
    if (a && a.name === 'reload') { const t = a.t / a.dur; this.right.position.y -= pulse(t, 0.15, 0.85) * 0.25; }
    for (const [band, tip] of [[this.bandL, this.tipL], [this.bandR, this.tipR]]) {
      const mid = tip.clone().add(this.pouch.position).multiplyScalar(0.5);
      band.position.copy(mid);
      const len = tip.distanceTo(this.pouch.position);
      band.scale.set(1 - draw * 0.4, 1 - draw * 0.4, len);
      band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.pouch.position.clone().sub(tip).normalize());
    }
    this.game.aimWobble = shake * 1.2;
  }
}

// ---------------- 3. Pistola ----------------
class Pistol extends Weapon {
  constructor(game) {
    super(game, { id: 'pistola', name: 'Pistola', level: 1, hint: 'Toque para atirar' });
    this.gun = new THREE.Group();
    this.slide = box(0.035, 0.035, 0.19, GUNMETAL, 0, 0.035, -0.07, { m: 0.6, r: 0.4 });
    this.frame = box(0.032, 0.025, 0.16, 0x1f2125, 0, 0.008, -0.06);
    const grip = box(0.03, 0.09, 0.045, 0x1f2125, 0, -0.04, 0.0); grip.rotation.x = -0.2;
    this.mag = box(0.024, 0.06, 0.035, 0x15171a, 0, -0.05, 0.0); this.mag.rotation.x = -0.2;
    this.gun.add(this.slide, this.frame, grip, this.mag);
    this.muzzle.position.set(0, 0.035, -0.17); this.gun.add(this.muzzle);
    const hand = arm(1); hand.position.set(0, -0.045, 0.03); hand.rotation.x = 0.2;
    this.gun.add(hand);
    this.left = arm(-1); this.left.position.set(-0.05, -0.06, 0.06); this.left.rotation.set(0.2, 0.5, 0.3);
    this.model.add(this.gun, this.left);
    this.base.set(0.2, -0.13, -0.38);
    this.rounds = 12; this.cool = 0;
  }
  ammo() { return [this.rounds, 12]; }
  prep() {
    if (this.rounds <= 0) this.rounds = 12;
    this.status = 'Puxando o ferrolho…';
    this.play('rack', 0.8, () => { this.ready = true; this.status = this.hint; }, [
      [0.35, () => this.game.audio.play('lever', { vol: 0.4, rate: 1.6 })],
      [0.5, () => this.game.audio.play('click', { vol: 0.35, rate: 0.8 })],
    ]);
  }
  down() {
    super.down();
    if (!this.ready || this.anim || this.cool > 0) return;
    const g = this.game;
    this.cool = 0.16;
    this.rounds--;
    const o = g.aimFrame.getWorldPosition(new THREE.Vector3());
    const dir = this.aimDir(0.006);
    g.hitscan(o, dir, { dmg: 26, radius: 0.0, force: 3, tracer: true, from: this.muzzleWorld(), kind: 'bullet' });
    g.onFired(this);
    g.audio.play('pistol', { vol: 0.85, rateJitter: 0.06, reverb: 0.35 });
    this.flash(0.45, 2.5);
    this.ejectCasing();
    this.kick.z = 0.05; this.kick.rx = 0.12;
    g.recoil(0.012, R(-0.004, 0.004));
    g.shake(0.06);
    g.haptic(0.15);
    this.slideBack = 1;
    if (this.rounds <= 0) {
      this.ready = false; this.status = 'Recarregando…';
      this.play('reload', 1.4, () => { this.rounds = 12; this.ready = true; this.status = this.hint; }, [
        [0.15, () => this.game.audio.play('click', { vol: 0.4, rate: 0.7 })],
        [0.8, () => this.game.audio.play('click', { vol: 0.45, rate: 1.1 })],
        [1.15, () => this.game.audio.play('lever', { vol: 0.4, rate: 1.7 })],
      ]);
    }
  }
  pose(dt) {
    this.cool -= dt;
    this.slideBack = Math.max(0, (this.slideBack || 0) - dt * 14);
    let sb = this.slideBack * 0.05;
    const a = this.anim;
    this.mag.position.y = -0.05; this.mag.visible = true;
    this.gun.rotation.set(0, 0, 0);
    if (a && a.name === 'rack') { const t = a.t / a.dur; sb = pulse(t, 0.3, 0.6) * 0.06; this.gun.rotation.z = pulse(t, 0.1, 0.8) * 0.5; }
    if (a && a.name === 'reload') {
      const t = a.t / a.dur;
      this.gun.rotation.z = pulse(t, 0, 1) * 0.6; this.gun.rotation.x = pulse(t, 0, 1) * 0.3;
      this.mag.position.y = -0.05 - pulse(t, 0.05, 0.75) * 0.25;
      sb = t > 0.8 ? pulse(t, 0.8, 0.95) * 0.06 : 0.05;
      this.left.position.y = -0.06 - pulse(t, 0.2, 0.7) * 0.15;
    } else this.left.position.y = -0.06;
    this.slide.position.z = -0.07 + sb;
    if (this.ready) this.status = `${this.rounds}/12`;
  }
}

// ---------------- 3b. Submetralhadora (automática) ----------------
class SMG extends Weapon {
  constructor(game) {
    super(game, { id: 'smg', name: 'Submetralhadora', level: 2, hint: 'Segure para rajada' });
    const g = this.gun = new THREE.Group();
    this.body = box(0.05, 0.06, 0.24, GUNMETAL, 0, 0.03, -0.08, { m: 0.55, r: 0.45 });
    const top = box(0.04, 0.012, 0.2, 0x1f2125, 0, 0.066, -0.08);
    const barrel = cyl(0.011, 0.011, 0.09, 0x1a1b1f, 0, 0.035, -0.24, 'z', { m: 0.7, r: 0.35 });
    const sight = box(0.012, 0.022, 0.012, 0x1a1b1f, 0, 0.08, -0.17);
    const grip = box(0.038, 0.11, 0.05, 0x1f2125, 0, -0.045, -0.02); grip.rotation.x = -0.08;
    this.mag = box(0.03, 0.13, 0.04, 0x15171a, 0, -0.075, -0.02); this.mag.rotation.x = -0.08;
    this.bolt = box(0.014, 0.014, 0.03, 0xb8bcc4, 0.03, 0.05, -0.02, { m: 0.8, r: 0.3 });
    const stock = box(0.012, 0.012, 0.16, 0x2a2c31, 0.03, 0.0, 0.1, { m: 0.5 });
    g.add(this.body, top, barrel, sight, grip, this.mag, this.bolt, stock);
    this.muzzle.position.set(0, 0.035, -0.29); g.add(this.muzzle);
    const rh = arm(1); rh.position.set(0, -0.06, 0.04); rh.rotation.x = 0.25; g.add(rh);
    this.left = arm(-1); this.left.position.set(-0.03, -0.035, -0.12); this.left.rotation.set(0.15, 0.35, 0.25);
    g.add(this.left);
    this.model.add(g);
    this.base.set(0.19, -0.15, -0.36);
    this.cap = 30; this.rounds = 30; this.cool = 0; this.heat = 0; this.burst = 0;
  }
  ammo() { return [this.rounds, this.cap]; }
  prep() {
    if (this.rounds <= 0) this.rounds = this.cap;
    this.status = 'Encaixando o pente e puxando o ferrolho…';
    this.play('rack', 1.0, () => { this.ready = true; this.status = this.hint; }, [
      [0.25, () => this.game.audio.play('click', { vol: 0.45, rate: 0.75 })],
      [0.55, () => this.game.audio.play('lever', { vol: 0.45, rate: 1.5 })],
      [0.75, () => this.game.audio.play('click', { vol: 0.4, rate: 1.2 })],
    ]);
  }
  down() { super.down(); this.burst = 0; this.tryFire(); }
  up() { super.up(); if (this.burst > 0) this.game.audio.play('click', { vol: 0.18, rate: 1.6 }); this.burst = 0; }
  tryFire() {
    const g = this.game;
    if (!this.isDown || !this.ready || this.anim || this.cool > 0 || this.rounds <= 0) return;
    if (g.duel && g.mode === 'duel' && this.burst > 0 && !g.duel.canFire()) { this.isDown = false; return; }
    this.cool += 0.085;               // ~12 tiros por segundo
    this.rounds--; this.burst++;
    // spread "blooms" while the trigger is held
    this.heat = Math.min(1, this.heat + 0.09);
    const o = g.aimFrame.getWorldPosition(new THREE.Vector3());
    const dir = this.aimDir(0.006 + this.heat * 0.03);
    g.hitscan(o, dir, { dmg: 17, force: 2.2, tracer: this.burst % 2 === 1, from: this.muzzleWorld(), kind: 'smg', quiet: this.burst % 3 !== 1 });
    g.onFired(this);
    g.audio.play('gunsharp', { vol: 0.55, rate: 1.35, rateJitter: 0.07, reverb: 0.3 });
    g.audio.play('pistol', { vol: 0.4, rate: 1.25, rateJitter: 0.06 });
    const mp = this.muzzleWorld();
    g.fx.flashSprite(mp, 2.4 + Math.random(), [1, 0.85, 0.5], 0.04);
    g.fx.light(mp, 5, 0.05, 0xffc070);
    g.vmFlash(1.6);
    if (this.burst % 3 === 0) g.fx.smoke(mp, { dark: 0.6, s0: 0.08, s1: 0.6, life: R(0.5, 0.9), vy: R(0.2, 0.5), a: 0.22, spread: 0.15 });
    this.ejectCasing(0xc9a24a, new THREE.Vector3(0.6, 0.6, 1.4), 0.024);
    this.kick.z = 0.035; this.kick.rx = 0.06 + Math.random() * 0.03; this.kick.ry = R(-0.03, 0.03);
    this.boltBack = 1;
    g.recoil(0.0045 + this.heat * 0.004, R(-0.004, 0.004));
    g.shake(0.035);
    if (this.burst % 2 === 1) g.haptic(0.12);
    if (this.rounds <= 0) this.reload();
  }
  reload() {
    this.ready = false; this.isDown = false; this.status = 'Trocando o pente…';
    this.game.audio.play('click', { vol: 0.25, rate: 1.4 });
    this.play('reload', 1.6, () => { this.rounds = this.cap; this.ready = true; this.status = this.hint; }, [
      [0.2, () => this.game.audio.play('click', { vol: 0.45, rate: 0.7 })],
      [0.4, () => this.game.audio.play('metaldrop', { vol: 0.25, rate: 1.6 })],
      [0.95, () => this.game.audio.play('click', { vol: 0.5, rate: 1.05 })],
      [1.3, () => this.game.audio.play('lever', { vol: 0.45, rate: 1.6 })],
    ]);
  }
  pose(dt) {
    this.cool = Math.max(this.isDown ? -0.05 : 0, this.cool - dt);
    if (!this.isDown) this.heat = Math.max(0, this.heat - dt * 2.2);
    // automatic fire: keep shooting while held (several shots per frame at low fps)
    let guard = 3;
    while (this.isDown && this.cool <= 0 && guard-- > 0 && this.ready && !this.anim) this.tryFire();
    this.boltBack = Math.max(0, (this.boltBack || 0) - dt * 22);
    const a = this.anim;
    this.gun.rotation.set(0, 0, 0);
    this.mag.position.y = -0.075; this.mag.visible = true;
    let bb = this.boltBack * 0.025;
    if (a && a.name === 'rack') { const t = a.t / a.dur; this.gun.rotation.z = pulse(t, 0.05, 0.95) * 0.45; this.mag.position.y = -0.075 - (1 - easeOut(t / 0.4)) * 0.12; bb = pulse(t, 0.45, 0.75) * 0.045; }
    if (a && a.name === 'reload') {
      const t = a.t / a.dur;
      this.gun.rotation.z = pulse(t, 0, 1) * 0.55; this.gun.rotation.x = pulse(t, 0, 1) * 0.25;
      this.mag.position.y = -0.075 - pulse(t, 0.12, 0.8) * 0.3;
      this.mag.visible = !(t > 0.35 && t < 0.5);
      bb = pulse(t, 0.78, 0.92) * 0.045;
      this.left.position.y = -0.035 - pulse(t, 0.2, 0.75) * 0.18;
    } else this.left.position.y = -0.035;
    this.bolt.position.z = -0.02 + bb;
    if (this.ready) this.status = `${this.rounds}/${this.cap}`;
  }
  unequip() { super.unequip(); this.heat = 0; this.burst = 0; }
}

// ---------------- 4. Shotgun 12 ----------------
class Shotgun extends Weapon {
  constructor(game) {
    super(game, { id: 'shotgun', name: 'Shotgun 12', level: 2, hint: 'Toque para atirar' });
    const g = this.gun = new THREE.Group();
    g.add(cyl(0.018, 0.018, 0.62, GUNMETAL, 0, 0.03, -0.38, 'z', { m: 0.6, r: 0.4 }));
    g.add(cyl(0.015, 0.015, 0.45, 0x26282d, 0, 0.0, -0.3, 'z'));
    g.add(box(0.05, 0.06, 0.2, 0x26282d, 0, 0.02, -0.04, { m: 0.5 }));
    const stock = box(0.045, 0.07, 0.25, WOODC, 0, -0.01, 0.16); stock.rotation.x = 0.12; g.add(stock);
    this.pump = box(0.042, 0.04, 0.14, 0x9c6b3c, 0, -0.005, -0.3, { r: 0.7 });
    g.add(this.pump);
    this.muzzle.position.set(0, 0.03, -0.7); g.add(this.muzzle);
    const rh = arm(1); rh.position.set(0, -0.04, 0.08); rh.rotation.x = 0.25; g.add(rh);
    this.lh = arm(-1); this.lh.rotation.set(0.1, 0.15, 0); g.add(this.lh);
    this.model.add(g);
    this.base.set(0.17, -0.14, -0.3);
    this.baseRot.set(0, 0.04, 0);
    this.shells = 6; this.cool = 0;
  }
  ammo() { return [this.shells, 6]; }
  prep() {
    this.status = 'Engatando: tchk-tchk';
    this.play('pump', 0.6, () => { this.ready = true; this.status = this.hint; }, [
      [0.05, () => this.game.audio.play('pump', { vol: 0.75, rate: 1 })],
      [0.25, () => this.ejectCasing(0xc8352a, new THREE.Vector3(0.8, 0.8, 1.6), 0.045)],
    ]);
  }
  down() {
    super.down();
    if (!this.ready || this.anim) return;
    const g = this.game;
    this.shells--;
    const o = g.aimFrame.getWorldPosition(new THREE.Vector3());
    const from = this.muzzleWorld();
    for (let i = 0; i < 10; i++) g.hitscan(o, this.aimDir(0.065), { dmg: 15, force: 2.2, tracer: i < 4, from, kind: 'pellet', quiet: i > 2 });
    g.onFired(this);
    g.audio.play('shotgun', { vol: 1, rate: 0.95, reverb: 0.45 });
    g.audio.thump(0.35);
    this.flash(1, 5);
    for (let i = 0; i < 6; i++) g.fx.smoke(from, { dark: 0.7, s0: 0.2, s1: 1.4, life: R(0.8, 1.6), vy: 0.4, a: 0.3, vx: 0, vz: 0, spread: 0.3 });
    this.kick.z = 0.12; this.kick.rx = 0.3;
    g.recoil(0.05, R(-0.01, 0.01));
    g.shake(0.25);
    g.haptic(0.55);
    this.ready = false;
    if (this.shells <= 0) this.reload();
    else this.play('pump', 0.62, () => { this.ready = true; this.status = this.hint; }, [
      [0.18, () => this.game.audio.play('pump', { vol: 0.7 })],
      [0.36, () => { this.ejectCasing(0xc8352a, new THREE.Vector3(0.8, 0.8, 1.6), 0.045); this.game.haptic(0.1); }],
    ]);
  }
  reload() {
    this.status = 'Colocando cartuchos…';
    const ev = [];
    for (let i = 0; i < 6; i++) ev.push([0.25 + i * 0.28, () => { this.game.audio.play('click', { vol: 0.35, rate: 0.75 }); this.shells = Math.min(6, this.shells + 1); this.status = `Cartuchos ${this.shells}/6`; }]);
    ev.push([2.05, () => this.game.audio.play('pump', { vol: 0.7 })]);
    this.play('reload', 2.4, () => { this.ready = true; this.status = this.hint; }, ev);
  }
  pose() {
    const a = this.anim;
    let pz = 0;
    this.gun.rotation.set(0, 0, 0);
    if (a && a.name === 'pump') { const t = a.t / a.dur; pz = pulse(t, 0.12, 0.9) * 0.1; }
    if (a && a.name === 'reload') {
      const t = a.t / a.dur;
      this.gun.rotation.z = pulse(t, 0, 1) * 0.5; this.gun.rotation.x = pulse(t, 0, 1) * 0.15;
      if (t > 0.82) pz = pulse(t, 0.84, 1) * 0.1;
      const ins = (a.t - 0.25) % 0.28;
      this.lh.position.set(-0.03, -0.06 - (a.t < 2.0 ? pulse(ins, 0, 0.28) * 0.08 : 0), -0.12);
    } else this.lh.position.set(0, -0.035, -0.3 + pz);
    this.pump.position.z = -0.3 + pz;
    if (this.ready) this.status = `Cartuchos ${this.shells}/6`;
  }
}

// ---------------- 5. Rifle .50 ----------------
class Rifle50 extends Weapon {
  constructor(game) {
    super(game, { id: 'rifle50', name: 'Rifle .50', level: 3, hint: 'Use a mira (zoom). Atravessa paredes' });
    const g = this.gun = new THREE.Group();
    g.add(cyl(0.022, 0.022, 0.9, 0x3a3f36, 0, 0.03, -0.5, 'z', { m: 0.4, r: 0.5 }));
    g.add(box(0.06, 0.04, 0.07, 0x2a2d28, 0, 0.03, -0.97));
    g.add(box(0.07, 0.08, 0.32, 0x4a5240, 0, 0.01, -0.05, { r: 0.7 }));
    const stock = box(0.05, 0.09, 0.28, 0x4a5240, 0, -0.01, 0.24); g.add(stock);
    g.add(cyl(0.028, 0.028, 0.26, 0x1a1a1a, 0, 0.1, -0.08, 'z', { m: 0.5 }));
    g.add(cyl(0.036, 0.03, 0.05, 0x1a1a1a, 0, 0.1, -0.22, 'z'));
    this.bolt = new THREE.Group();
    this.bolt.add(cyl(0.008, 0.008, 0.07, 0xbfc5cc, 0.04, 0, 0, 'x', { m: 0.9 }));
    this.bolt.add(new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), M(0x1a1a1a)));
    this.bolt.children[1].position.set(0.075, 0, 0);
    this.bolt.position.set(0.02, 0.04, 0.05);
    g.add(this.bolt);
    this.legs = [];
    for (const s of [-1, 1]) {
      const leg = new THREE.Group();
      leg.add(cyl(0.007, 0.007, 0.2, 0x1a1a1a, 0, -0.1, 0, 'y'));
      leg.position.set(s * 0.02, 0.0, -0.7);
      leg.userData.s = s;
      g.add(leg); this.legs.push(leg);
    }
    this.muzzle.position.set(0, 0.03, -1.01); g.add(this.muzzle);
    const rh = arm(1); rh.position.set(0, -0.05, 0.12); rh.rotation.x = 0.3; g.add(rh);
    this.lh = arm(-1); this.lh.position.set(-0.02, -0.06, 0.2); this.lh.rotation.set(0.3, -0.2, 0); g.add(this.lh);
    this.model.add(g);
    this.base.set(0.17, -0.15, -0.26);
    this.mag = 5;
  }
  ammo() { return [this.mag, 5]; }
  prep() {
    this.status = 'Abrindo o bipé e puxando o ferrolho…';
    this.play('setup', 1.7, () => { this.ready = true; this.status = this.hint; }, [
      [0.2, () => this.game.audio.play('click', { vol: 0.4, rate: 0.6 })],
      [0.45, () => this.game.audio.play('click', { vol: 0.4, rate: 0.55 })],
      [0.95, () => this.game.audio.play('lever', { vol: 0.6, rate: 0.85 })],
      [1.35, () => this.game.audio.play('lever', { vol: 0.6, rate: 1.1 })],
    ]);
  }
  down() {
    super.down();
    if (!this.ready || this.anim) return;
    const g = this.game;
    const o = g.aimFrame.getWorldPosition(new THREE.Vector3());
    const dir = this.aimDir(g.zoomed ? 0 : 0.012);
    const hit50 = g.hitscan(o, dir, { dmg: 400, force: 18, tracer: true, tracerW: 0.06, from: this.muzzleWorld(), kind: 'fifty', penetrate: 1600 });
    g.onFired(this, { hitscan: hit50 ? (hit50.p || hit50.point) : null, from: this.muzzleWorld() });
    g.audio.play('heavyshot', { vol: 1, rate: 1.2, reverb: 0.6 });
    g.audio.play('gunsharp', { vol: 0.8, rate: 0.75, reverb: 0.4 });
    g.audio.thump(0.7);
    this.flash(1.4, 7);
    // muzzle brake side blasts + ground dust ring around the shooter
    const mp = this.muzzleWorld();
    const right = new THREE.Vector3(1, 0, 0).transformDirection(g.aimFrame.matrixWorld);
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) g.fx.smoke(mp, { dark: 0.75, s0: 0.2, s1: 1.6, life: R(0.6, 1.2), vx: right.x * s * R(3, 6), vz: right.z * s * R(3, 6), vy: 0.3, a: 0.35, drag: 2.5 });
    const feet = g.player.pos.clone();
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * Math.PI * 2;
      g.fx.dust(feet.clone().add(new THREE.Vector3(Math.cos(a) * 0.6, 0.1, Math.sin(a) * 0.6)), [0.62, 0.58, 0.5], { vx: Math.cos(a) * 4, vz: Math.sin(a) * 4, vy: 0.3, a: 0.35, s1: 2.2 });
    }
    this.kick.z = 0.2; this.kick.rx = 0.45;
    g.recoil(0.09, R(-0.015, 0.015));
    g.shake(0.45); g.fovPunch(6);
    g.haptic(0.9);
    this.ready = false; this.status = 'Ferrolho…';
    this.mag--;
    const afterBolt = () => {
      if (this.mag > 0) { this.ready = true; this.status = this.hint; return; }
      this.status = 'Trocando o carregador…';
      this.play('magswap', 1.6, () => { this.mag = 5; this.ready = true; this.status = this.hint; }, [
        [0.2, () => this.game.audio.play('click', { vol: 0.5, rate: 0.6 })],
        [0.9, () => this.game.audio.play('metaldrop', { vol: 0.3, rate: 1.4 })],
        [1.25, () => this.game.audio.play('click', { vol: 0.5, rate: 0.8 })],
      ]);
    };
    this.play('bolt', 1.15, afterBolt, [
      [0.35, () => this.game.audio.play('lever', { vol: 0.6, rate: 0.8 })],
      [0.55, () => { this.ejectCasing(0xc9a24a, new THREE.Vector3(0.7, 0.7, 2.4), 0.06); }],
      [0.8, () => this.game.audio.play('lever', { vol: 0.6, rate: 1.05 })],
    ]);
  }
  pose() {
    const a = this.anim;
    let legT = 1, boltUp = 0, boltBack = 0;
    this.gun.rotation.set(0, 0, 0);
    if (a && a.name === 'setup') {
      const t = a.t;
      legT = ease(t / 0.6);
      this.gun.rotation.z = pulse(t, 0, 0.7) * 0.35;
      boltUp = pulse(t, 0.85, 1.55); boltBack = pulse(t, 1.0, 1.45);
    }
    if (a && a.name === 'bolt') { const t = a.t; boltUp = pulse(t, 0.2, 1.0); boltBack = pulse(t, 0.38, 0.85); this.gun.rotation.z = pulse(t, 0.1, 1.1) * 0.12; }
    if (a && a.name === 'magswap') { const t = a.t / a.dur; this.gun.rotation.z = pulse(t, 0, 1) * 0.45; this.gun.rotation.x = pulse(t, 0, 1) * 0.2; }
    for (const leg of this.legs) { leg.rotation.x = -1.4 * (1 - legT); leg.rotation.z = leg.userData.s * 0.35 * legT; }
    this.bolt.rotation.z = boltUp * 1.2;
    this.bolt.position.z = 0.05 + boltBack * 0.09;
    this.lh.position.set(0.05 + (boltUp > 0 ? 0.04 : -0.07), -0.04 + (boltUp > 0 ? 0.05 : -0.02), boltUp > 0 ? 0.09 + boltBack * 0.09 : 0.2);
    this.model.visible = !this.game.zoomed || !!this.anim;
  }
}

// ---------------- 6. Granada ----------------
class Grenade extends Weapon {
  constructor(game) {
    super(game, { id: 'granada', name: 'Granada', level: 3, hint: 'Segure: puxa o pino e cozinha. Solte para jogar' });
    this.rh = arm(1); this.model.add(this.rh);
    const gr = this.gren = new THREE.Group();
    gr.add(new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), M(0x4c5e3a, { r: 0.7 })));
    gr.children[0].scale.set(1, 1.2, 1);
    gr.add(cyl(0.02, 0.02, 0.03, 0x8a8f96, 0, 0.06, 0, 'y', { m: 0.8 }));
    this.spoon = box(0.012, 0.08, 0.008, 0x8a8f96, 0.03, 0.03, 0, { m: 0.8 }); this.spoon.rotation.z = -0.25;
    gr.add(this.spoon);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 6, 14), M(0xc0c4c8, { m: 0.9 }));
    this.ring.position.set(-0.025, 0.075, 0);
    gr.add(this.ring);
    gr.position.set(0, 0.05, -0.06);
    this.rh.add(gr);
    this.lh = arm(-1); this.lh.position.set(-0.12, -0.05, 0.02); this.model.add(this.lh);
    this.base.set(0.24, -0.19, -0.42);
    this.fuse = 0; this.cooking = false; this.lastTick = 0;
  }
  preview() { return { speed: 17, up: 3.5, grav: -13, wind: 0.3, off: [0.12, 0.06, -0.5] }; }
  prep() { this.ring.visible = true; this.spoon.visible = true; this.gren.visible = true; this.play('raise', 0.45, () => { this.ready = true; this.status = this.hint; }); }
  down() {
    super.down();
    if (!this.ready || this.anim || this.cooking) return;
    this.ready = false;
    this.play('pin', 0.35, () => { this.cooking = true; this.fuse = 3.0; this.lastTick = 3; if (!this.isDown) this.throwIt(); }, [
      [0.18, () => {
        const g = this.game;
        g.audio.play('click', { vol: 0.5, rate: 1.8 });
        g.audio.play('casing', { vol: 0.3, rate: 1.5 });
        this.ring.visible = false;
        const p = new THREE.Vector3(-0.05, 0.0, -0.4).applyMatrix4(g.aimFrame.matrixWorld);
        g.fx.chip(p, new THREE.Vector3(R(-1, 1), 2.5, R(-1, 1)), 0.03, 0xc0c4c8, { shape: new THREE.Vector3(1, 0.3, 1), life: 6 });
        g.haptic(0.12);
      }],
    ]);
  }
  up() {
    const was = this.isDown; super.up();
    if (was && this.cooking) this.throwIt();
  }
  throwIt() {
    if (!this.cooking) return;
    this.cooking = false;
    this.play('throw', 0.3, () => {
      this.gren.visible = false;
      this.status = 'Pegando outra…';
      this.play('next', 0.6, () => this.prep());
    }, [[0.1, () => {
      const g = this.game;
      const p = new THREE.Vector3(0.12, 0.06, -0.5).applyMatrix4(g.aimFrame.matrixWorld);
      const v = this.aimDir(0.01).multiplyScalar(17).add(new THREE.Vector3(0, 3.5, 0));
      g.spawnProjectile('grenade', p, v, { fuse: this.fuse });
      g.onFired(this);
      g.audio.play('whooshbig', { vol: 0.45, rate: 1.3 });
      g.audio.play('casing', { vol: 0.25, rate: 0.8 });
      this.gren.visible = false;
    }]]);
  }
  pose(dt) {
    if (this.cooking) {
      this.fuse -= dt;
      if (Math.ceil(this.fuse) < this.lastTick) { this.lastTick = Math.ceil(this.fuse); this.game.audio.beep(1500, 0.05, 0.12); this.game.haptic(0.08); }
      this.status = `Pino puxado: ${Math.max(0, this.fuse).toFixed(1)} s — solte!`;
      if (this.fuse < 0.35) this.throwIt();
    }
    const a = this.anim;
    this.rh.position.set(0, 0, 0); this.rh.rotation.set(0, 0, 0);
    this.lh.position.set(-0.12, -0.05, 0.02);
    if (a && a.name === 'pin') { const t = a.t / a.dur; this.lh.position.set(-0.04 - pulse(t, 0.4, 1) * 0.1, 0.0 + pulse(t, 0, 0.6) * 0.04, -0.03); }
    if (this.cooking && this.isDown) { this.rh.position.set(0.07, 0.1, 0.03); this.rh.rotation.x = 0.55; this.rh.rotation.z = -0.3; }
    if (a && a.name === 'throw') { const t = easeOut(a.t / a.dur); this.rh.position.set(0.07 - t * 0.1, 0.1 - t * 0.2, 0.03 - t * 0.32); this.rh.rotation.x = 0.55 - t * 0.4; this.rh.rotation.z = -0.3 + t * 0.3; }
    if (a && a.name === 'next') { const t = a.t / a.dur; this.rh.position.y = -0.3 * (1 - t); this.gren.visible = t > 0.3; this.ring.visible = true; }
  }
}

// ---------------- 7. Canhão ----------------
class Cannon extends Weapon {
  constructor(game) {
    super(game, { id: 'canhao', name: 'Canhão', level: 4, hint: 'Toque para acender o pavio' });
    const c = this.cannon = new THREE.Group();
    const barrel = cyl(0.1, 0.14, 1.0, 0x50555f, 0, 0.0, -0.35, 'z', { m: 0.6, r: 0.42 });
    c.add(barrel);
    c.add(cyl(0.155, 0.155, 0.08, 0xc9a24a, 0, 0, 0.12, 'z', { m: 0.9, r: 0.3 }));
    c.add(cyl(0.125, 0.125, 0.05, 0xc9a24a, 0, 0, -0.84, 'z', { m: 0.9, r: 0.3 }));
    c.add(cyl(0.135, 0.135, 0.04, 0xc9a24a, 0, 0, -0.3, 'z', { m: 0.9, r: 0.3 }));
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), M(0x454a54, { m: 0.85, r: 0.3 })); knob.position.set(0, 0, 0.2); c.add(knob);
    const carriage = box(0.3, 0.12, 0.7, 0xa8744a, 0, -0.17, -0.12, { r: 0.85 }); c.add(carriage);
    for (const s of [-1, 1]) for (const z of [-0.35, 0.15]) {
      const wh = cyl(0.12, 0.12, 0.05, 0x7a5030, s * 0.18, -0.22, z, 'x', { r: 0.9 }, 16);
      c.add(wh);
    }
    // fuse: small curve on top near the back
    this.fusePts = [new THREE.Vector3(0.0, 0.14, 0.06), new THREE.Vector3(0.03, 0.2, 0.1), new THREE.Vector3(0.0, 0.24, 0.16), new THREE.Vector3(-0.03, 0.26, 0.2)];
    this.fuseCurve = new THREE.CatmullRomCurve3(this.fusePts);
    this.fuseMesh = new THREE.Mesh(new THREE.TubeGeometry(this.fuseCurve, 12, 0.007, 5), M(0x6e5a3a, { r: 1 }));
    c.add(this.fuseMesh);
    this.sparkMesh = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
    this.sparkGlow = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff9a30, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.sparkMesh.add(this.sparkGlow); this.sparkMesh.visible = false;
    c.add(this.sparkMesh);
    this.muzzle.position.set(0, 0, -0.88); c.add(this.muzzle);
    this.torch = arm(1, true); this.torch.position.set(0.3, -0.05, 0.25);
    const stick = cyl(0.008, 0.008, 0.25, 0x5a3a1c, 0, 0, -0.12, 'z'); this.torch.add(stick);
    this.ember = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff7a20 }));
    this.ember.position.set(0, 0, -0.25); this.torch.add(this.ember);
    c.add(this.torch);
    this.model.add(c);
    this.base.set(0.3, -0.44, -0.8);
    this.baseRot.set(0.04, 0.12, 0);
    this.lit = false; this.fuseT = 0; this.hissH = null;
  }
  ammo() { return [this.ready || this.lit ? 1 : 0, 1]; }
  preview() { return { speed: 62, up: 1.5, grav: -13, wind: 0.08, off: null }; }
  prep() {
    this.status = 'Posicionando o canhão…';
    this.game.audio.play('woodfall', { vol: 0.3, rate: 0.7 });
    this.play('roll', 0.9, () => { this.ready = true; this.status = this.hint; }, [[0.7, () => this.game.audio.play('bigimpact', { vol: 0.25, rate: 1.2 })]]);
  }
  stopLoops() { if (this.hissH) { this.hissH.stop(); this.hissH = null; } this.lit = false; this.sparkMesh.visible = false; }
  down() {
    super.down();
    if (!this.ready || this.anim || this.lit) return;
    this.ready = false; this.lit = true; this.fuseT = 0;
    this.status = 'Pavio aceso… tssss';
    this.hissH = this.game.audio.hiss({ freq: 3500, q: 0.9, vol: 0.22 });
    this.game.audio.play('click', { vol: 0.3, rate: 0.5 });
  }
  fire() {
    const g = this.game;
    this.lit = false; this.sparkMesh.visible = false;
    if (this.hissH) { this.hissH.stop(0.02); this.hissH = null; }
    const mp = this.muzzleWorld();
    const dir = this.aimDir(0.004);
    g.spawnProjectile('cannonball', mp.clone().addScaledVector(dir, 0.3), dir.clone().multiplyScalar(62).add(new THREE.Vector3(0, 1.5, 0)));
    g.onFired(this);
    g.audio.play('cannon', { vol: 1, idx: 0, rate: 1, reverb: 0.7 });
    g.audio.play('cannon', { vol: 0.8, idx: 1 + (Math.random() * 2 | 0), rate: 0.85, reverb: 0.3 });
    g.audio.thump(1.0);
    this.flash(2.4, 10);
    for (let i = 0; i < 26; i++) {
      const v = dir.clone().multiplyScalar(R(2, 9));
      g.fx.smoke(mp, { dark: R(0.78, 0.92), s0: 0.4, s1: R(2.5, 4.5), life: R(2.5, 5), vx: v.x, vy: v.y + R(0.2, 0.8), vz: v.z, a: 0.6, drag: 1.6, spread: 0.4 });
    }
    for (let i = 0; i < 8; i++) g.fx.fireball(mp.clone().addScaledVector(dir, R(0.2, 1.2)), { s0: 0.5, s1: 1.6, life: 0.25, vx: dir.x * 6, vy: dir.y * 6, vz: dir.z * 6 });
    this.kick.z = 0.35; this.kick.rx = 0.25;
    g.recoil(0.06, 0);
    g.shake(0.7); g.fovPunch(8);
    g.haptic(1.1);
    this.status = 'Recarregando…';
    this.play('recoil', 2.2, () => { this.ready = true; this.status = this.hint; }, [
      [0.3, () => this.game.audio.play('woodfall', { vol: 0.25, rate: 0.6 })],
      [1.2, () => this.game.audio.play('metaldrop', { vol: 0.35, rate: 0.6 })],
      [1.8, () => this.game.audio.play('woodhit', { vol: 0.35, rate: 0.6 })],
    ]);
  }
  pose(dt) {
    const a = this.anim;
    this.cannon.position.set(0, 0, 0);
    this.torch.position.set(0.3, -0.05, 0.25); this.torch.rotation.set(0, 0, 0);
    if (a && a.name === 'roll') { const t = easeOut(a.t / a.dur); this.cannon.position.z = (1 - t) * 0.8; this.cannon.position.y = -(1 - t) * 0.3; }
    if (a && a.name === 'recoil') { const t = a.t / a.dur; this.cannon.position.z = t < 0.15 ? easeOut(t / 0.15) * 0.45 : 0.45 * (1 - ease((t - 0.35) / 0.6)); }
    if (this.lit) {
      this.fuseT += dt;
      const k = Math.min(1, this.fuseT / 1.6);
      // spark travels from the tip of the fuse to the touch hole
      const p = this.fuseCurve.getPoint(1 - k);
      this.sparkMesh.visible = true;
      this.sparkMesh.position.copy(p);
      this.sparkGlow.scale.setScalar(0.8 + Math.random() * 0.8);
      if (this.hissH) this.hissH.set(3000 + k * 3500, 0.18 + k * 0.2);
      if (Math.random() < 0.6) {
        const wp = p.clone(); this.cannon.localToWorld(wp);
        if (this.game.mode !== 'duel') wp.applyMatrix4(this.game.camera.matrixWorld);
        this.game.fx.spark(wp, new THREE.Vector3(R(-1, 1), R(1, 3), R(-1, 1)), { life: R(0.2, 0.5), size: 0.05 });
      }
      if (Math.random() < 0.2) this.game.haptic(0.04);
      this.torch.position.set(0.12, 0.12, 0.3); this.torch.rotation.set(-0.3, 0.4, 0);
      this.status = `Pavio aceso… ${Math.max(0, 1.6 - this.fuseT).toFixed(1)} s`;
      if (k >= 1) this.fire();
    }
    this.ember.material.color.setHSL(0.07, 1, 0.45 + Math.random() * 0.15);
  }
}

// ---------------- 8. Lança-foguetes ----------------
class RocketLauncher extends Weapon {
  constructor(game) {
    super(game, { id: 'rpg', name: 'Lança-foguetes', level: 4, hint: 'Toque para disparar' });
    const g = this.gun = new THREE.Group();
    g.add(cyl(0.055, 0.055, 1.0, 0x55603f, 0, 0, -0.2, 'z', { r: 0.75 }));
    g.add(cyl(0.065, 0.065, 0.12, 0x3f4830, 0, 0, 0.3, 'z'));
    g.add(cyl(0.062, 0.062, 0.06, 0x3f4830, 0, 0, -0.7, 'z'));
    g.add(box(0.03, 0.05, 0.08, 0x1a1a1a, 0.07, 0.04, -0.15));
    g.add(box(0.03, 0.1, 0.04, 0x1a1a1a, 0, -0.1, -0.05));
    this.warhead = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 14), M(0x7a8a55, { r: 0.6 }));
    cone.rotation.x = -Math.PI / 2; cone.position.z = -0.1;
    this.warhead.add(cone, cyl(0.06, 0.06, 0.08, 0x9a2b20, 0, 0, 0.02, 'z'));
    this.warhead.position.set(0, 0, -0.75);
    g.add(this.warhead);
    this.muzzle.position.set(0, 0, -0.95); g.add(this.muzzle);
    const rh = arm(1); rh.position.set(0, -0.12, 0.02); rh.rotation.x = 0.4; g.add(rh);
    const lh = arm(-1); lh.position.set(-0.04, -0.1, -0.32); lh.rotation.set(0.3, 0.2, 0); g.add(lh);
    this.model.add(g);
    this.base.set(0.25, -0.13, -0.28);
    this.baseRot.set(0, 0.07, 0);
  }
  ammo() { return [this.warhead.visible ? 1 : 0, 1]; }
  prep() {
    this.status = 'No ombro… travando a mira';
    const a = this.game.audio;
    this.play('shoulder', 1.2, () => { this.ready = true; this.status = this.hint; }, [
      [0.2, () => a.play('click', { vol: 0.4, rate: 0.6 })],
      [0.55, () => a.beep(1600, 0.05)], [0.8, () => a.beep(1600, 0.05)], [0.98, () => a.beep(1600, 0.05)], [1.1, () => a.beep(2100, 0.12)],
    ]);
  }
  down() {
    super.down();
    if (!this.ready || this.anim) return;
    const g = this.game;
    const mp = this.muzzleWorld();
    const dir = this.aimDir(0.004);
    g.spawnProjectile('rocket', mp.clone().addScaledVector(dir, 0.4), dir.clone().multiplyScalar(30));
    g.onFired(this);
    g.audio.play('pop', { vol: 0.9, rate: 0.7, reverb: 0.5 });
    g.audio.play('whooshbig', { vol: 0.7, rate: 0.7 });
    g.audio.thump(0.4);
    this.flash(1.2, 6);
    // backblast behind the shooter
    const back = dir.clone().negate();
    const bp = g.aimFrame.getWorldPosition(new THREE.Vector3()).addScaledVector(back, 0.8);
    for (let i = 0; i < 18; i++) g.fx.smoke(bp, { dark: R(0.7, 0.85), s0: 0.4, s1: R(2, 3.5), life: R(1.5, 3), vx: back.x * R(4, 10), vy: R(0, 1), vz: back.z * R(4, 10), a: 0.5, drag: 1.8, spread: 0.5 });
    for (let i = 0; i < 6; i++) g.fx.fireball(bp, { s0: 0.4, s1: 1.4, life: 0.25, vx: back.x * 8, vz: back.z * 8 });
    this.warhead.visible = false;
    this.kick.z = 0.1; this.kick.rx = 0.12;
    g.recoil(0.03, 0); g.shake(0.35); g.haptic(0.6);
    this.ready = false; this.status = 'Recarregando…';
    this.play('reload', 1.8, () => { this.ready = true; this.status = this.hint; }, [
      [0.6, () => { this.warhead.visible = true; }],
      [1.25, () => this.game.audio.play('metaldrop', { vol: 0.4, rate: 0.9 })],
      [1.55, () => this.game.audio.play('click', { vol: 0.4, rate: 0.6 })],
    ]);
  }
  pose() {
    const a = this.anim;
    this.gun.rotation.set(0, 0, 0); this.gun.position.set(0, 0, 0);
    this.warhead.position.z = -0.75;
    if (a && a.name === 'shoulder') { const t = easeOut(a.t / 0.6); this.gun.rotation.z = (1 - t) * 0.9; this.gun.position.y = -(1 - t) * 0.3; }
    if (a && a.name === 'reload') {
      const t = a.t / a.dur;
      this.gun.rotation.x = pulse(t, 0, 1) * 0.35; this.gun.position.y = -pulse(t, 0, 1) * 0.08;
      if (t > 0.33) this.warhead.position.z = -0.75 - (1 - ease((t - 0.33) / 0.5)) * 0.4;
    }
  }
}

export function setSleeveColor(hex) { M(SLEEVE).color.setHex(hex); }

export function makeWeapons(game) {
  return [Rock, Slingshot, Pistol, SMG, Shotgun, Rifle50, Grenade, Cannon, RocketLauncher].map(C => new C(game));
}
