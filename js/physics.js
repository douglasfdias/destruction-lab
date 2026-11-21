// Lightweight rigid-body physics for debris, falling structural chunks and props (cars, barrels).
import * as THREE from '../lib/three.module.min.js';
import { VOX, MAT, MATS, NMAT, worldToCell, cellCenter, OX, OZ, NX, NZ } from './world.js';

const G = -9.81 * 1.35; // slightly heavier gravity reads better at game scale
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpV3 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4(), tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// 26 directions for picking hull sample pieces
const DIRS = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) DIRS.push(new THREE.Vector3(x, y, z).normalize());

export class Body {
  constructor() {
    this.pieces = [];
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.ang = new THREE.Vector3();
    this.invMass = 1; this.mass = 1; this.invI = 1;
    this.samples = []; // local points
    this.radius = 0.25;
    this.sleeping = false; this.sleepT = 0; this.frozen = false;
    this.age = 0; this.kind = 'debris';
    this.restitution = 0.15; this.friction = 0.6;
    this.mesh = null; this.half = null; // props
    this.hp = Infinity; this.onImpact = null;
    this.mainMat = 0; this.breakable = true;
    this.lastImpact = 0; this.dead = false;
    this.sphere = false;
  }
}

export class Physics {
  constructor(scene, world, terrain, texs, quality) {
    this.scene = scene; this.world = world; this.terrain = terrain;
    this.bodies = []; this.frozen = []; this.props = [];
    this.q = quality;
    this.events = [];
    this.timeAcc = 0;
    // dynamic instanced meshes per material
    this.meshes = []; this.owner = [];
    const geo = new THREE.BoxGeometry(VOX, VOX, VOX);
    for (let m = 1; m < NMAT; m++) {
      const def = MATS[m];
      const isGlass = m === MAT.GLASS;
      const mat = new THREE.MeshStandardMaterial({
        map: texs[def.tex], roughness: isGlass ? 0.1 : m === MAT.METAL ? 0.45 : 0.9, metalness: m === MAT.METAL ? 0.5 : 0,
        transparent: isGlass, opacity: isGlass ? 0.5 : 1, depthWrite: !isGlass,
      });
      const cap = isGlass ? 400 : 3000;
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0; mesh.frustumCulled = false;
      mesh.castShadow = !isGlass && quality.shadows; mesh.receiveShadow = true;
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      this.meshes[m] = mesh; this.owner[m] = new Array(cap);
      scene.add(mesh);
    }
    // spatial hash for debris-debris contacts
    this.hash = new Map();
    this.rubble = new Float32Array(NX * 2 * NZ * 2); // 0.25m grid of rubble heights
  }

  setShadows(on) { for (let m = 1; m < NMAT; m++) if (this.meshes[m]) this.meshes[m].castShadow = on && m !== MAT.GLASS; }

  // ---------- rubble height (frozen debris acts as ground) ----------
  rubbleIndex(x, z) {
    const i = Math.floor((x - OX) / (VOX / 2)), k = Math.floor((z - OZ) / (VOX / 2));
    if (i < 0 || k < 0 || i >= NX * 2 || k >= NZ * 2) return -1;
    return i + k * NX * 2;
  }
  floorAt(x, z) {
    const t = this.terrain.heightAt(x, z);
    const r = this.rubbleIndex(x, z);
    return r < 0 ? t : Math.max(t, this.rubble[r]);
  }
  _stampRubble(b) {
    for (const p of b.pieces) {
      tmpV.copy(p.lp).applyQuaternion(b.quat).add(b.pos);
      const h = p.s.length() * VOX * 0.42;
      const top = tmpV.y + h * 0.75;
      const rr = Math.max(1, Math.round(h / (VOX / 2)));
      for (let dx = -rr + 1; dx < rr; dx++) for (let dz = -rr + 1; dz < rr; dz++) {
        const r = this.rubbleIndex(tmpV.x + dx * VOX / 2, tmpV.z + dz * VOX / 2);
        if (r >= 0 && this.rubble[r] < top) this.rubble[r] = top;
      }
    }
  }
  rebuildRubble() { this.rubble.fill(0); for (const b of this.frozen) this._stampRubble(b); }

  // ---------- instances ----------
  _addPiece(b, m, lp, s, color, dmg = 0) {
    const mesh = this.meshes[m];
    if (mesh.count >= this.owner[m].length) this._evict(m);
    if (mesh.count >= this.owner[m].length) return null;
    const n = mesh.count++;
    const p = { m, lp: lp.clone(), s: s.clone(), inst: n, body: b };
    this.owner[m][n] = p;
    const c = new THREE.Color(color);
    const k = (1 - dmg * 0.3) * (0.9 + Math.random() * 0.12);
    c.r *= k; c.g *= k; c.b *= k;
    mesh.setColorAt(n, c); mesh.instanceColor.needsUpdate = true;
    b.pieces.push(p);
    return p;
  }
  _removePiece(p) {
    const m = p.m, mesh = this.meshes[m], last = mesh.count - 1;
    if (p.inst < 0) return;
    if (p.inst !== last) {
      const q = this.owner[m][last];
      mesh.getMatrixAt(last, tmpM); mesh.setMatrixAt(p.inst, tmpM);
      mesh.getColorAt(last, this._c || (this._c = new THREE.Color())); mesh.setColorAt(p.inst, this._c);
      q.inst = p.inst; this.owner[m][p.inst] = q;
    }
    this.owner[m][last] = undefined;
    mesh.count = last; p.inst = -1;
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
  }
  _evict(m) {
    // drop the oldest frozen bodies that use material m
    for (let i = 0; i < this.frozen.length && this.meshes[m].count >= this.owner[m].length - 8; i++) {
      const b = this.frozen[i];
      if (b.pieces.some(p => p.m === m)) { this.removeBody(b); i--; }
    }
  }
  _writeMatrices(b) {
    for (const p of b.pieces) {
      if (p.inst < 0) continue;
      tmpV.copy(p.lp).applyQuaternion(b.quat).add(b.pos);
      tmpM.compose(tmpV, b.quat, p.s);
      this.meshes[p.m].setMatrixAt(p.inst, tmpM);
      this.meshes[p.m].instanceMatrix.needsUpdate = true;
    }
  }

  removeBody(b) {
    for (const p of b.pieces) this._removePiece(p);
    b.pieces.length = 0; b.dead = true;
    let i = this.bodies.indexOf(b); if (i >= 0) this.bodies.splice(i, 1);
    i = this.frozen.indexOf(b); if (i >= 0) this.frozen.splice(i, 1);
    if (b.mesh) { this.scene.remove(b.mesh); i = this.props.indexOf(b); if (i >= 0) this.props.splice(i, 1); }
  }

  clear() {
    for (const b of [...this.bodies, ...this.frozen, ...this.props]) this.removeBody(b);
    this.bodies.length = 0; this.frozen.length = 0; this.props.length = 0; this.rubble.fill(0);
  }

  // ---------- spawning ----------
  _finalize(b) {
    // centre of mass & mass
    let mass = 0; const com = new THREE.Vector3();
    for (const p of b.pieces) {
      const w = MATS[p.m].density * p.s.x * p.s.y * p.s.z * VOX * VOX * VOX;
      p.w = w; mass += w; com.addScaledVector(p.lp, w);
    }
    if (!b.pieces.length) return false;
    com.divideScalar(mass);
    for (const p of b.pieces) p.lp.sub(com);
    b.pos.add(tmpV.copy(com).applyQuaternion(b.quat));
    b.mass = mass; b.invMass = 1 / mass;
    // bounds and inertia (box approximation)
    const mn = new THREE.Vector3(1e9, 1e9, 1e9), mx = new THREE.Vector3(-1e9, -1e9, -1e9);
    for (const p of b.pieces) {
      const h = tmpV2.copy(p.s).multiplyScalar(VOX / 2);
      mn.min(tmpV.copy(p.lp).sub(h)); mx.max(tmpV.copy(p.lp).add(h));
    }
    const ext = mx.clone().sub(mn);
    b.radius = ext.length() / 2;
    b.invI = 1 / Math.max(1e-4, mass * (ext.x * ext.x + ext.y * ext.y + ext.z * ext.z) / 12);
    // samples
    b.samples = [];
    if (b.pieces.length === 1) {
      b.sphere = true;
      b.rad = Math.min(p0(b).s.x, p0(b).s.y, p0(b).s.z) * VOX * 0.5;
      // flat pieces wobble better with corner samples
      const h = tmpV2.copy(p0(b).s).multiplyScalar(VOX / 2);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) b.samples.push(new THREE.Vector3(sx * h.x, sy * h.y, sz * h.z));
    } else {
      const chosen = new Set();
      for (const d of DIRS) {
        let best = null, bd = -1e9;
        for (const p of b.pieces) { const v = p.lp.dot(d); if (v > bd) { bd = v; best = p; } }
        if (chosen.has(best)) continue;
        chosen.add(best);
        const h = tmpV2.copy(best.s).multiplyScalar(VOX / 2);
        b.samples.push(new THREE.Vector3(best.lp.x + Math.sign(d.x) * h.x, best.lp.y + Math.sign(d.y) * h.y, best.lp.z + Math.sign(d.z) * h.z));
      }
    }
    b.mainMat = p0(b).m;
    return true;
  }

  spawnDebris(m, pos, vel, scale, color, opts = {}) {
    if (this.bodies.length >= this.q.maxBodies) {
      // freeze the oldest sleeping/slow body to make room
      if (!this._freezeOldest()) return null;
    }
    const b = new Body();
    b.pos.copy(pos);
    b.quat.setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3));
    const s = typeof scale === 'number' ? new THREE.Vector3(scale * (0.75 + Math.random() * 0.5), scale * (0.7 + Math.random() * 0.4), scale * (0.75 + Math.random() * 0.5)) : scale;
    if (!this._addPiece(b, m, new THREE.Vector3(), s, color, opts.dmg || 0)) return null;
    this._finalize(b);
    b.vel.copy(vel);
    b.ang.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14).multiplyScalar(opts.spin != null ? opts.spin : 1);
    b.restitution = m === MAT.WOOD ? 0.25 : m === MAT.METAL ? 0.3 : 0.12;
    b.kind = opts.kind || 'debris';
    b.breakable = opts.breakable !== false;
    this.bodies.push(b);
    this._writeMatrices(b);
    return b;
  }

  // cells: array of {c, m, tint, dmg} taken from the world
  spawnChunk(cells, opts = {}) {
    if (!cells.length) return null;
    const b = new Body();
    const ctr = new THREE.Vector3();
    for (const e of cells) { cellCenter(e.c, tmpV); ctr.add(tmpV); }
    ctr.divideScalar(cells.length);
    b.pos.copy(ctr);
    const one = new THREE.Vector3(1, 1, 1);
    for (const e of cells) {
      cellCenter(e.c, tmpV);
      this._addPiece(b, e.m, tmpV.clone().sub(ctr), one, e.tint, e.dmg);
    }
    if (!this._finalize(b)) return null;
    b.kind = 'chunk';
    b.restitution = 0.05; b.friction = 0.7;
    if (opts.vel) b.vel.copy(opts.vel);
    // tiny random nudge so symmetric chunks topple instead of dropping straight
    b.ang.set((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.6);
    this.bodies.push(b);
    this._writeMatrices(b);
    return b;
  }

  addProp(mesh, half, mass, opts = {}) {
    const b = new Body();
    b.kind = 'prop'; b.mesh = mesh; b.half = half.clone();
    b.pos.copy(mesh.position); b.quat.copy(mesh.quaternion);
    b.mass = mass; b.invMass = 1 / mass;
    b.invI = 1 / (mass * (4 * (half.x * half.x + half.y * half.y + half.z * half.z)) / 12);
    b.radius = half.length();
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) b.samples.push(new THREE.Vector3(sx * half.x, sy * half.y, sz * half.z));
    if (opts.extraSamples) for (const s of opts.extraSamples) b.samples.push(s);
    b.restitution = opts.restitution != null ? opts.restitution : 0.2;
    b.friction = opts.friction != null ? opts.friction : 0.7;
    b.hp = opts.hp != null ? opts.hp : Infinity;
    b.breakable = false;
    Object.assign(b, opts.extra || {});
    b.sleeping = true;
    this.props.push(b);
    return b;
  }

  _freezeOldest() {
    let best = null, bs = -1;
    for (const b of this.bodies) {
      if (b.kind === 'prop') continue;
      const score = (b.age + 0.1) * (b.sleeping ? 4 : 1) / (1 + b.vel.lengthSq()) / (b.kind === 'chunk' ? 1 + b.pieces.length * 0.05 : 1);
      if (score > bs) { bs = score; best = b; }
    }
    if (!best) return false;
    this._freeze(best);
    return true;
  }
  _freeze(b) {
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
    b.frozen = true; b.sleeping = true;
    this.frozen.push(b);
    this._stampRubble(b);
    // cap frozen total to keep memory/instances bounded
    while (this.frozen.length > this.q.maxFrozen) this.removeBody(this.frozen[0]);
  }
  unfreeze(b) {
    const i = this.frozen.indexOf(b);
    if (i >= 0) this.frozen.splice(i, 1);
    b.frozen = false; b.sleeping = false; b.sleepT = 0;
    this.bodies.push(b);
  }

  // ---------- impulses ----------
  applyImpulse(b, J, point) {
    if (b.sleeping || b.frozen) { if (b.frozen) this.unfreeze(b); b.sleeping = false; b.sleepT = 0; }
    b.vel.addScaledVector(J, b.invMass);
    if (point) {
      tmpV3.copy(point).sub(b.pos).cross(J).multiplyScalar(b.invI);
      b.ang.add(tmpV3);
      const l = b.ang.length(); if (l > 30) b.ang.multiplyScalar(30 / l);
    }
  }

  // radial blast impulse to bodies & props, returns props hit with falloff
  blast(center, power, radius, exclude = null) {
    const hits = [];
    let unfroze = false;
    const lists = [this.bodies, this.frozen, this.props];
    for (const list of lists) {
      for (let i = list.length - 1; i >= 0; i--) {
        const b = list[i];
        if (b === exclude) continue;
        const d = tmpV.copy(b.pos).sub(center);
        const dist = d.length();
        if (dist > radius + b.radius) continue;
        const f = Math.max(0, 1 - Math.max(0, dist - b.radius * 0.5) / radius);
        if (f <= 0) continue;
        if (b.frozen) unfroze = true;
        d.normalize(); d.y = d.y * 0.6 + 0.55; d.normalize();
        // velocity change shrinks with mass: debris flies, cars hop and flip, barrels get tossed
        const dv = Math.min(16, power * 0.62 * f * f / (0.55 + b.mass));
        const J = d.multiplyScalar(dv * b.mass);
        tmpV2.copy(b.pos).addScaledVector(J, -0.0005).add(new THREE.Vector3((Math.random() - 0.5) * b.radius, (Math.random() - 0.5) * b.radius, (Math.random() - 0.5) * b.radius));
        this.applyImpulse(b, J, tmpV2);
        if (b.kind === 'prop') hits.push({ b, f });
      }
    }
    if (unfroze) this.rebuildRubble();
    return hits;
  }

  // removals queue wake-ups; processed once per step with a coarse grid instead of scanning every body per removed cell
  queueWake(p) { (this.wakeQ || (this.wakeQ = [])).push(p.x, p.y, p.z); }
  _processWakes() {
    const q = this.wakeQ;
    if (!q || !q.length) return;
    const keys = new Set();
    const key = (x, y, z) => (Math.floor(x) + 512) * 1048576 + (Math.floor(y) + 64) * 1024 + (Math.floor(z) + 512);
    for (let i = 0; i < q.length; i += 3) keys.add(key(q[i], q[i + 1], q[i + 2]));
    const near = (b) => {
      if (b.radius > 1.5) { for (let i = 0; i < q.length; i += 3) { const dx = b.pos.x - q[i], dy = b.pos.y - q[i + 1], dz = b.pos.z - q[i + 2]; if (dx * dx + dy * dy + dz * dz < (b.radius + 1) ** 2) return true; } return false; }
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if (keys.has(key(b.pos.x + dx, b.pos.y + dy, b.pos.z + dz))) return true;
      return false;
    };
    for (const b of this.bodies) if (b.sleeping && near(b)) { b.sleeping = false; b.sleepT = 0; b.contactT = 0; b.age = Math.min(b.age, 5); }
    for (const b of this.props) if (b.sleeping && !b.dead && near(b)) { b.sleeping = false; b.sleepT = 0; b.contactT = 0; }
    let any = false;
    for (let i = this.frozen.length - 1; i >= 0; i--) { const b = this.frozen[i]; if (b.kind === 'chunk' && near(b)) { this.unfreeze(b); b.age = 0; any = true; } }
    if (any) this.rebuildRubble();
    q.length = 0;
  }

  wakeNear(p, r) {
    for (const b of this.bodies) if (b.sleeping && b.pos.distanceToSquared(p) < (r + b.radius) ** 2) { b.sleeping = false; b.sleepT = 0; }
    for (const b of this.props) if (b.sleeping && b.pos.distanceToSquared(p) < (r + b.radius) ** 2) { b.sleeping = false; b.sleepT = 0; }
    let any = false;
    for (let i = this.frozen.length - 1; i >= 0; i--) {
      const b = this.frozen[i];
      if (b.pos.distanceToSquared(p) < (r + b.radius) ** 2 && b.kind === 'chunk') { this.unfreeze(b); any = true; }
    }
    if (any) this.rebuildRubble();
  }

  // ---------- simulation ----------
  step(dt) {
    this._processWakes();
    const world = this.world;
    const contacts = [];
    const breaks = [];
    const all = this.bodies.concat(this.props.filter(p => !p.sleeping && !p.dead));
    for (const b of all) {
      if (b.sleeping) continue;
      b.age += dt;
      b.vel.y += G * dt;
      b.pos.addScaledVector(b.vel, dt);
      // integrate rotation
      const w = b.ang;
      if (w.lengthSq() > 1e-8) {
        tmpQ.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0).multiply(b.quat);
        b.quat.x += tmpQ.x; b.quat.y += tmpQ.y; b.quat.z += tmpQ.z; b.quat.w += tmpQ.w;
        b.quat.normalize();
      }
      // collisions: samples vs floor (terrain/rubble) and static voxels
      let corrX = 0, corrY = 0, corrZ = 0, corrNX = 0, corrNZ = 0, corrNY = 0;
      let maxImpact = 0, hitCell = -1, hitMat = 0, nContacts = 0;
      for (const s of b.samples) {
        const p = tmpV.copy(s).applyQuaternion(b.quat).add(b.pos);
        let nx = 0, ny = 0, nz = 0, depth = 0, cell = -1;
        const floor = this.floorAt(p.x, p.z);
        if (p.y < floor) { ny = 1; depth = floor - p.y; }
        else {
          const c = worldToCell(p.x, p.y, p.z);
          if (c >= 0 && world.mat[c] && !this._ownCell(b, c)) {
            cellCenter(c, tmpV2);
            const lx = p.x - tmpV2.x, ly = p.y - tmpV2.y, lz = p.z - tmpV2.z, h = VOX / 2;
            // candidate faces sorted by penetration; prefer faces opening to empty space
            const cand = [[h - lx, 1, 0, 0, 1], [h + lx, -1, 0, 0, -1], [h - ly, 0, 1, 0, NX * NZ], [h + ly, 0, -1, 0, -NX * NZ], [h - lz, 0, 0, 1, NX], [h + lz, 0, 0, -1, -NX]];
            cand.sort((a, b2) => a[0] - b2[0]);
            for (const cd of cand) {
              const nb = c + cd[4];
              if (nb >= 0 && nb < world.mat.length && world.mat[nb]) continue;
              depth = cd[0]; nx = cd[1]; ny = cd[2]; nz = cd[3]; cell = c; break;
            }
            if (cell < 0) { ny = 1; depth = Math.min(h - ly, 0.3); cell = c; }
          }
        }
        if (depth <= 0) continue;
        nContacts++;
        // impulse at contact
        const r = tmpV3.copy(p).sub(b.pos);
        const vp = tmpV2.copy(b.ang).cross(r).add(b.vel);
        const vn = vp.x * nx + vp.y * ny + vp.z * nz;
        if (vn < 0) {
          if (-vn > maxImpact) { maxImpact = -vn; hitCell = cell; hitMat = cell >= 0 ? world.mat[cell] : 0; }
          const n = new THREE.Vector3(nx, ny, nz);
          const rn = r.clone().cross(n);
          const k = b.invMass + b.invI * rn.lengthSq();
          const e = -vn > 2 ? b.restitution : 0;
          const jn = -(1 + e) * vn / k / Math.max(1, b.samples.length * 0.18);
          const J = n.multiplyScalar(jn);
          // friction
          const vt = vp.clone().addScaledVector(tmpV.set(nx, ny, nz), -vn);
          const vtl = vt.length();
          if (vtl > 1e-4) {
            const jt = Math.min(b.friction * jn, vtl / k / Math.max(1, b.samples.length * 0.18));
            J.addScaledVector(vt, -jt / vtl);
          }
          b.vel.addScaledVector(J, b.invMass);
          b.ang.addScaledVector(r.cross(J), b.invI);
        }
        if (nx > 0) corrX = Math.max(corrX, depth); else if (nx < 0) corrNX = Math.max(corrNX, depth);
        if (ny > 0) corrY = Math.max(corrY, depth); else if (ny < 0) corrNY = Math.max(corrNY, depth);
        if (nz > 0) corrZ = Math.max(corrZ, depth); else if (nz < 0) corrNZ = Math.max(corrNZ, depth);
      }
      b.pos.x += (corrX - corrNX) * 0.85; b.pos.y += (corrY - corrNY) * 0.85; b.pos.z += (corrZ - corrNZ) * 0.85;
      if (nContacts) {
        b.contactT = (b.contactT || 0) + dt;
        // rolling resistance / settling
        b.ang.multiplyScalar(1 - Math.min(0.9, 2.5 * dt));
        b.vel.x *= 1 - Math.min(0.5, 0.8 * dt); b.vel.z *= 1 - Math.min(0.5, 0.8 * dt);
        // after a while on the ground, bleed energy hard so pieces stuck between rubble and walls stop jittering
        if (b.contactT > 0.8) { const k = Math.min(0.5, (b.contactT - 0.8) * 3 * dt + 4 * dt); b.vel.multiplyScalar(1 - k); b.ang.multiplyScalar(1 - Math.min(0.6, k * 1.5)); }
      } else b.contactT = Math.max(0, (b.contactT || 0) - dt * 2);
      b.ang.multiplyScalar(1 - 0.15 * dt);
      { const wl = b.ang.length(), cap = b.kind === 'chunk' ? 6 : 25; if (wl > cap) b.ang.multiplyScalar(cap / wl); }
      if (maxImpact > 1.2 && b.age - b.lastImpact > 0.12) {
        b.lastImpact = b.age;
        contacts.push({ b, speed: maxImpact, cell: hitCell, mat: hitMat });
        if (b.kind !== 'prop' && b.breakable) {
          const thr = MATS[b.mainMat].brittle;
          if (maxImpact > thr && (b.pieces.length > 1 || (p0(b) && p0(b).s.x > 0.5 && maxImpact > thr * 1.4))) breaks.push(b);
        }
      }
      // sleep
      const e2 = b.vel.lengthSq() + b.ang.lengthSq() * 0.3;
      const settle = (e2 < 0.09 && nContacts) ||
        (b.contactT > 2 && e2 < 4) ||                                  // stuck & buzzing in place
        (b.kind !== 'prop' && b.age > 7 && b.contactT > 0.4 && e2 < 9);
      if (settle) { b.sleepT += dt; if (b.sleepT > 0.3) { b.sleeping = true; b.vel.set(0, 0, 0); b.ang.set(0, 0, 0); } }
      else b.sleepT = 0;
      // nothing stays simulated forever (unless clearly falling)
      if (b.kind !== 'prop' && b.age > 14 && b.vel.y > -3) { b.sleeping = true; b.sleepT = 99; b.vel.set(0, 0, 0); b.ang.set(0, 0, 0); }
      if (b.pos.y < -30) b.dead = true;
    }
    this._debrisContacts(dt);
    this._propContacts();
    // write matrices
    for (const b of this.bodies) if (!b.sleeping || b.sleepT === 0) this._writeMatrices(b);
    for (const b of this.props) if (b.mesh) { b.mesh.position.copy(b.pos); b.mesh.quaternion.copy(b.quat); }
    // freeze long-sleeping debris
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      if (b.dead) { this.removeBody(b); continue; }
      if (b.sleeping) { b.sleepT += dt; if (b.sleepT > 1.2) this._freeze(b); }
    }
    for (const b of this.props) if (b.sleeping && !b.dead) b.sleepT += dt;
    this.events.push(...contacts.map(c => ({ type: 'impact', ...c })));
    for (const b of breaks) this.shatter(b);
  }

  _ownCell() { return false; }

  _debrisContacts() {
    const H = this.hash; H.clear();
    const cs = 0.75;
    const key = (x, y, z) => ((Math.floor(x / cs) * 73856093) ^ (Math.floor(y / cs) * 19349663) ^ (Math.floor(z / cs) * 83492791));
    for (const b of this.bodies) {
      if (!b.sphere) continue;
      const k = key(b.pos.x, b.pos.y, b.pos.z);
      let arr = H.get(k); if (!arr) H.set(k, arr = []); arr.push(b);
    }
    for (const b of this.bodies) {
      if (!b.sphere || b.sleeping) continue;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const arr = H.get(key(b.pos.x + dx * cs, b.pos.y + dy * cs, b.pos.z + dz * cs));
        if (!arr) continue;
        for (const o of arr) {
          if (o === b) continue;
          const d = tmpV.copy(b.pos).sub(o.pos);
          const rr = b.rad + o.rad;
          const l2 = d.lengthSq();
          if (l2 >= rr * rr || l2 < 1e-8) continue;
          const l = Math.sqrt(l2), pen = rr - l;
          d.divideScalar(l);
          const tm = b.invMass + o.invMass;
          b.pos.addScaledVector(d, pen * b.invMass / tm * 0.8);
          o.pos.addScaledVector(d, -pen * o.invMass / tm * 0.8);
          const rv = tmpV2.copy(b.vel).sub(o.vel).dot(d);
          if (rv < 0) {
            const j = -1.1 * rv / tm;
            b.vel.addScaledVector(d, j * b.invMass); o.vel.addScaledVector(d, -j * o.invMass);
            if (o.sleeping && Math.abs(j * o.invMass) > 1.6) { o.sleeping = false; o.sleepT = 0; }
          }
        }
      }
    }
  }

  // debris spheres pushed out of props' oriented boxes
  _propContacts() {
    if (!this.props.length) return;
    const inv = new THREE.Quaternion();
    for (const pr of this.props) {
      if (pr.dead || !pr.half) continue;
      inv.copy(pr.quat).invert();
      for (const b of this.bodies) {
        if (b.sleeping || !b.sphere) continue;
        if (b.pos.distanceToSquared(pr.pos) > (pr.radius + 0.5) ** 2) continue;
        const l = tmpV.copy(b.pos).sub(pr.pos).applyQuaternion(inv);
        const h = pr.half, r = b.rad;
        const px = h.x + r - Math.abs(l.x), py = h.y + r - Math.abs(l.y), pz = h.z + r - Math.abs(l.z);
        if (px <= 0 || py <= 0 || pz <= 0) continue;
        const n = new THREE.Vector3();
        if (px < py && px < pz) n.x = Math.sign(l.x) * px; else if (py < pz) n.y = Math.sign(l.y) * py; else n.z = Math.sign(l.z) * pz;
        n.applyQuaternion(pr.quat);
        b.pos.add(n);
        const nn = n.normalize(), vn = b.vel.dot(nn);
        if (vn < 0) b.vel.addScaledVector(nn, -vn * 1.2);
      }
    }
  }

  // split a chunk into a few pieces (Voronoi-ish clustering), or a big voxel into smaller fragments
  shatter(b) {
    if (b.dead) return;
    const pieces = b.pieces.slice();
    const pos = b.pos.clone(), quat = b.quat.clone(), vel = b.vel.clone(), ang = b.ang.clone();
    this.removeBody(b);
    if (pieces.length === 1) {
      const p = pieces[0];
      const n = 2 + (Math.random() * 2 | 0);
      for (let i = 0; i < n; i++) {
        const off = new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.2), (Math.random() - 0.5)).multiplyScalar(p.s.x * VOX * 0.5);
        const v = vel.clone().multiplyScalar(0.3).add(off.clone().multiplyScalar(6)).add(new THREE.Vector3(0, 1.5, 0));
        this.spawnDebris(p.m, off.add(pos), v, p.s.x * (0.45 + Math.random() * 0.2), this._pieceColor(p), {});
      }
      this.events.push({ type: 'shatter', pos, mat: p.m, n: 1 });
      return;
    }
    const nSeeds = Math.min(pieces.length, 2 + Math.floor(Math.sqrt(pieces.length) * 0.6));
    const seeds = [];
    for (let i = 0; i < nSeeds; i++) seeds.push(pieces[(Math.random() * pieces.length) | 0].lp.clone());
    const groups = seeds.map(() => []);
    for (const p of pieces) {
      let bi = 0, bd = 1e9;
      for (let i = 0; i < seeds.length; i++) { const d = p.lp.distanceToSquared(seeds[i]) * (0.8 + Math.random() * 0.4); if (d < bd) { bd = d; bi = i; } }
      groups[bi].push(p);
    }
    let spawned = 0;
    for (const g of groups) {
      if (!g.length) continue;
      const gc = new THREE.Vector3();
      for (const p of g) gc.add(p.lp);
      gc.divideScalar(g.length);
      const wpos = gc.clone().applyQuaternion(quat).add(pos);
      const spread = gc.clone().applyQuaternion(quat).normalize().multiplyScalar(1.5 + Math.random() * 2);
      const v = vel.clone().multiplyScalar(0.35).add(spread).add(new THREE.Vector3(0, 1 + Math.random() * 1.5, 0));
      if (g.length <= 2) {
        // small groups become individual debris; nothing is thrown away (oldest debris freezes into rubble instead)
        for (const p of g) {
          const wp = p.lp.clone().applyQuaternion(quat).add(pos);
          const d = this.spawnDebris(p.m, wp, v.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)), Math.random() < 0.5 ? 0.92 : 0.7, this._pieceColor(p));
          if (d) d.quat.copy(quat);
          if (spawned++ < 12) this.events.push({ type: 'chips', pos: wp, mat: p.m, n: 3 });
        }
        continue;
      }
      const nb = new Body();
      nb.pos.copy(wpos); nb.quat.copy(quat);
      for (const p of g) this._addPiece(nb, p.m, p.lp.clone().sub(gc), p.s, this._pieceColor(p));
      if (!this._finalize(nb)) continue;
      nb.kind = 'chunk'; nb.restitution = 0.05; nb.friction = 0.7;
      nb.vel.copy(v); nb.ang.copy(ang).multiplyScalar(0.5).add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3));
      this.bodies.push(nb);
      this._writeMatrices(nb);
    }
    this.events.push({ type: 'shatter', pos, mat: pieces[0].m, n: pieces.length });
  }

  _pieceColor(p) {
    const c = new THREE.Color();
    if (p.inst >= 0) this.meshes[p.m].getColorAt(p.inst, c); else c.setHex(MATS[p.m].color);
    return c;
  }

  // ray test against active/frozen debris bodies & props (sphere/obb approx) -> nearest
  raycastBodies(o, d, maxT) {
    let best = null, bt = maxT;
    const test = (b, r) => {
      const oc = tmpV.copy(o).sub(b.pos);
      const bb = oc.dot(d), c = oc.lengthSq() - r * r;
      const disc = bb * bb - c;
      if (disc < 0) return;
      const t = -bb - Math.sqrt(disc);
      if (t > 0 && t < bt) { bt = t; best = { b, t }; }
    };
    for (const b of this.bodies) test(b, b.sphere ? b.rad * 1.2 : b.radius * 0.6);
    for (const b of this.props) {
      if (b.dead) continue;
      // OBB slab test
      const inv = tmpQ.copy(b.quat).invert();
      const lo = tmpV.copy(o).sub(b.pos).applyQuaternion(inv);
      const ld = tmpV2.copy(d).applyQuaternion(inv);
      let t0 = 0, t1 = bt;
      let ok = true;
      for (const ax of ['x', 'y', 'z']) {
        const h = b.half[ax];
        if (Math.abs(ld[ax]) < 1e-8) { if (Math.abs(lo[ax]) > h) { ok = false; break; } continue; }
        let ta = (-h - lo[ax]) / ld[ax], tb = (h - lo[ax]) / ld[ax];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) { ok = false; break; }
      }
      if (ok && t0 < bt) { bt = t0; best = { b, t: t0 }; }
    }
    return best;
  }
}

function p0(b) { return b.pieces[0]; }
