// Procedural canvas textures (no image files needed).
import * as THREE from '../lib/three.module.min.js';

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function rnd(a, b) { return a + Math.random() * (b - a); }
function noise(g, w, h, amt, alpha = 1) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amt;
    d[i] += n; d[i + 1] += n; d[i + 2] += n; d[i + 3] = d[i + 3] * alpha;
  }
  g.putImageData(img, 0, 0);
}
// darken the borders so each voxel reads as a chunky block
function bevel(g, w, h, px = 3, a = 0.28) {
  for (let i = 0; i < px; i++) {
    const s = a * (1 - i / px);
    g.fillStyle = `rgba(0,0,0,${s})`;
    g.fillRect(0, h - 1 - i, w, 1); g.fillRect(w - 1 - i, 0, 1, h);
    g.fillStyle = `rgba(255,255,255,${s * 0.5})`;
    g.fillRect(0, i, w, 1); g.fillRect(i, 0, 1, h);
  }
}
function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export function makeMaterialTextures() {
  const T = {};
  const S = 128;
  // brick: 4 courses per voxel, white-ish (tinted by instance color)
  {
    const [c, g] = cv(S, S);
    g.fillStyle = '#b9b2a8'; g.fillRect(0, 0, S, S); // mortar
    const rows = 4, bh = S / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (S / 4);
      for (let x = -S / 2; x < S; x += S / 2) {
        const v = rnd(-18, 18);
        g.fillStyle = `rgb(${226 + v},${220 + v},${214 + v})`;
        g.fillRect(x + off + 3, r * bh + 3, S / 2 - 6, bh - 6);
        g.fillStyle = 'rgba(0,0,0,0.08)';
        g.fillRect(x + off + 3, r * bh + bh - 7, S / 2 - 6, 4);
      }
    }
    noise(g, S, S, 26); bevel(g, S, S);
    T.brick = tex(c);
  }
  // concrete
  {
    const [c, g] = cv(S, S);
    g.fillStyle = '#d8d8d6'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${rnd(0.03, 0.09)})`;
      g.beginPath(); g.arc(rnd(0, S), rnd(0, S), rnd(1, 7), 0, 7); g.fill();
    }
    noise(g, S, S, 30); bevel(g, S, S, 3, 0.22);
    T.concrete = tex(c);
  }
  // plaster (painted wall)
  {
    const [c, g] = cv(S, S);
    g.fillStyle = '#f2f0ea'; g.fillRect(0, 0, S, S);
    noise(g, S, S, 14); bevel(g, S, S, 2, 0.12);
    T.plaster = tex(c);
  }
  // wood planks
  {
    const [c, g] = cv(S, S);
    const n = 3, pw = S / n;
    for (let i = 0; i < n; i++) {
      const v = rnd(-14, 14);
      g.fillStyle = `rgb(${200 + v},${170 + v},${130 + v})`;
      g.fillRect(i * pw, 0, pw, S);
      g.strokeStyle = 'rgba(90,55,25,0.25)'; g.lineWidth = 1;
      for (let k = 0; k < 6; k++) {
        g.beginPath();
        const x = i * pw + rnd(3, pw - 3);
        g.moveTo(x, 0);
        g.bezierCurveTo(x + rnd(-4, 4), S * 0.3, x + rnd(-4, 4), S * 0.7, x + rnd(-3, 3), S);
        g.stroke();
      }
      g.fillStyle = 'rgba(60,35,15,0.55)'; g.fillRect(i * pw, 0, 2, S);
      g.fillStyle = 'rgba(60,35,15,0.6)';
      g.beginPath(); g.arc(i * pw + pw / 2, S * 0.2, 1.6, 0, 7); g.arc(i * pw + pw / 2, S * 0.8, 1.6, 0, 7); g.fill();
    }
    noise(g, S, S, 16); bevel(g, S, S, 2, 0.2);
    T.wood = tex(c);
  }
  // roof tile
  {
    const [c, g] = cv(S, S);
    g.fillStyle = '#d9d2cc'; g.fillRect(0, 0, S, S);
    const rows = 3, rh = S / rows;
    for (let r = 0; r < rows; r++) {
      for (let x = 0; x < 4; x++) {
        const cx = x * S / 4 + ((r % 2) ? S / 8 : 0);
        const grad = g.createLinearGradient(cx, 0, cx + S / 4, 0);
        grad.addColorStop(0, '#c9c0b8'); grad.addColorStop(0.5, '#fbf6f1'); grad.addColorStop(1, '#b9b0a8');
        g.fillStyle = grad;
        g.fillRect(cx, r * rh, S / 4 - 1, rh - 2);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(cx, r * rh + rh - 4, S / 4 - 1, 3);
      }
    }
    noise(g, S, S, 14); bevel(g, S, S, 2, 0.2);
    T.tile = tex(c);
  }
  // corrugated metal
  {
    const [c, g] = cv(S, S);
    for (let x = 0; x < S; x++) {
      const v = Math.sin(x / S * Math.PI * 2 * 6) * 40;
      g.fillStyle = `rgb(${200 + v},${205 + v},${210 + v})`;
      g.fillRect(x, 0, 1, S);
    }
    noise(g, S, S, 10); bevel(g, S, S, 2, 0.25);
    T.metal = tex(c);
  }
  // glass: subtle streaks
  {
    const [c, g] = cv(64, 64);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(160,200,230,0.7)'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(8, 60); g.lineTo(40, 4); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.moveTo(26, 62); g.lineTo(58, 8); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 6; g.strokeRect(0, 0, 64, 64);
    T.glass = tex(c);
  }
  return T;
}

// cracks overlay atlas: 4 crack stages (unused stage 0), drawn in white on transparent
export function makeCrackTexture() {
  const S = 128;
  const [c, g] = cv(S * 4, S);
  for (let s = 1; s < 4; s++) {
    g.save(); g.translate(s * S, 0);
    g.strokeStyle = 'rgba(30,20,15,0.85)'; g.lineCap = 'round';
    const branches = s * 3;
    for (let b = 0; b < branches; b++) {
      let x = S / 2 + rnd(-10, 10), y = S / 2 + rnd(-10, 10);
      let a = rnd(0, Math.PI * 2);
      g.lineWidth = 2.5 + s * 0.4;
      g.beginPath(); g.moveTo(x, y);
      const len = 6 + s * 4;
      for (let k = 0; k < len; k++) {
        a += rnd(-0.6, 0.6); x += Math.cos(a) * 5; y += Math.sin(a) * 5;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    g.restore();
  }
  return tex(c);
}

// ground: big painted map of the lot + street (60m x 60m centred), tiles grass beyond
export function makeGroundTexture(layout) {
  const S = 2048, M = layout.size; // metres covered
  const [c, g] = cv(S, S);
  const px = v => (v + M / 2) / M * S;
  // grass
  g.fillStyle = '#6a9a4c'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const v = rnd(-1, 1);
    g.fillStyle = v > 0 ? `rgba(130,170,90,${rnd(0.1, 0.35)})` : `rgba(60,95,40,${rnd(0.1, 0.35)})`;
    g.fillRect(rnd(0, S), rnd(0, S), rnd(2, 6), rnd(2, 6));
  }
  // dirt patches in yard
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(140,110,70,${rnd(0.08, 0.2)})`;
    g.beginPath(); g.ellipse(px(rnd(-12, 12)), px(rnd(-12, 4)), rnd(8, 40), rnd(6, 26), rnd(0, 3), 0, 7); g.fill();
  }
  // driveway to garage
  g.fillStyle = '#a9a49b';
  g.fillRect(px(layout.garage.x0), px(layout.garage.z1), px(layout.garage.x1) - px(layout.garage.x0), px(layout.street.z0) - px(layout.garage.z1));
  // sidewalks
  g.fillStyle = '#b8b5ae';
  g.fillRect(0, px(layout.street.z0 - 1.6), S, px(layout.street.z0) - px(layout.street.z0 - 1.6));
  g.fillRect(0, px(layout.street.z1), S, px(layout.street.z1 + 1.6) - px(layout.street.z1));
  g.strokeStyle = 'rgba(0,0,0,0.15)'; g.lineWidth = 2;
  for (let x = -M / 2; x < M / 2; x += 1.2) {
    g.beginPath(); g.moveTo(px(x), px(layout.street.z0 - 1.6)); g.lineTo(px(x), px(layout.street.z0)); g.stroke();
    g.beginPath(); g.moveTo(px(x), px(layout.street.z1)); g.lineTo(px(x), px(layout.street.z1 + 1.6)); g.stroke();
  }
  // curb
  g.fillStyle = '#d6d3cc';
  g.fillRect(0, px(layout.street.z0) - 5, S, 5); g.fillRect(0, px(layout.street.z1), S, 5);
  // asphalt
  g.fillStyle = '#3b3d42';
  g.fillRect(0, px(layout.street.z0), S, px(layout.street.z1) - px(layout.street.z0));
  for (let i = 0; i < 14000; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${rnd(0.03, 0.1)})`;
    g.fillRect(rnd(0, S), rnd(px(layout.street.z0), px(layout.street.z1)), 2, 2);
  }
  // lane markings
  const mid = px((layout.street.z0 + layout.street.z1) / 2);
  g.fillStyle = '#e8c547';
  for (let x = 0; x < S; x += 90) g.fillRect(x, mid - 4, 50, 8);
  // patches/cracks on asphalt
  g.strokeStyle = 'rgba(20,20,20,0.5)'; g.lineWidth = 2;
  for (let i = 0; i < 25; i++) {
    let x = rnd(0, S), y = rnd(px(layout.street.z0), px(layout.street.z1));
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += rnd(-14, 14); y += rnd(-6, 6); g.lineTo(x, y); }
    g.stroke();
  }
  // house footprint shadow strip (ambient occlusion feel)
  const h = layout.house;
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(px(h.x0) - 10, px(h.z0) - 10, px(h.x1) - px(h.x0) + 20, px(h.z1) - px(h.z0) + 20);
  const t = tex(c);
  t.anisotropy = 8;
  return t;
}

// soft particle sprites in one atlas: 0 smoke, 1 fire, 2 spark/flash, 3 dust, 4 glass shard
export function makeParticleAtlas() {
  const S = 128;
  const [c, g] = cv(S * 4, S * 2);
  // smoke puff (noisy)
  {
    g.save(); g.translate(0, 0);
    for (let i = 0; i < 26; i++) {
      const x = S / 2 + rnd(-24, 24), y = S / 2 + rnd(-24, 24), r = rnd(18, 38);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    g.restore();
  }
  // fire blob
  {
    g.save(); g.translate(S, 0);
    for (let i = 0; i < 18; i++) {
      const x = S / 2 + rnd(-20, 20), y = S / 2 + rnd(-20, 20), r = rnd(16, 34);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.45)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.15)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    g.restore();
  }
  // spark / flash (hard core + glow)
  {
    g.save(); g.translate(S * 2, 0);
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.4, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.restore();
  }
  // dust (flat soft)
  {
    g.save(); g.translate(S * 3, 0);
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.restore();
  }
  // glass shard (row 2, col 0)
  {
    g.save(); g.translate(0, S);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath(); g.moveTo(S * 0.5, S * 0.1); g.lineTo(S * 0.8, S * 0.7); g.lineTo(S * 0.35, S * 0.9); g.lineTo(S * 0.2, S * 0.4); g.closePath(); g.fill();
    g.restore();
  }
  // shockwave ring (row 2, col 1)
  {
    g.save(); g.translate(S, S);
    const gr = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.75, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.restore();
  }
  const t = tex(c);
  t.generateMipmaps = true;
  return t;
}

export function makeDecalTextures() {
  const D = {};
  {
    const [c, g] = cv(64, 64);
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    gr.addColorStop(0, 'rgba(10,8,6,1)'); gr.addColorStop(0.3, 'rgba(25,20,15,0.95)');
    gr.addColorStop(0.55, 'rgba(70,60,50,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(20,15,10,0.7)'; g.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      const a = rnd(0, 6.28); g.beginPath(); g.moveTo(32, 32);
      g.lineTo(32 + Math.cos(a) * rnd(14, 28), 32 + Math.sin(a) * rnd(14, 28)); g.stroke();
    }
    D.hole = tex(c);
  }
  {
    const [c, g] = cv(256, 256);
    for (let i = 0; i < 40; i++) {
      const x = 128 + rnd(-50, 50), y = 128 + rnd(-50, 50), r = rnd(30, 90);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(15,12,10,0.35)'); gr.addColorStop(1, 'rgba(15,12,10,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    }
    D.scorch = tex(c);
  }
  {
    // window texture for background buildings
    const [c, g] = cv(128, 128);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const lit = Math.random() < 0.25;
      g.fillStyle = lit ? '#ffe7a8' : '#6f7f99';
      g.fillRect(x * 32 + 8, y * 32 + 7, 16, 18);
    }
    D.windows = tex(c);
  }
  return D;
}

// duel lot: packed dirt, gravel, tyre tracks, grass edges
export function makeDuelGroundTexture(size) {
  const S = 2048;
  const [c, g] = cv(S, S);
  g.fillStyle = '#8f7556'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 16000; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? `rgba(120,95,65,${rnd(0.15, 0.4)})` : v < 0.85 ? `rgba(170,145,110,${rnd(0.1, 0.3)})` : `rgba(90,90,88,${rnd(0.2, 0.5)})`;
    g.fillRect(rnd(0, S), rnd(0, S), rnd(2, 7), rnd(2, 7));
  }
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '70,55,40' : '160,140,110'},${rnd(0.06, 0.16)})`;
    g.beginPath(); g.ellipse(rnd(0, S), rnd(0, S), rnd(30, 160), rnd(20, 90), rnd(0, 3), 0, 7); g.fill();
  }
  // tyre tracks
  g.strokeStyle = 'rgba(60,45,32,0.35)'; g.lineWidth = 10;
  for (let t = 0; t < 5; t++) {
    const y0 = rnd(0, S), off = 34;
    for (const o of [0, off]) { g.beginPath(); g.moveTo(0, y0 + o); g.bezierCurveTo(S * 0.3, y0 + rnd(-300, 300) + o, S * 0.7, y0 + rnd(-300, 300) + o, S, y0 + rnd(-200, 200) + o); g.stroke(); }
  }
  // grass at the borders
  const edge = S * 0.1;
  for (let i = 0; i < 7000; i++) {
    const side = Math.random() < 0.5;
    const x = side ? (Math.random() < 0.5 ? rnd(0, edge) : rnd(S - edge, S)) : rnd(0, S);
    const y = side ? rnd(0, S) : (Math.random() < 0.5 ? rnd(0, edge) : rnd(S - edge, S));
    g.fillStyle = `rgba(${90 + rnd(-20, 20)},${130 + rnd(-20, 20)},70,${rnd(0.3, 0.7)})`;
    g.fillRect(x, y, rnd(3, 8), rnd(3, 8));
  }
  const t = tex(c); t.anisotropy = 8;
  return t;
}
