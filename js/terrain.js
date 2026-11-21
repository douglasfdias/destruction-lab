// Deformable ground (craters) with a painted lot/street texture.
import * as THREE from '../lib/three.module.min.js';

export class Terrain {
  constructor(scene, groundTex, layout) {
    this.size = layout.size; // metres covered by the deformable grid
    this.res = 0.5;
    this.n = Math.round(this.size / this.res) + 1;
    this.h = new Float32Array(this.n * this.n);
    const geo = new THREE.PlaneGeometry(this.size, this.size, this.n - 1, this.n - 1);
    geo.rotateX(-Math.PI / 2);
    const cols = new Float32Array(this.n * this.n * 3).fill(1);
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: groundTex, vertexColors: true, roughness: 0.95 }));
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    // outer ground ring (non-deformable) so the world doesn't end abruptly
    const outer = new THREE.Mesh(new THREE.RingGeometry(this.size * 0.7, 400, 48, 1), new THREE.MeshStandardMaterial({ color: 0x6a9a4c, roughness: 1 }));
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; outer.receiveShadow = true;
    scene.add(outer);
    // asphalt continues along the street beyond the painted area
    const st = layout.street;
    for (const sx of [-1, 1]) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(300, st.z1 - st.z0), new THREE.MeshStandardMaterial({ color: 0x3b3d42, roughness: 0.9 }));
      road.rotation.x = -Math.PI / 2;
      road.position.set(sx * (this.size / 2 + 150), -0.01, (st.z0 + st.z1) / 2);
      road.receiveShadow = true;
      scene.add(road);
    }
  }

  reset() {
    this.h.fill(0);
    const pos = this.geo.attributes.position, col = this.geo.attributes.color;
    for (let i = 0; i < pos.count; i++) { pos.setY(i, 0); col.setXYZ(i, 1, 1, 1); }
    pos.needsUpdate = true; col.needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  // gentle mounds of dirt for the duel lot (kept away from voxel structures, which sit at y=0)
  addHills(list) {
    const n = this.n, res = this.res, pos = this.geo.attributes.position;
    for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
      const x = i * res - this.size / 2, z = k * res - this.size / 2;
      let h = 0;
      for (const m of list) h += m.h * Math.exp(-(((x - m.x) ** 2) / (m.rx * m.rx) + ((z - m.z) ** 2) / (m.rz * m.rz)));
      if (h > 0.01) { const id = i + k * n; this.h[id] += h; pos.setY(id, this.h[id]); }
    }
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  setTexture(tex) { this.mesh.material.map = tex; this.mesh.material.needsUpdate = true; }

  heightAt(x, z) {
    const fx = (x + this.size / 2) / this.res, fz = (z + this.size / 2) / this.res;
    if (fx < 0 || fz < 0 || fx >= this.n - 1 || fz >= this.n - 1) return 0;
    const i = Math.floor(fx), k = Math.floor(fz), tx = fx - i, tz = fz - k;
    const n = this.n, h = this.h;
    const a = h[i + k * n], b = h[i + 1 + k * n], c = h[i + (k + 1) * n], d = h[i + 1 + (k + 1) * n];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  // bowl-shaped crater with a raised rim and scorched colour
  crater(x, z, radius, depth) {
    const n = this.n, res = this.res;
    const ci = Math.round((x + this.size / 2) / res), ck = Math.round((z + this.size / 2) / res);
    const R = Math.ceil(radius * 1.5 / res);
    const pos = this.geo.attributes.position, col = this.geo.attributes.color;
    for (let dk = -R; dk <= R; dk++) for (let di = -R; di <= R; di++) {
      const i = ci + di, k = ck + dk;
      if (i < 1 || k < 1 || i >= n - 1 || k >= n - 1) continue;
      const d = Math.hypot(di * res, dk * res) / radius;
      let dh = 0;
      if (d < 1) dh = -depth * (1 - d * d) * (0.85 + Math.random() * 0.3);
      else if (d < 1.45) dh = depth * 0.22 * Math.sin((d - 1) / 0.45 * Math.PI);
      const id = i + k * n;
      this.h[id] = Math.max(-1.6, this.h[id] + dh);
      pos.setY(id, this.h[id]);
      if (d < 1.6) {
        const s = Math.min(1, (1.6 - d) / 1.2);
        const dark = 1 - 0.45 * s;
        col.setXYZ(id, Math.min(col.getX(id), dark * 0.95), Math.min(col.getY(id), dark * 0.9), Math.min(col.getZ(id), dark * 0.85));
      }
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  // scorch only (no dent), used for small blasts above ground
  scorch(x, z, radius) {
    const n = this.n, res = this.res;
    const ci = Math.round((x + this.size / 2) / res), ck = Math.round((z + this.size / 2) / res);
    const R = Math.ceil(radius / res);
    const col = this.geo.attributes.color;
    for (let dk = -R; dk <= R; dk++) for (let di = -R; di <= R; di++) {
      const i = ci + di, k = ck + dk;
      if (i < 0 || k < 0 || i >= n || k >= n) continue;
      const d = Math.hypot(di * res, dk * res) / radius;
      if (d >= 1) continue;
      const id = i + k * n, dark = 1 - 0.5 * (1 - d) * (0.7 + Math.random() * 0.3);
      col.setXYZ(id, Math.min(col.getX(id), dark), Math.min(col.getY(id), dark * 0.96), Math.min(col.getZ(id), dark * 0.92));
    }
    col.needsUpdate = true;
  }

  // ray vs heightfield (marching)
  raycast(o, d, maxT) {
    let prev = o.y - this.heightAt(o.x, o.z);
    if (prev < 0) return { t: 0, point: o.clone(), normal: new THREE.Vector3(0, 1, 0) };
    const step = Math.min(0.25, maxT);
    for (let t = step; t <= maxT + 1e-6; t = (t >= maxT ? maxT + 1 : Math.min(maxT, t + step))) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const cur = y - this.heightAt(x, z);
      if (cur < 0) {
        const tt = t - step * cur / (cur - prev);
        const p = new THREE.Vector3(o.x + d.x * tt, o.y + d.y * tt, o.z + d.z * tt);
        return { t: tt, point: p, normal: new THREE.Vector3(0, 1, 0) };
      }
      prev = cur;
      if (y > 40 && d.y > 0) return null;
    }
    return null;
  }
}
