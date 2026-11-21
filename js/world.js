// Voxel world: materials, building layout, instanced rendering, damage, cracks and structural integrity.
import * as THREE from '../lib/three.module.min.js';

export const VOX = 0.5;
export const NX = 96, NY = 32, NZ = 96;
export const OX = -24, OZ = -26; // world position of cell (0,0,0) corner

// material table
export const MAT = {
  EMPTY: 0, CONCRETE: 1, BRICK: 2, PLASTER: 3, WOOD: 4, GLASS: 5, TILE: 6, METAL: 7, FOUND: 8, STONE: 9, TRIM: 10,
};
export const MATS = [
  null,
  { name: 'concreto', hp: 130, color: 0xbdbdb8, tex: 'concrete', value: 140, span: 9, brittle: 7, density: 2.4, chip: 0xa8a8a3, dust: [0.75, 0.74, 0.72], snd: 'crumble', hit: 'hit', block: 0.85 },
  { name: 'tijolo', hp: 60, color: 0xc0644a, tex: 'brick', value: 45, span: 4, brittle: 5, density: 1.9, chip: 0xa9553e, dust: [0.72, 0.55, 0.45], snd: 'crumble', hit: 'hit', block: 0.7 },
  { name: 'alvenaria', hp: 55, color: 0xf0c9a2, tex: 'plaster', value: 50, span: 4, brittle: 5, density: 1.8, chip: 0xe8d8c8, dust: [0.85, 0.8, 0.74], snd: 'crumble', hit: 'hit', block: 0.7 },
  { name: 'madeira', hp: 28, color: 0xc89a62, tex: 'wood', value: 30, span: 6, brittle: 8, density: 0.7, chip: 0xb48450, dust: [0.6, 0.5, 0.38], snd: 'woodbreak', hit: 'woodhit', block: 0.45 },
  { name: 'vidro', hp: 3, color: 0xbfe3f5, tex: 'glass', value: 90, span: 3, brittle: 1, density: 2.5, chip: 0xd8f0ff, dust: null, snd: 'glassbreak', hit: 'glasshit', block: 0.1 },
  { name: 'telha', hp: 20, color: 0xc65a3c, tex: 'tile', value: 25, span: 12, brittle: 4, density: 1.6, chip: 0xb44f34, dust: [0.7, 0.45, 0.36], snd: 'crumble', hit: 'hit', block: 0.5 },
  { name: 'metal', hp: 150, color: 0x8ea3b8, tex: 'metal', value: 160, span: 8, brittle: 14, density: 3.5, chip: 0x7d8fa1, dust: null, snd: 'metalfall', hit: 'metalhit', block: 0.9 },
  { name: 'fundação', hp: 900, color: 0x8f8f8a, tex: 'concrete', value: 60, span: 99, brittle: 30, density: 2.4, chip: 0x8f8f8a, dust: [0.6, 0.6, 0.58], snd: 'crumble', hit: 'hit', block: 0.95 },
  { name: 'pedra', hp: 200, color: 0x8b8a86, tex: 'concrete', value: 0, span: 99, brittle: 30, density: 2.6, chip: 0x8b8a86, dust: [0.6, 0.6, 0.6], snd: 'stones', hit: 'stones', block: 0.9 },
  { name: 'acabamento', hp: 22, color: 0xf4f1ea, tex: 'wood', value: 35, span: 3, brittle: 6, density: 0.7, chip: 0xf4f1ea, dust: [0.8, 0.78, 0.74], snd: 'woodbreak', hit: 'woodhit', block: 0.4 },
];
export const NMAT = MATS.length;

const N = NX * NY * NZ;
export function idx(i, j, k) { return i + NX * (k + NZ * j); }
export function inBounds(i, j, k) { return i >= 0 && j >= 0 && k >= 0 && i < NX && j < NY && k < NZ; }
export function cellCenter(c, out) {
  const i = c % NX, k = ((c / NX) | 0) % NZ, j = (c / (NX * NZ)) | 0;
  out.set(OX + (i + 0.5) * VOX, (j + 0.5) * VOX, OZ + (k + 0.5) * VOX);
  return out;
}
export function worldToCell(x, y, z) {
  const i = Math.floor((x - OX) / VOX), j = Math.floor(y / VOX), k = Math.floor((z - OZ) / VOX);
  if (!inBounds(i, j, k)) return -1;
  return idx(i, j, k);
}

// voxel material with crack overlay driven by per-instance damage attribute
export function makeVoxelMaterial(mat, texs, crackTex, dynamic = false) {
  const def = MATS[mat];
  const isGlass = mat === MAT.GLASS;
  const m = new THREE.MeshStandardMaterial({
    map: texs[def.tex],
    color: 0xffffff,
    roughness: isGlass ? 0.08 : mat === MAT.METAL ? 0.45 : 0.88,
    metalness: isGlass ? 0.1 : mat === MAT.METAL ? 0.55 : 0.0,
    transparent: isGlass,
    opacity: isGlass ? 0.42 : 1,
    depthWrite: !isGlass,
    envMapIntensity: isGlass ? 1.6 : 0.6,
  });
  if (!dynamic && !isGlass) {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.crackMap = { value: crackTex };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aDamage;\nvarying float vDamage;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDamage = aDamage;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D crackMap;\nvarying float vDamage;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          if (vDamage > 0.02) {
            float st = clamp(floor(vDamage * 3.0) + 1.0, 1.0, 3.0);
            vec4 ck = texture2D(crackMap, vec2((st + vMapUv.x) / 4.0, vMapUv.y));
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.18, ck.a * 0.95);
            diffuseColor.rgb *= 1.0 - vDamage * 0.28;
          }`);
    };
  }
  return m;
}

export class World {
  constructor(scene, texs, crackTex) {
    this.scene = scene;
    this.mat = new Uint8Array(N);
    this.hp = new Float32Array(N);
    this.tint = new Uint32Array(N); // packed rgb
    this.inst = new Int32Array(N).fill(-1);
    this.flags = new Uint8Array(N); // bit0: part of house (for destruction %), bit1: crumbling
    this.meshes = [];
    this.instCell = [];
    this.damageAttr = [];
    this.texs = texs; this.crackTex = crackTex;
    this.dirty = false;
    this.crumbling = new Set();
    this.listeners = { removed: null, chunk: null, crumble: null };
    this.totalHouse = 0; this.removedHouse = 0;
    this.teamTotal = [0, 0]; this.teamRemoved = [0, 0];
    this._v = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
    this.cost = new Int16Array(N);
    this.comp = new Int32Array(N);
    this.queue = new Int32Array(N * 2);
  }

  set(i, j, k, m, color, house = true) {
    if (!inBounds(i, j, k)) return;
    const c = idx(i, j, k);
    this.mat[c] = m;
    if (m) {
      const def = MATS[m];
      this.hp[c] = def.hp * (0.85 + Math.random() * 0.3);
      this.tint[c] = color != null ? color : def.color;
      this.flags[c] = house === true ? 1 : house === false ? 0 : house;
    } else { this.flags[c] = 0; }
  }
  get(i, j, k) { return inBounds(i, j, k) ? this.mat[idx(i, j, k)] : 0; }
  box(i0, j0, k0, i1, j1, k1, m, color, house = true) {
    for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) this.set(i, j, k, m, color, house);
  }
  // world metres -> cell index helpers
  ci(x) { return Math.floor((x - OX) / VOX); }
  ck(z) { return Math.floor((z - OZ) / VOX); }

  // ---------- level building ----------
  buildLevel(layout) {
    this.mat.fill(0); this.flags.fill(0); this.inst.fill(-1);
    this.crumbling.clear();
    if (layout.mode === 'duel') return this.buildDuel(layout);
    const H = layout.house;
    const i0 = this.ci(H.x0), i1 = this.ci(H.x1) - 1, k0 = this.ck(H.z0), k1 = this.ck(H.z1) - 1;
    const W = i1 - i0 + 1, D = k1 - k0 + 1;
    const peach = 0xf2c7a0, teal = 0xa7d3cf;
    // foundation
    this.box(i0 - 1, 0, k0 - 1, i1 + 1, 0, k1 + 1, MAT.FOUND, null, false);
    // ground floor walls j=1..6 (brick), upper j=8..13 (plaster)
    const wall = (j0, j1, m, col) => {
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) { this.set(i, j, k0, m, col); this.set(i, j, k1, m, col); }
        for (let k = k0; k <= k1; k++) { this.set(i0, j, k, m, col); this.set(i1, j, k, m, col); }
      }
    };
    wall(1, 6, MAT.BRICK, null);
    wall(8, 13, MAT.PLASTER, peach);
    // concrete columns at corners + mid points
    const cols = [[i0, k0], [i1, k0], [i0, k1], [i1, k1], [i0 + (W >> 1), k0], [i0 + (W >> 1), k1], [i0, k0 + (D >> 1)], [i1, k0 + (D >> 1)]];
    for (const [ci, ck] of cols) for (let j = 1; j <= 13; j++) this.set(ci, j, ck, MAT.CONCRETE);
    // slabs: concrete floor between storeys, ceiling under roof
    this.box(i0, 7, k0, i1, 7, k1, MAT.CONCRETE, 0xc9c6bf);
    this.box(i0, 14, k0, i1, 14, k1, MAT.CONCRETE, 0xc9c6bf);
    // ground-floor interior plaster wall with doorway
    const midI = i0 + (W >> 1) - 2;
    for (let j = 1; j <= 6; j++) for (let k = k0 + 1; k < k1; k++) {
      if (j <= 4 && k >= k0 + 6 && k <= k0 + 8) continue;
      this.set(midI, j, k, MAT.PLASTER, 0xe9e4da);
    }
    // front door (front = k1 side, facing +z / street)
    const doorI = i0 + 4;
    for (let j = 1; j <= 4; j++) for (let i = doorI; i <= doorI + 1; i++) this.set(i, j, k1, MAT.WOOD, 0x8a5a32);
    for (let j = 1; j <= 5; j++) { this.set(doorI - 1, j, k1, MAT.TRIM); this.set(doorI + 2, j, k1, MAT.TRIM); }
    for (let i = doorI - 1; i <= doorI + 2; i++) this.set(i, 5, k1, MAT.TRIM);
    // windows: [i or k start, along axis, wall side]
    const win = (side, a0, j0, w, h) => {
      for (let j = j0 - 1; j <= j0 + h; j++) for (let a = a0 - 1; a <= a0 + w; a++) {
        const inner = j >= j0 && j < j0 + h && a >= a0 && a < a0 + w;
        const p = side === 'front' ? [a, j, k1] : side === 'back' ? [a, j, k0] : side === 'left' ? [i0, j, a] : [i1, j, a];
        // keep structural columns intact
        if (this.mat[idx(p[0], p[1], p[2])] === MAT.CONCRETE) continue;
        this.set(p[0], p[1], p[2], inner ? MAT.GLASS : MAT.TRIM);
      }
    };
    win('front', i0 + 9, 2, 3, 3); win('front', i0 + 15, 2, 3, 3);
    win('front', i0 + 3, 9, 3, 3); win('front', i0 + 9, 9, 3, 3); win('front', i0 + 15, 9, 3, 3);
    win('back', i0 + 4, 2, 3, 3); win('back', i0 + 15, 9, 3, 3);
    win('left', k0 + 4, 2, 3, 3); win('left', k0 + 9, 9, 3, 3);
    win('right', k0 + 9, 2, 3, 3); win('right', k0 + 4, 9, 3, 3);
    // balcony: wood floor sticking out of front at j=7, metal railing
    for (let i = i0 + 8; i <= i0 + 18; i++) for (let k = k1 + 1; k <= k1 + 3; k++) this.set(i, 7, k, MAT.WOOD, 0xa77a48);
    for (let i = i0 + 8; i <= i0 + 18; i++) { this.set(i, 8, k1 + 3, MAT.METAL, 0x3c4450); if (i % 2 === 0) this.set(i, 9, k1 + 3, MAT.METAL, 0x3c4450); }
    for (let k = k1 + 1; k <= k1 + 3; k++) { this.set(i0 + 8, 8, k, MAT.METAL, 0x3c4450); this.set(i0 + 18, 8, k, MAT.METAL, 0x3c4450); }
    // balcony door on second floor
    for (let j = 8; j <= 11; j++) for (let i = i0 + 12; i <= i0 + 13; i++) this.set(i, j, k1, MAT.GLASS);
    // gabled roof along x (ridge parallel to x), 2-cell thick steps
    const levels = Math.ceil(D / 2);
    for (let L = 0; L < levels; L++) {
      const j = 15 + L;
      const kf = k1 + 1 - L, kb = k0 - 1 + L; // overhang by one cell
      for (let i = i0 - 1; i <= i1 + 1; i++) {
        for (const k of [kf, kf - 1, kb, kb + 1]) if (k >= kb && k <= kf) this.set(i, j, k, MAT.TILE, ((i + L) & 1) ? 0xc65a3c : 0xb9502f);
      }
      // gable walls (plaster) fill triangle at both ends
      for (let k = kb + 2; k <= kf - 2; k++) { this.set(i0, j, k, MAT.PLASTER, peach); this.set(i1, j, k, MAT.PLASTER, peach); }
    }
    // chimney
    for (let j = 15; j <= 22; j++) { this.set(i0 + 4, j, k0 + 4, MAT.BRICK); this.set(i0 + 5, j, k0 + 4, MAT.BRICK); }
    // ---- garage (left of the house): brick walls, metal roll door, flat concrete roof
    const G = layout.garage;
    const g0 = this.ci(G.x0), g1 = this.ci(G.x1) - 1, gk0 = this.ck(G.z0), gk1 = this.ck(G.z1) - 1;
    this.box(g0, 0, gk0, g1, 0, gk1, MAT.FOUND, null, false);
    for (let j = 1; j <= 5; j++) {
      for (let i = g0; i <= g1; i++) { this.set(i, j, gk0, MAT.BRICK, 0xd9d2c3); this.set(i, j, gk1, MAT.METAL, j % 2 ? 0x6d8fb3 : 0x5f82a8); }
      for (let k = gk0; k <= gk1; k++) { this.set(g0, j, k, MAT.BRICK, 0xd9d2c3); this.set(g1, j, k, MAT.BRICK, 0xd9d2c3); }
    }
    for (let j = 1; j <= 5; j++) { this.set(g0, j, gk1, MAT.CONCRETE); this.set(g1, j, gk1, MAT.CONCRETE); }
    this.box(g0, 6, gk0, g1, 6, gk1, MAT.CONCRETE, 0xb5b2aa);
    // ---- wooden fence along front yard, with gate gap
    const fk = this.ck(layout.fenceZ);
    for (let i = this.ci(-14); i <= this.ci(12); i++) {
      if (Math.abs(OX + (i + 0.5) * VOX - (H.x0 + 2.5)) < 1.1) continue; // gate in front of door
      if (i >= g0 && i <= g1) continue; // driveway
      this.set(i, 0, fk, MAT.WOOD, 0xd8c3a0, false);
      this.set(i, 1, fk, MAT.WOOD, 0xd8c3a0, false);
      if (i % 3 === 0) this.set(i, 2, fk, MAT.WOOD, 0xd8c3a0, false);
    }
    // ---- stacked crates & a low concrete wall on the right side of the yard
    const crate = (x, z, h) => { const a = this.ci(x), b = this.ck(z); for (let j = 0; j < h; j++) this.box(a, j, b, a + 1, j, b + 1, MAT.WOOD, 0xb88a52, false); };
    crate(8.2, -1.0, 2); crate(8.2, 0.2, 1); crate(9.4, -1.0, 1);
    for (let i = this.ci(7); i <= this.ci(12); i++) for (let j = 0; j <= 2; j++) this.set(i, j, this.ck(-6), MAT.CONCRETE, 0xb0aea8, false);
    // count house cells for destruction %
    this.totalHouse = 0; this.removedHouse = 0;
    for (let c = 0; c < N; c++) if (this.mat[c] && (this.flags[c] & 1)) this.totalHouse++;
  }

  // ---------- duel: two mirrored forts ----------
  buildFort(f, team) {
    const fl = 1 | (team === 0 ? 2 : 4);
    const i0 = this.ci(f.x0), i1 = this.ci(f.x1) - 1, k0 = this.ck(f.z0), k1 = this.ck(f.z1) - 1;
    const W = i1 - i0 + 1, D = k1 - k0 + 1;
    const kf = f.face < 0 ? k0 : k1, kb = f.face < 0 ? k1 : k0; // front faces the enemy
    const upper = f.upper, trim = f.trim;
    this.box(i0 - 1, 0, k0 - 1, i1 + 1, 0, k1 + 1, MAT.FOUND, null, false);
    const ring = (j0, j1, m, col) => { for (let j = j0; j <= j1; j++) { for (let i = i0; i <= i1; i++) { this.set(i, j, k0, m, col, fl); this.set(i, j, k1, m, col, fl); } for (let k = k0; k <= k1; k++) { this.set(i0, j, k, m, col, fl); this.set(i1, j, k, m, col, fl); } } };
    ring(1, 6, MAT.BRICK, null);
    ring(8, 13, MAT.PLASTER, upper);
    ring(15, 15, MAT.BRICK, 0xd8cfc0);
    // crenellated parapet: the boss can hide behind the merlons
    for (let i = i0; i <= i1; i++) if (((i - i0) >> 1) % 2 === 0) { this.set(i, 16, k0, MAT.BRICK, 0xd8cfc0, fl); this.set(i, 16, k1, MAT.BRICK, 0xd8cfc0, fl); }
    for (let k = k0; k <= k1; k++) if (((k - k0) >> 1) % 2 === 0) { this.set(i0, 16, k, MAT.BRICK, 0xd8cfc0, fl); this.set(i1, 16, k, MAT.BRICK, 0xd8cfc0, fl); }
    const cols = [[i0, k0], [i1, k0], [i0, k1], [i1, k1], [i0 + (W >> 1), k0], [i0 + (W >> 1), k1], [i0, k0 + (D >> 1)], [i1, k0 + (D >> 1)], [i0 + (W >> 1), k0 + (D >> 1)]];
    for (const [a, b] of cols) for (let j = 1; j <= 13; j++) this.set(a, j, b, MAT.CONCRETE, null, fl);
    this.box(i0, 7, k0, i1, 7, k1, MAT.CONCRETE, 0xc9c6bf, fl);
    this.box(i0, 14, k0, i1, 14, k1, MAT.CONCRETE, 0xc9c6bf, fl);
    // interior wall
    const mid = i0 + (W >> 1) + 3;
    for (let j = 1; j <= 6; j++) for (let k = k0 + 1; k < k1; k++) if (!(j <= 4 && Math.abs(k - (k0 + (D >> 1))) <= 1)) this.set(mid, j, k, MAT.PLASTER, 0xe9e4da, fl);
    // windows (front: 2 down, 3 up; sides: 1 each floor)
    const win = (side, a0, j0, ww, hh) => {
      for (let j = j0 - 1; j <= j0 + hh; j++) for (let a = a0 - 1; a <= a0 + ww; a++) {
        const inner = j >= j0 && j < j0 + hh && a >= a0 && a < a0 + ww;
        const p = side === 'f' ? [a, j, kf] : side === 'l' ? [i0, j, a] : [i1, j, a];
        if (this.mat[idx(p[0], p[1], p[2])] === MAT.CONCRETE) continue;
        this.set(p[0], p[1], p[2], inner ? MAT.GLASS : MAT.TRIM, inner ? null : trim, fl);
      }
    };
    win('f', i0 + 3, 2, 3, 3); win('f', i0 + 14, 2, 3, 3);
    win('f', i0 + 2, 9, 3, 3); win('f', i0 + 8, 9, 3, 3); win('f', i0 + 15, 9, 3, 3);
    win('l', k0 + 4, 2, 2, 3); win('r', k0 + 4, 9, 2, 3); win('l', k0 + 6, 9, 2, 3); win('r', k0 + 6, 2, 2, 3);
    // back door
    for (let j = 1; j <= 4; j++) for (let i = i0 + 5; i <= i0 + 6; i++) this.set(i, j, kb, MAT.WOOD, 0x8a5a32, fl);
    // team banner stripe on the parapet
    for (let i = i0 + 2; i <= i1 - 2; i++) this.set(i, 15, kf, MAT.PLASTER, f.banner, fl);
    // wooden water-tank tower on the roof corner (a nice thing to topple)
    // back corner on the boss's left, so it never blocks the over-the-shoulder camera
    const ti = f.face < 0 ? i0 + 2 : i1 - 3, tk = f.face < 0 ? k1 - 3 : k0 + 2;
    for (let j = 15; j <= 17; j++) { this.set(ti, j, tk, MAT.WOOD, 0x8a5a32, fl); this.set(ti + 1, j, tk, MAT.WOOD, 0x8a5a32, fl); this.set(ti, j, tk + 1, MAT.WOOD, 0x8a5a32, fl); this.set(ti + 1, j, tk + 1, MAT.WOOD, 0x8a5a32, fl); }
    this.box(ti - 1, 18, tk - 1, ti + 2, 19, tk + 2, MAT.METAL, f.tank, fl);
  }

  buildDuel(layout) {
    for (let t = 0; t < 2; t++) this.buildFort(layout.forts[t], t);
    // mid-field cover: low concrete barricade with a gap, stacked crates, a little wooden shed
    for (let i = this.ci(-4); i <= this.ci(4); i++) { if (Math.abs(OX + (i + 0.5) * VOX) < 0.7) continue; for (let j = 0; j <= 2; j++) this.set(i, j, this.ck(-2), MAT.CONCRETE, 0xb0aea8, false); }
    const crate = (x, z, h) => { const a = this.ci(x), b = this.ck(z); for (let j = 0; j < h; j++) this.box(a, j, b, a + 1, j, b + 1, MAT.WOOD, 0xb88a52, false); };
    crate(-5.5, 4.5, 2); crate(-4.5, 4.5, 1); crate(5, -8, 2); crate(6, -8.2, 1); crate(4.6, 5.4, 1);
    const s0 = this.ci(9), s1 = this.ci(12), k0 = this.ck(-6), k1 = this.ck(-4);
    for (let j = 0; j <= 4; j++) for (let i = s0; i <= s1; i++) for (let k = k0; k <= k1; k++) {
      const edge = i === s0 || i === s1 || k === k0 || k === k1;
      if (edge && !(j <= 3 && k === k1 && i === s0 + 2)) this.set(i, j, k, MAT.WOOD, 0x9c7a50, false);
    }
    this.box(s0, 5, k0, s1, 5, k1, MAT.METAL, 0x7d8fa1, false);
    this.totalHouse = 0; this.removedHouse = 0; this.teamTotal = [0, 0]; this.teamRemoved = [0, 0];
    for (let c = 0; c < N; c++) if (this.mat[c]) {
      if (this.flags[c] & 1) this.totalHouse++;
      if (this.flags[c] & 2) this.teamTotal[0]++;
      if (this.flags[c] & 4) this.teamTotal[1]++;
    }
  }

  // ---------- rendering ----------
  buildMeshes(quality) {
    for (const m of this.meshes) if (m) { this.scene.remove(m); m.geometry.dispose(); }
    this.meshes = []; this.instCell = []; this.damageAttr = [];
    const counts = new Array(NMAT).fill(0);
    for (let c = 0; c < N; c++) if (this.mat[c]) counts[this.mat[c]]++;
    const geo = new THREE.BoxGeometry(VOX, VOX, VOX);
    for (let m = 1; m < NMAT; m++) {
      const cap = counts[m];
      if (!cap) { this.meshes[m] = null; continue; }
      const g = geo.clone();
      const dmg = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      dmg.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aDamage', dmg);
      const mesh = new THREE.InstancedMesh(g, makeVoxelMaterial(m, this.texs, this.crackTex), cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = m !== MAT.GLASS && quality.shadows;
      mesh.receiveShadow = m !== MAT.GLASS;
      mesh.count = 0;
      mesh.frustumCulled = false;
      if (m === MAT.GLASS) mesh.renderOrder = 2;
      this.meshes[m] = mesh; this.instCell[m] = new Int32Array(cap); this.damageAttr[m] = dmg;
      this.scene.add(mesh);
    }
    const v = this._v, M = this._m, col = this._c;
    for (let c = 0; c < N; c++) {
      const m = this.mat[c];
      if (!m) continue;
      const mesh = this.meshes[m];
      const n = mesh.count++;
      cellCenter(c, v);
      M.makeTranslation(v.x, v.y, v.z);
      mesh.setMatrixAt(n, M);
      col.setHex(this.tint[c]);
      const jit = 0.94 + Math.random() * 0.1;
      col.r *= jit; col.g *= jit; col.b *= jit;
      mesh.setColorAt(n, col);
      this.inst[c] = n; this.instCell[m][n] = c;
      this.damageAttr[m].array[n] = 0;
    }
    for (const mesh of this.meshes) if (mesh) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  setShadows(on) { for (let m = 1; m < NMAT; m++) if (this.meshes[m]) this.meshes[m].castShadow = on && m !== MAT.GLASS; }

  _removeInstance(c) {
    const m = this.mat[c], mesh = this.meshes[m];
    const n = this.inst[c];
    if (!mesh || n < 0) return;
    const last = mesh.count - 1;
    if (n !== last) {
      const lc = this.instCell[m][last];
      mesh.getMatrixAt(last, this._m); mesh.setMatrixAt(n, this._m);
      mesh.getColorAt(last, this._c); mesh.setColorAt(n, this._c);
      const da = this.damageAttr[m].array; da[n] = da[last];
      this.instCell[m][n] = lc; this.inst[lc] = n;
    }
    mesh.count = last;
    this.inst[c] = -1;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.damageAttr[m].needsUpdate = true;
  }

  _updateDamageVisual(c) {
    const m = this.mat[c], n = this.inst[c];
    if (n < 0 || !this.damageAttr[m]) return;
    const d = 1 - this.hp[c] / MATS[m].hp;
    this.damageAttr[m].array[n] = Math.max(0, Math.min(1, d));
    this.damageAttr[m].needsUpdate = true;
  }

  // ---------- queries ----------
  solidCell(c) { return c >= 0 && this.mat[c] !== 0; }
  matAt(x, y, z) { const c = worldToCell(x, y, z); return c < 0 ? 0 : this.mat[c]; }

  // Amanatides-Woo voxel traversal. cb(cell, t, normalAxis, sign) -> return true to stop.
  traverse(o, d, maxT, cb) {
    let i = Math.floor((o.x - OX) / VOX), j = Math.floor(o.y / VOX), k = Math.floor((o.z - OZ) / VOX);
    const sx = d.x > 0 ? 1 : -1, sy = d.y > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
    const tdx = Math.abs(VOX / (d.x || 1e-9)), tdy = Math.abs(VOX / (d.y || 1e-9)), tdz = Math.abs(VOX / (d.z || 1e-9));
    const bx = OX + (i + (sx > 0 ? 1 : 0)) * VOX, by = (j + (sy > 0 ? 1 : 0)) * VOX, bz = OZ + (k + (sz > 0 ? 1 : 0)) * VOX;
    let tmx = d.x ? (bx - o.x) / d.x : 1e9, tmy = d.y ? (by - o.y) / d.y : 1e9, tmz = d.z ? (bz - o.z) / d.z : 1e9;
    let t = 0, axis = -1;
    for (let s = 0; s < 600 && t <= maxT; s++) {
      if (inBounds(i, j, k)) {
        const c = idx(i, j, k);
        if (this.mat[c] && cb(c, t, axis, axis === 0 ? -sx : axis === 1 ? -sy : -sz)) return;
      } else if (j < 0 || j >= NY + 4) {
        // left the vertical range and moving away: stop
        if ((j < 0 && sy < 0) || (j >= NY && sy > 0)) return;
      }
      if (tmx < tmy && tmx < tmz) { i += sx; t = tmx; tmx += tdx; axis = 0; }
      else if (tmy < tmz) { j += sy; t = tmy; tmy += tdy; axis = 1; }
      else { k += sz; t = tmz; tmz += tdz; axis = 2; }
    }
  }

  raycast(o, d, maxT) {
    let hit = null;
    this.traverse(o, d, maxT, (c, t, axis, sign) => {
      const n = new THREE.Vector3();
      if (axis === 0) n.x = sign; else if (axis === 1) n.y = sign; else if (axis === 2) n.z = sign; else n.copy(d).negate();
      hit = { cell: c, t, normal: n, point: new THREE.Vector3().copy(d).multiplyScalar(t).add(o), mat: this.mat[c] };
      return true;
    });
    return hit;
  }

  // ---------- damage ----------
  // returns true if destroyed
  damageCell(c, amount, info) {
    const m = this.mat[c];
    if (!m) return false;
    this.hp[c] -= amount;
    if (this.hp[c] <= 0) { this.removeCell(c, info); return true; }
    this._updateDamageVisual(c);
    return false;
  }

  removeCell(c, info) {
    const m = this.mat[c];
    if (!m) return;
    this._removeInstance(c);
    if (this.flags[c] & 1) this.removedHouse++;
    if (this.flags[c] & 2) this.teamRemoved[0]++;
    if (this.flags[c] & 4) this.teamRemoved[1]++;
    this.mat[c] = 0;
    this.crumbling.delete(c);
    this.flags[c] = 0;
    this.dirty = true;
    if (this.listeners.removed) this.listeners.removed(c, m, info);
  }

  // detach cells to a physics chunk (no debris spawn, no value counted twice)
  takeCells(cells) {
    const out = [];
    for (const c of cells) {
      const m = this.mat[c];
      if (!m) continue;
      out.push({ c, m, tint: this.tint[c], dmg: 1 - this.hp[c] / MATS[m].hp });
      this._removeInstance(c);
      if (this.flags[c] & 1) this.removedHouse++;
      if (this.flags[c] & 2) this.teamRemoved[0]++;
      if (this.flags[c] & 4) this.teamRemoved[1]++;
      this.mat[c] = 0; this.flags[c] = 0; this.crumbling.delete(c);
    }
    this.dirty = true;
    return out;
  }

  // ---------- structural integrity ----------
  // 0-1 BFS from foundation: vertical-up is free, horizontal costs 1 limited by material span.
  // Unreached cells fall as chunks. Then per-component load check marks overloaded layers to crumble.
  integrity() {
    if (!this.dirty) return;
    this.dirty = false;
    const mat = this.mat, cost = this.cost, q = this.queue;
    cost.fill(32767);
    const HALF = N; let head = HALF, tail = HALF; // deque in [head, tail)
    const layer = NX * NZ;
    for (let c = 0; c < layer; c++) if (mat[c]) { cost[c] = 0; q[tail++] = c; }
    while (head < tail) {
      const u = q[head++];
      const cu = cost[u];
      const i = u % NX, k = ((u / NX) | 0) % NZ, j = (u / layer) | 0;
      // up (free)
      if (j + 1 < NY) { const v = u + layer; if (mat[v] && cost[v] > cu) { cost[v] = cu; q[--head] = v; } }
      // down (hanging, costs 2)
      if (j > 0) { const v = u - layer; if (mat[v] && cost[v] > cu + 2 && cu + 2 <= MATS[mat[v]].span) { cost[v] = cu + 2; q[tail++] = v; } }
      const nc = cu + 1;
      if (i > 0) { const v = u - 1; if (mat[v] && cost[v] > nc && nc <= MATS[mat[v]].span) { cost[v] = nc; q[tail++] = v; } }
      if (i + 1 < NX) { const v = u + 1; if (mat[v] && cost[v] > nc && nc <= MATS[mat[v]].span) { cost[v] = nc; q[tail++] = v; } }
      if (k > 0) { const v = u - NX; if (mat[v] && cost[v] > nc && nc <= MATS[mat[v]].span) { cost[v] = nc; q[tail++] = v; } }
      if (k + 1 < NZ) { const v = u + NX; if (mat[v] && cost[v] > nc && nc <= MATS[mat[v]].span) { cost[v] = nc; q[tail++] = v; } }
      if (head < 2 || tail > q.length - 2) { // compact (rare)
        const len = tail - head; q.copyWithin(HALF - (len >> 1), head, tail); head = HALF - (len >> 1); tail = head + len;
      }
    }
    // gather unsupported cells into 6-connected components
    const comp = this.comp; comp.fill(-1);
    const chunks = [];
    for (let c = 0; c < N; c++) {
      if (!mat[c] || cost[c] !== 32767 || comp[c] !== -1) continue;
      const cells = [];
      let qh = 0, qt = 0; q[qt++] = c; comp[c] = chunks.length;
      while (qh < qt) {
        const u = q[qh++]; cells.push(u);
        const i = u % NX, k = ((u / NX) | 0) % NZ, j = (u / layer) | 0;
        const nb = [i > 0 ? u - 1 : -1, i + 1 < NX ? u + 1 : -1, k > 0 ? u - NX : -1, k + 1 < NZ ? u + NX : -1, j > 0 ? u - layer : -1, j + 1 < NY ? u + layer : -1];
        for (const v of nb) if (v >= 0 && mat[v] && cost[v] === 32767 && comp[v] === -1) { comp[v] = chunks.length; q[qt++] = v; }
      }
      chunks.push(cells);
    }
    for (const cells of chunks) if (this.listeners.chunk) this.listeners.chunk(cells);
    this._loadCheck();
  }

  // overloaded thin supports crumble progressively (pillar shot to a sliver -> collapse with creaks)
  _loadCheck() {
    const layer = NX * NZ;
    // label supported components
    const comp = this.comp; comp.fill(-1);
    const q = this.queue, mat = this.mat;
    let id = 0;
    for (let c = 0; c < layer; c++) {
      if (!mat[c] || comp[c] !== -1) continue;
      const counts = new Int32Array(NY);
      const members = [];
      let qh = 0, qt = 0; q[qt++] = c; comp[c] = id;
      while (qh < qt) {
        const u = q[qh++]; members.push(u);
        const j = (u / layer) | 0; counts[j]++;
        const i = u % NX, k = ((u / NX) | 0) % NZ;
        const nb = [i > 0 ? u - 1 : -1, i + 1 < NX ? u + 1 : -1, k > 0 ? u - NX : -1, k + 1 < NZ ? u + NX : -1, j > 0 ? u - layer : -1, j + 1 < NY ? u + layer : -1];
        for (const v of nb) if (v >= 0 && mat[v] && comp[v] === -1) { comp[v] = id; q[qt++] = v; }
      }
      id++;
      if (members.length < 60) continue;
      let above = 0;
      for (let j = NY - 1; j >= 1; j--) {
        const n = counts[j];
        if (n > 0 && above > 0) {
          const ratio = above / n;
          if (ratio > 46) {
            let any = false;
            for (const u of members) if (((u / layer) | 0) === j && !this.crumbling.has(u)) { this.crumbling.add(u); any = true; }
            if (any && this.listeners.crumble) this.listeners.crumble(j, ratio);
            break;
          }
        }
        above += n;
      }
    }
  }

  // apply progressive crumble damage
  updateCrumble(dt) {
    if (!this.crumbling.size) return;
    const arr = [...this.crumbling];
    for (const c of arr) {
      if (!this.mat[c]) { this.crumbling.delete(c); continue; }
      const def = MATS[this.mat[c]];
      this.damageCell(c, def.hp * dt * (0.35 + Math.random() * 0.9), { crumble: true });
    }
  }
}
