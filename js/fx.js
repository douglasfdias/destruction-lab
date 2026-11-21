// Visual effects: particles (smoke, fire, sparks, dust, glass), chips, decals, flashes, shockwaves, tracers, fires.
import * as THREE from '../lib/three.module.min.js';
import { VOX } from './world.js';

const TILE = { SMOKE: 0, FIRE: 1, SPARK: 2, DUST: 3, SHARD: 4, RING: 5 };
export { TILE };

const vtx = `
attribute float aSize; attribute vec4 aColor; attribute float aTile; attribute float aRot;
varying vec4 vColor; varying float vTile; varying float vRot;
uniform float uScale;
void main(){
  vColor = aColor; vTile = aTile; vRot = aRot;
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const frg = `
uniform sampler2D uMap;
varying vec4 vColor; varying float vTile; varying float vRot;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  p = vec2(c*p.x - s*p.y, s*p.x + c*p.y) + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) discard;
  float col = mod(vTile, 4.0), row = floor(vTile / 4.0);
  vec4 t = texture2D(uMap, vec2((col + p.x) / 4.0, 1.0 - (row + p.y) / 2.0));
  gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.01) discard;
}`;

class ParticleSystem {
  constructor(scene, atlas, max, additive) {
    this.max = max;
    this.n = 0;
    this.P = []; // particle objects
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.size = new Float32Array(max); this.col = new Float32Array(max * 4);
    this.tile = new Float32Array(max); this.rot = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aTile', new THREE.BufferAttribute(this.tile, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: atlas }, uScale: { value: 400 } },
      vertexShader: vtx, fragmentShader: frg,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 4 : 3;
    scene.add(this.points);
  }
  spawn(p) {
    if (this.P.length >= this.max) {
      // replace the oldest relative-to-life particle
      let oi = 0, best = -1;
      for (let i = 0; i < this.P.length; i += 7) { const r = this.P[i].t / this.P[i].life; if (r > best) { best = r; oi = i; } }
      this.P[oi] = p; return;
    }
    this.P.push(p);
  }
  update(dt, floorAt) {
    const P = this.P;
    let w = 0;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      p.t += dt;
      if (p.t >= p.life) continue;
      const k = p.t / p.life;
      p.vx *= 1 - p.drag * dt; p.vy *= 1 - p.drag * dt; p.vz *= 1 - p.drag * dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.collide) {
        const f = floorAt(p.x, p.z);
        if (p.y < f + 0.02) { p.y = f + 0.02; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      }
      p.r += p.vr * dt;
      P[w++] = p;
      const j = w - 1;
      this.pos[j * 3] = p.x; this.pos[j * 3 + 1] = p.y; this.pos[j * 3 + 2] = p.z;
      this.size[j] = p.s0 + (p.s1 - p.s0) * (p.grow ? 1 - (1 - k) * (1 - k) : k);
      let r = p.r0, gg = p.g0, b = p.b0;
      if (p.ramp) { // fire ramp: white -> yellow -> orange -> dark red -> smoke grey
        const c = rampFire(k * p.ramp); r = c[0]; gg = c[1]; b = c[2];
      } else if (p.r1 != null) { r += (p.r1 - r) * k; gg += (p.g1 - gg) * k; b += (p.b1 - b) * k; }
      this.col[j * 4] = r; this.col[j * 4 + 1] = gg; this.col[j * 4 + 2] = b;
      const fadeIn = p.fadeIn ? Math.min(1, p.t / p.fadeIn) : 1;
      this.col[j * 4 + 3] = p.a * fadeIn * (p.fadePow ? Math.pow(1 - k, p.fadePow) : (1 - k));
      this.tile[j] = p.tile; this.rot[j] = p.r;
    }
    P.length = w;
    this.geo.setDrawRange(0, w);
    for (const a of ['position', 'aSize', 'aColor', 'aTile', 'aRot']) this.geo.attributes[a].needsUpdate = true;
  }
  clear() { this.P.length = 0; }
}

function rampFire(k) {
  if (k < 0.12) return lerp3([1, 1, 0.92], [1, 0.86, 0.45], k / 0.12);
  if (k < 0.35) return lerp3([1, 0.86, 0.45], [1, 0.5, 0.12], (k - 0.12) / 0.23);
  if (k < 0.6) return lerp3([1, 0.5, 0.12], [0.55, 0.16, 0.05], (k - 0.35) / 0.25);
  return lerp3([0.55, 0.16, 0.05], [0.12, 0.1, 0.09], Math.min(1, (k - 0.6) / 0.4));
}
function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
const R = (a, b) => a + Math.random() * (b - a);

export class FX {
  constructor(scene, atlas, decalTex, quality, physics) {
    this.scene = scene; this.q = quality; this.physics = physics;
    this.alpha = new ParticleSystem(scene, atlas, quality.maxParticles, false);
    this.add = new ParticleSystem(scene, atlas, Math.round(quality.maxParticles * 0.6), true);
    // chips & casings
    this.chipMax = quality.maxChips;
    this.chips = [];
    this.chipMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), this.chipMax);
    this.chipMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chipMesh.setColorAt(0, new THREE.Color());
    this.chipMesh.count = 0; this.chipMesh.frustumCulled = false;
    scene.add(this.chipMesh);
    // decals
    this.holes = this._decalMesh(decalTex.hole, 400, 1);
    this.scorches = this._decalMesh(decalTex.scorch, 60, 2);
    this.decalCell = new Map(); // cell -> [ [mesh, idx] ]
    // lights
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffa040, 0, 30, 1.6);
      l.userData = { t: 1, dur: 0.1, peak: 0 };
      scene.add(l); this.lights.push(l);
    }
    // shockwave shells
    this.shells = [];
    const shellMat = () => new THREE.ShaderMaterial({
      uniforms: { uA: { value: 0 }, uC: { value: new THREE.Color(1, 0.95, 0.85) } },
      vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform float uA; uniform vec3 uC; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0-abs(dot(vN,vV)), 4.0); gl_FragColor = vec4(uC, f*uA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const sg = new THREE.SphereGeometry(1, 24, 16);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(sg, shellMat());
      m.visible = false; m.renderOrder = 5; m.userData = { t: 1, dur: 0.5, r: 1 };
      scene.add(m); this.shells.push(m);
    }
    // tracers
    this.tracers = [];
    const tg = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true); tg.translate(0, 0.5, 0);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false; m.userData = { t: 1, dur: 0.08 }; m.frustumCulled = false;
      scene.add(m); this.tracers.push(m);
    }
    this.fires = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3();
  }

  _decalMesh(tex, cap, order) {
    const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({
      map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 1,
    }), cap);
    m.count = 0; m.frustumCulled = false; m.renderOrder = order; m.receiveShadow = true;
    m.userData = { next: 0, cap };
    this.scene.add(m);
    return m;
  }

  setScale(px) { this.alpha.mat.uniforms.uScale.value = px; this.add.mat.uniforms.uScale.value = px; }

  clear() {
    this.alpha.clear(); this.add.clear(); this.chips.length = 0; this.chipMesh.count = 0;
    this.holes.count = 0; this.holes.userData.next = 0; this.scorches.count = 0; this.scorches.userData.next = 0;
    this.decalCell.clear();
    for (const f of this.fires) if (f.snd) f.snd.stop();
    this.fires.length = 0;
  }

  // ---- decals ----
  decal(kind, point, normal, size, cell = -1) {
    const mesh = kind === 'scorch' ? this.scorches : this.holes;
    const u = mesh.userData;
    const i = u.next; u.next = (u.next + 1) % u.cap; mesh.count = Math.max(mesh.count, i + 1);
    const q = this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * 6.28);
    q.multiply(spin);
    const p = this._v.copy(point).addScaledVector(normal, 0.01);
    this._s.set(size, size, size);
    mesh.setMatrixAt(i, this._m.compose(p, q, this._s));
    mesh.instanceMatrix.needsUpdate = true;
    if (cell >= 0) {
      let arr = this.decalCell.get(cell); if (!arr) this.decalCell.set(cell, arr = []);
      arr.push([mesh, i]);
    }
  }
  removeCellDecals(cell) {
    const arr = this.decalCell.get(cell);
    if (!arr) return;
    for (const [mesh, i] of arr) { this._m.makeScale(0, 0, 0); mesh.setMatrixAt(i, this._m); mesh.instanceMatrix.needsUpdate = true; }
    this.decalCell.delete(cell);
  }

  // ---- chips ----
  chip(pos, vel, size, color, opts = {}) {
    if (this.chips.length >= this.chipMax) this.chips.shift();
    this.chips.push({
      p: pos.clone(), v: vel.clone(), s: new THREE.Vector3(size * R(0.6, 1.3), size * R(0.5, 1), size * R(0.6, 1.3)).multiply(opts.shape || new THREE.Vector3(1, 1, 1)),
      q: new THREE.Quaternion().setFromEuler(new THREE.Euler(R(0, 6), R(0, 6), R(0, 6))),
      w: new THREE.Vector3(R(-15, 15), R(-15, 15), R(-15, 15)), c: new THREE.Color(color), t: 0, life: opts.life || R(2.5, 5), rest: false,
      snd: opts.snd || null, bounced: 0,
    });
  }
  chipsBurst(pos, n, color, speed, size, dir) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(R(-1, 1), R(-0.2, 1), R(-1, 1)).normalize().multiplyScalar(speed * R(0.3, 1));
      if (dir) v.addScaledVector(dir, speed * R(0.2, 0.9));
      this.chip(pos, v, size * R(0.5, 1.2), color);
    }
  }

  // ---- particles ----
  smoke(pos, opts = {}) {
    const dark = opts.dark != null ? opts.dark : R(0.25, 0.45);
    const c = opts.color || [dark, dark * 0.97, dark * 0.95];
    this.alpha.spawn({
      x: pos.x + R(-0.2, 0.2) * (opts.spread || 1), y: pos.y, z: pos.z + R(-0.2, 0.2) * (opts.spread || 1),
      vx: (opts.vx || 0) + R(-0.5, 0.5), vy: opts.vy != null ? opts.vy : R(0.6, 1.6), vz: (opts.vz || 0) + R(-0.5, 0.5),
      g: opts.g != null ? opts.g : 0.15, drag: opts.drag || 0.6, t: 0, life: opts.life || R(3, 6),
      s0: opts.s0 || 0.8, s1: opts.s1 || R(3.5, 6), grow: true, r0: c[0], g0: c[1], b0: c[2],
      a: opts.a || 0.55, fadePow: 1.4, fadeIn: 0.2, tile: TILE.SMOKE, r: R(0, 6), vr: R(-0.4, 0.4),
    });
  }
  dust(pos, color, opts = {}) {
    this.alpha.spawn({
      x: pos.x + R(-0.3, 0.3), y: pos.y + R(-0.2, 0.2), z: pos.z + R(-0.3, 0.3),
      vx: (opts.vx || 0) + R(-0.8, 0.8), vy: opts.vy != null ? opts.vy : R(0.2, 1), vz: (opts.vz || 0) + R(-0.8, 0.8),
      g: -0.15, drag: opts.drag || 1.4, t: 0, life: opts.life || R(1.5, 3.5),
      s0: opts.s0 || 0.5, s1: opts.s1 || R(2, 3.6), grow: true, r0: color[0], g0: color[1], b0: color[2],
      a: opts.a || 0.5, fadePow: 1.6, fadeIn: 0.08, tile: TILE.DUST, r: R(0, 6), vr: R(-0.6, 0.6),
    });
  }
  fireball(pos, opts = {}) {
    this.add.spawn({
      x: pos.x, y: pos.y, z: pos.z, vx: opts.vx || 0, vy: opts.vy || R(0.5, 2), vz: opts.vz || 0,
      g: 1.2, drag: opts.drag || 2.2, t: 0, life: opts.life || R(0.5, 1.1),
      s0: opts.s0 || 1.5, s1: opts.s1 || R(3, 5), grow: true, ramp: 1, a: opts.a || 0.9, fadePow: 0.7,
      tile: TILE.FIRE, r: R(0, 6), vr: R(-2, 2),
    });
  }
  spark(pos, vel, opts = {}) {
    this.add.spawn({
      x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z, g: opts.g != null ? opts.g : -9, drag: opts.drag || 0.8,
      t: 0, life: opts.life || R(0.25, 0.7), s0: opts.size || 0.12, s1: (opts.size || 0.12) * 0.3, r0: 1, g0: opts.g0 != null ? opts.g0 : 0.8, b0: opts.b0 != null ? opts.b0 : 0.4,
      a: 1, tile: TILE.SPARK, r: 0, vr: 0, collide: true,
    });
  }
  flashSprite(pos, size, color = [1, 0.85, 0.6], life = 0.07) {
    this.add.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: 0, vy: 0, vz: 0, g: 0, drag: 0, t: 0, life, s0: size, s1: size * 1.3,
      r0: color[0], g0: color[1], b0: color[2], a: 1, tile: TILE.SPARK, r: R(0, 6), vr: 0 });
  }
  shard(pos, vel) {
    this.alpha.spawn({
      x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z, g: -12, drag: 0.3, t: 0, life: R(1.2, 2.4),
      s0: R(0.08, 0.22), s1: R(0.05, 0.15), r0: 0.85, g0: 0.95, b0: 1, a: 0.9, fadePow: 0.4, tile: TILE.SHARD, r: R(0, 6), vr: R(-14, 14), collide: true,
    });
  }

  light(pos, intensity, dur, color = 0xffa040) {
    let best = this.lights[0];
    for (const l of this.lights) if (l.userData.t / l.userData.dur > best.userData.t / best.userData.dur) best = l;
    best.position.copy(pos); best.color.setHex(color);
    best.userData = { t: 0, dur, peak: intensity };
    best.distance = 8 + Math.sqrt(intensity) * 3;
  }
  shockwave(pos, radius, dur = 0.45) {
    const s = this.shells.find(m => !m.visible) || this.shells[0];
    s.visible = true; s.position.copy(pos); s.userData = { t: 0, dur, r: radius };
  }
  tracer(from, to, width = 0.025, dur = 0.07, color = 0xffe9a8) {
    const m = this.tracers.find(t => !t.visible) || this.tracers[0];
    const d = this._v.copy(to).sub(from);
    const len = d.length();
    m.visible = true; m.position.copy(from);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    m.scale.set(width, len, width);
    m.material.color.setHex(color);
    m.userData = { t: 0, dur };
  }
  startFire(pos, dur, size = 1, audio) {
    const f = { p: pos.clone(), t: 0, dur, size, acc: 0, snd: audio ? audio.positionalLoop('fire', pos, 0.6) : null };
    this.fires.push(f);
    return f;
  }

  update(dt, floorAt, camera) {
    this.alpha.update(dt, floorAt);
    this.add.update(dt, floorAt);
    // chips
    const M = this._m;
    let w = 0;
    for (let i = 0; i < this.chips.length; i++) {
      const c = this.chips[i];
      c.t += dt;
      if (c.t > c.life) continue;
      if (!c.rest) {
        c.v.y -= 13 * dt;
        c.p.addScaledVector(c.v, dt);
        const f = floorAt(c.p.x, c.p.z) + c.s.y * 0.5;
        if (c.p.y < f) {
          c.p.y = f;
          if (c.v.y < -1.5 && c.snd && c.bounced < 2) { c.snd(c.p, -c.v.y); }
          c.bounced++;
          c.v.y *= -0.35; c.v.x *= 0.55; c.v.z *= 0.55; c.w.multiplyScalar(0.5);
          if (Math.abs(c.v.y) < 0.4) { c.rest = true; }
        }
        this._q.setFromEuler(new THREE.Euler(c.w.x * dt, c.w.y * dt, c.w.z * dt));
        c.q.multiply(this._q);
      }
      const shrink = c.t > c.life - 0.6 ? (c.life - c.t) / 0.6 : 1;
      this._s.copy(c.s).multiplyScalar(shrink);
      M.compose(c.p, c.q, this._s);
      this.chipMesh.setMatrixAt(w, M);
      this.chipMesh.setColorAt(w, c.c);
      this.chips[w++] = c;
    }
    this.chips.length = w;
    this.chipMesh.count = w;
    this.chipMesh.instanceMatrix.needsUpdate = true;
    if (this.chipMesh.instanceColor) this.chipMesh.instanceColor.needsUpdate = true;
    // lights
    for (const l of this.lights) {
      const u = l.userData;
      u.t += dt;
      const k = u.t / u.dur;
      l.intensity = k >= 1 ? 0 : u.peak * Math.pow(1 - k, 2) * (0.85 + Math.random() * 0.3);
    }
    // shells
    for (const s of this.shells) {
      if (!s.visible) continue;
      const u = s.userData; u.t += dt;
      const k = u.t / u.dur;
      if (k >= 1) { s.visible = false; continue; }
      const r = u.r * (1 - Math.pow(1 - k, 2.5));
      s.scale.setScalar(Math.max(0.01, r));
      s.material.uniforms.uA.value = (1 - k) * (1 - k) * 0.38;
    }
    for (const t of this.tracers) {
      if (!t.visible) continue;
      t.userData.t += dt;
      const k = t.userData.t / t.userData.dur;
      if (k >= 1) { t.visible = false; continue; }
      t.material.opacity = 1 - k;
    }
    // persistent fires
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t += dt; f.acc += dt;
      const life = 1 - f.t / f.dur;
      if (life <= 0) { if (f.snd) f.snd.stop(); this.fires.splice(i, 1); continue; }
      if (f.snd) f.snd.update(f.p, 0.5 * Math.min(1, life * 3) * f.size);
      const rate = 0.05 / Math.max(0.4, f.size);
      while (f.acc > rate) {
        f.acc -= rate;
        const s = f.size * Math.min(1, life * 2);
        this.fireball(new THREE.Vector3(f.p.x + R(-0.3, 0.3) * s, f.p.y + R(0, 0.2), f.p.z + R(-0.3, 0.3) * s),
          { vy: R(1.2, 2.4), s0: 0.6 * s, s1: 1.4 * s, life: R(0.5, 0.9), drag: 0.5, a: 0.75 });
        if (Math.random() < 0.35) this.smoke(new THREE.Vector3(f.p.x, f.p.y + 0.8 * s, f.p.z), { dark: R(0.12, 0.25), s0: 0.6 * s, s1: 3 * s, vy: R(1, 2), life: R(2.5, 4), a: 0.45 });
        if (Math.random() < 0.08) this.spark(f.p.clone().add(new THREE.Vector3(0, 0.4, 0)), new THREE.Vector3(R(-1, 1), R(2, 4), R(-1, 1)), { life: R(0.6, 1.2), g: 1, size: 0.07 });
      }
    }
  }
}
