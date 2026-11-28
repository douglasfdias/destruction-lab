// Destruction Lab — Phase 1 (Laboratório mode): urban lot, 2-storey house, garage, cars, barrels, 8 weapons.
import * as THREE from '../lib/three.module.min.js';
import { World, VOX, MAT, MATS, cellCenter, worldToCell } from './world.js';
import { Physics } from './physics.js';
import { Terrain } from './terrain.js';
import { FX } from './fx.js';
import { Audio, Haptics } from './audio.js';
import { makeMaterialTextures, makeCrackTexture, makeGroundTexture, makeParticleAtlas, makeDecalTextures, makeDuelGroundTexture } from './textures.js';
import { makeWeapons, setSleeveColor } from './weapons.js';
import { Duel, DUEL_LAYOUT, DUEL3_LAYOUT } from './duel.js';

const R = (a, b) => a + Math.random() * (b - a);
const $ = id => document.getElementById(id);
const fmt = n => 'R$ ' + Math.round(n).toLocaleString('pt-BR');

const LAYOUT = {
  mode: 'lab',
  size: 64,
  house: { x0: -5.5, x1: 5.5, z0: -9, z1: -1 },
  garage: { x0: -12, x1: -7.5, z0: -7.5, z1: -1.5 },
  street: { z0: 5, z1: 11 },
  fenceZ: 2.5,
  spawn: new THREE.Vector3(1, 0, 15),
};

const QUALITY = {
  baixa: { name: 'Baixa', pr: 0.85, shadows: false, shadowSize: 1024, maxBodies: 110, maxFrozen: 2500, maxParticles: 700, maxChips: 250, debris: 30, fx: 0.5 },
  media: { name: 'Média', pr: 1.25, shadows: true, shadowSize: 1024, maxBodies: 200, maxFrozen: 4500, maxParticles: 1200, maxChips: 450, debris: 55, fx: 0.75 },
  alta: { name: 'Alta', pr: 2, shadows: true, shadowSize: 2048, maxBodies: 320, maxFrozen: 5000, maxParticles: 2200, maxChips: 800, debris: 90, fx: 1 },
};

// weapon icons (24x24 strokes)
const WICON = {
  pedra: '<path d="M5 15l3-7 7-2 5 6-3 7H8z"/>',
  estilingue: '<path d="M12 22v-9M12 13L6 4M12 13l6-9M6 4h12"/>',
  pistola: '<path d="M3 8h17v4H11l-1 7H6l1-7H3z"/>',
  smg: '<path d="M2 9h18v3H9v7H6v-7H2zM12 12v5M20 9v-2"/>',
  shotgun: '<path d="M1 10h22M1 13h15l-3 5H9"/>',
  rifle50: '<path d="M1 12h22M5 12v4M9 9h5M18 12v-3"/>',
  granada: '<circle cx="11" cy="14" r="6"/><path d="M11 8V5h4"/>',
  canhao: '<path d="M4 14l14-7 2 4-13 6z"/><circle cx="8" cy="18" r="3"/>',
  rpg: '<path d="M3 15l14-8 3 3-14 8zM17 7l4-2M6 18l-2 3"/>',
};
const weaponIcon = (id, s = 24) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${WICON[id] || ''}</svg>`;

class Game {
  constructor() {
    this.qKey = this.loadPref('quality', 'media');
    this.q = { ...QUALITY[this.qKey] };
    this.audio = new Audio();
    this.timeScale = 1; this.targetScale = 1; this.slowmoT = 0; this.manualSlow = false;
    this.trauma = 0; this.fovKick = 0; this.recoilP = 0; this.aimWobble = 0;
    this.sway = new THREE.Vector2();
    this.money = 0; this.combo = 0; this.comboT = 0;
    this.timers = [];
    this.projectiles = [];
    this.sndBudget = 0;
    this.frameRemovals = new Map();
    this.frameBodies = 0;
    this.floaters = [];
    this.pendingValue = null;
    this.zoomed = false;
    this.started = false;
    this.mode = 'lab'; this.layout = LAYOUT; this.duel = null;
    this.wind = new THREE.Vector3();
    this.fpsSamples = []; this.autoQualityDone = !!this.loadPref('quality', null);
    this.initRenderer();
    this.initScene();
    this.initPlayer();
    this.initInput();
    this.weapons = this.labWeapons = makeWeapons(this);
    for (const w of this.weapons) { w.model.visible = false; this.vmScene.add(w.model); }
    this.wi = 0;
    this.aimFrame = this.camera;
    this.labPlayer = this.player;
    this.buildHUD();
    this.resetLevel();
    this.clock = new THREE.Clock();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  loadPref(k, d) { try { const v = localStorage.getItem('dl_' + k); return v == null ? d : v; } catch (e) { return d; } }
  savePref(k, v) { try { localStorage.setItem('dl_' + k, v); } catch (e) {} }

  // ---------------- renderer & scene ----------------
  initRenderer() {
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pr));
    r.setSize(window.innerWidth, window.innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.autoClear = false;
    $('game').appendChild(r.domElement);
    window.addEventListener('resize', () => this.onResize());
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vmCam.aspect = w / h; this.vmCam.updateProjectionMatrix();
    this.fx && this.fx.setScale(h * this.renderer.getPixelRatio() * 0.9);
    $('rotate').style.display = h > w * 1.05 ? 'flex' : 'none';
  }

  initScene() {
    const scene = this.scene = new THREE.Scene();
    const horizon = new THREE.Color(0xcfdcea);
    scene.fog = new THREE.Fog(horizon, 70, 260);
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 600);
    this.baseFov = 70;
    // sky dome
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sunDir: { value: new THREE.Vector3(-0.5, 0.42, -0.75).normalize() } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform vec3 sunDir; varying vec3 vP;
        void main(){
          float h = max(vP.y, 0.0);
          vec3 top = vec3(0.24,0.45,0.82), mid = vec3(0.55,0.72,0.92), hor = vec3(0.92,0.86,0.78);
          vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, h)); c = mix(c, top, smoothstep(0.18, 0.75, h));
          if (vP.y < 0.0) c = hor * 0.9;
          float s = max(dot(vP, sunDir), 0.0);
          c += vec3(1.0,0.85,0.6) * (pow(s, 300.0) * 3.0 + pow(s, 12.0) * 0.25);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMat);
    scene.add(this.sky);
    // clouds (soft sprites far away)
    // environment for reflections
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene(); envScene.add(this.sky.clone());
    scene.environment = pm.fromScene(envScene, 0.04).texture;
    // lights
    const hemi = new THREE.HemisphereLight(0xd6e6ff, 0x6a7a55, 0.9);
    scene.add(hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
    sun.position.set(-18, 26, -22).normalize().multiplyScalar(40).add(new THREE.Vector3(0, 0, 0));
    sun.target.position.set(-2, 0, 0);
    sun.castShadow = this.q.shadows;
    sun.shadow.mapSize.set(this.q.shadowSize, this.q.shadowSize);
    const sc = sun.shadow.camera; sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 100;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    // textures
    this.texs = makeMaterialTextures();
    this.crackTex = makeCrackTexture();
    this.atlas = makeParticleAtlas();
    this.decals = makeDecalTextures();
    this.labGround = makeGroundTexture(LAYOUT);
    this.terrain = new Terrain(scene, this.labGround, LAYOUT);
    this.world = new World(scene, this.texs, this.crackTex);
    this.physics = new Physics(scene, this.world, this.terrain, this.texs, this.q);
    this.fx = new FX(scene, this.atlas, this.decals, this.q, this.physics);
    this.fx.setScale(window.innerHeight * this.renderer.getPixelRatio() * 0.9);
    this.buildBackground();
    // viewmodel scene
    this.vmScene = new THREE.Scene();
    this.vmCam = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 20);
    this.vmScene.add(new THREE.HemisphereLight(0xe8f0ff, 0x5a5040, 1.4));
    const vd = new THREE.DirectionalLight(0xfff0dc, 1.8); vd.position.set(-1, 2, 1); this.vmScene.add(vd);
    this.vmLight = new THREE.PointLight(0xffb060, 0, 3, 2); this.vmLight.position.set(0.15, 0, -0.8);
    this.vmScene.add(this.vmLight);
    this.vmScene.environment = scene.environment;
    // world event hooks
    this.world.listeners.removed = (c, m, info) => this.onCellRemoved(c, m, info);
    this.world.listeners.chunk = cells => this.onChunk(cells);
    this.world.listeners.crumble = (j, ratio) => this.onCrumble(j, ratio);
    this.projMeshes = this.makeProjectileMeshes();
  }

  buildBackground() {
    const s = this.scene;
    const bg = new THREE.Group();
    const winTex = this.decals.windows;
    const palette = [0xd9cbb5, 0xbfc8d4, 0xe3b9a0, 0xa9b9a3, 0xd4d0c8, 0xc7a98f, 0x9fb0c4];
    const place = (x, z, w, d, h, rot = 0) => {
      const t = winTex.clone(); t.needsUpdate = true;
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(Math.max(1, Math.round(w / 3)), Math.max(1, Math.round(h / 3)));
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ map: t, color: palette[(Math.random() * palette.length) | 0], roughness: 0.85 }));
      m.position.set(x, h / 2, z); m.rotation.y = rot;
      m.castShadow = false; m.receiveShadow = true;
      bg.add(m);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.4, d + 0.4), new THREE.MeshStandardMaterial({ color: 0x6b6b6b }));
      roof.position.set(x, h + 0.2, z); roof.rotation.y = rot; bg.add(roof);
    };
    // across the street (behind the player)
    for (let x = -66; x <= 66; x += R(9, 13)) place(x, R(37, 43), R(7, 11), R(8, 12), R(8, 22));
    // behind the lot
    for (let x = -66; x <= 66; x += R(10, 15)) place(x, R(-46, -54), R(8, 13), R(8, 12), R(10, 30));
    // sides
    for (let z = -36; z <= 6; z += R(10, 14)) { place(R(-44, -50), z, R(8, 12), R(8, 12), R(7, 16)); place(R(36, 42), z, R(8, 12), R(8, 12), R(7, 16)); }
    s.add(bg);
    // trees
    const trunkG = new THREE.CylinderGeometry(0.15, 0.22, 2.4, 6); trunkG.translate(0, 1.2, 0);
    const crownG = new THREE.IcosahedronGeometry(1.6, 0); crownG.translate(0, 3.4, 0);
    const trunkM = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
    const crownM = new THREE.MeshStandardMaterial({ color: 0x4f8a3c, roughness: 1, flatShading: true });
    const treePos = [];
    for (let x = -28; x <= 28; x += 7) if (Math.abs(x) > 12) treePos.push([x + R(-1, 1), LAYOUT.street.z1 + 2.6]);
    for (const p of [[-18, -14], [16, -16], [-20, -2], [18, -2], [14, -12], [-24, -20]]) treePos.push(p);
    const tI = new THREE.InstancedMesh(trunkG, trunkM, treePos.length), cI = new THREE.InstancedMesh(crownG, crownM, treePos.length);
    const m4 = new THREE.Matrix4();
    treePos.forEach(([x, z], i) => {
      const sc = R(0.85, 1.25);
      m4.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, R(0, 6), 0)), new THREE.Vector3(sc, sc, sc));
      tI.setMatrixAt(i, m4); cI.setMatrixAt(i, m4);
    });
    this.trees = { tI, cI, pos: treePos, mats: treePos.map((_, i) => { const m = new THREE.Matrix4(); tI.getMatrixAt(i, m); return m; }) };
    tI.castShadow = cI.castShadow = true; tI.receiveShadow = cI.receiveShadow = true;
    s.add(tI, cI);
    // street lamps & cones belong to the lab street only
    const decor = this.labDecor = new THREE.Group(); s.add(decor);
    const poleM = new THREE.MeshStandardMaterial({ color: 0x3a3f46, metalness: 0.5, roughness: 0.5 });
    for (let x = -26; x <= 26; x += 13) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 6, 8), poleM); p.position.set(x, 3, LAYOUT.street.z0 - 0.8);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.4), poleM); arm.position.set(x, 5.9, LAYOUT.street.z0 - 0.2);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.5), new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0x332a10 })); lamp.position.set(x, 5.82, LAYOUT.street.z0 + 0.4);
      p.castShadow = true; decor.add(p, arm, lamp);
    }
    // hazard tape posts around the lot (ties into the "interditado" fiction)
    const coneM = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6 });
    for (let x = -16; x <= 14; x += 3.4) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 10), coneM);
      c.position.set(x, 0.27, LAYOUT.street.z0 - 0.4); c.castShadow = true; decor.add(c);
    }
  }

  makeProjectileMeshes() {
    const mk = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; return m; };
    return {
      rock: () => mk(new THREE.DodecahedronGeometry(0.1, 0), new THREE.MeshStandardMaterial({ color: 0x8b8a86, roughness: 0.95, flatShading: true })),
      ball: () => mk(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.9, roughness: 0.25 })),
      grenade: () => { const g = new THREE.Group(); const b = mk(new THREE.SphereGeometry(0.07, 12, 10), new THREE.MeshStandardMaterial({ color: 0x4c5e3a, roughness: 0.7 })); b.scale.set(1, 1.2, 1); g.add(b); return g; },
      cannonball: () => mk(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshStandardMaterial({ color: 0x1d1e21, metalness: 0.7, roughness: 0.4 })),
      rocket: () => {
        const g = new THREE.Group();
        const body = mk(new THREE.CylinderGeometry(0.055, 0.055, 0.5, 10), new THREE.MeshStandardMaterial({ color: 0x7a8a55 }));
        body.rotation.x = Math.PI / 2; g.add(body);
        const nose = mk(new THREE.ConeGeometry(0.055, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0x9a2b20 }));
        nose.rotation.x = -Math.PI / 2; nose.position.z = -0.35; g.add(nose);
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
        glow.position.z = 0.3; g.add(glow);
        return g;
      },
    };
  }

  // ---------------- level / props ----------------
  resetLevel() {
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles.length = 0;
    this.physics.clear();
    this.fx.clear();
    this.terrain.reset();
    const duel = this.layout.mode === 'duel';
    if (duel) {
      this.terrain.addHills(this.layout.hills);
      this.terrain.setTexture(this.duelGround || (this.duelGround = makeDuelGroundTexture(64)));
    } else this.terrain.setTexture(this.labGround);
    this.labDecor.visible = !duel;
    // trees standing where a fort goes are hidden for that layout
    { const T = this.trees, zero = new THREE.Matrix4().makeScale(0, 0, 0);
      T.pos.forEach(([x, z], i) => {
        const hide = duel && this.layout.forts.some(f => x > f.x0 - 2.5 && x < f.x1 + 2.5 && z > f.z0 - 2.5 && z < f.z1 + 2.5);
        T.tI.setMatrixAt(i, hide ? zero : T.mats[i]); T.cI.setMatrixAt(i, hide ? zero : T.mats[i]);
      });
      T.tI.instanceMatrix.needsUpdate = true; T.cI.instanceMatrix.needsUpdate = true; }
    this.world.buildLevel(this.layout);
    this.world.buildMeshes(this.q);
    this.world.dirty = false;
    this.money = 0; this.combo = 0; this.collapsedToast = false; this.flatToast = false;
    this.wind.set(0, 0, 0);
    this.timers.length = 0;
    if (duel) {
      for (const c of this.layout.cars) this.addCar(...c);
      for (const b of this.layout.barrels) this.addBarrel(...b);
    } else {
      this.addCar(-2.5, 7.0, 0, 0xd8392b);
      this.addCar(8.5, 9.0, Math.PI, 0x2f6fd1);
      this.addBarrel(6.8, -3.2); this.addBarrel(7.5, -3.6); this.addBarrel(7.1, -2.4);
      this.addBarrel(-6.5, 3.6);
      const lp = this.labPlayer;
      lp.pos.copy(LAYOUT.spawn); lp.yaw = 0.05; lp.pitch = 0.06; lp.vel.set(0, 0, 0);
    }
    this.updateHUD(true);
  }

  addCar(x, z, rot, color) {
    const g = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1e2126, roughness: 0.8 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fc4dc, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.55 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 0.9, roughness: 0.2 });
    const add = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
    add(new THREE.BoxGeometry(4.2, 0.62, 1.8), paint, 0, -0.12, 0);
    add(new THREE.BoxGeometry(2.3, 0.62, 1.62), paint, -0.25, 0.5, 0);
    const wins = [
      add(new THREE.BoxGeometry(0.06, 0.5, 1.5), glass, 0.92, 0.5, 0),
      add(new THREE.BoxGeometry(0.06, 0.48, 1.5), glass, -1.42, 0.5, 0),
      add(new THREE.BoxGeometry(2.1, 0.46, 0.04), glass, -0.25, 0.52, 0.82),
      add(new THREE.BoxGeometry(2.1, 0.46, 0.04), glass, -0.25, 0.52, -0.82),
    ];
    wins[0].rotation.z = 0.35; wins[1].rotation.z = -0.3;
    add(new THREE.BoxGeometry(0.2, 0.22, 1.84), chrome, 2.12, -0.22, 0);
    add(new THREE.BoxGeometry(0.2, 0.22, 1.84), chrome, -2.12, -0.22, 0);
    add(new THREE.BoxGeometry(0.06, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: 0xfff6d0, emissive: 0x554422 }), 2.2, -0.05, 0.6);
    add(new THREE.BoxGeometry(0.06, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: 0xfff6d0, emissive: 0x554422 }), 2.2, -0.05, -0.6);
    add(new THREE.BoxGeometry(0.06, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: 0xff3b2b, emissive: 0x440000 }), -2.2, -0.05, 0.6);
    add(new THREE.BoxGeometry(0.06, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: 0xff3b2b, emissive: 0x440000 }), -2.2, -0.05, -0.6);
    const wheels = [];
    for (const [wx, wz] of [[1.35, 0.8], [1.35, -0.8], [-1.35, 0.8], [-1.35, -0.8]]) {
      const w = add(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 14), dark, wx, -0.4, wz);
      w.rotation.x = Math.PI / 2; wheels.push(w);
      const hub = add(new THREE.CylinderGeometry(0.16, 0.16, 0.27, 10), chrome, wx, -0.4, wz); hub.rotation.x = Math.PI / 2; wheels.push(hub);
    }
    g.position.set(x, 0.76, z); g.rotation.y = rot;
    this.scene.add(g);
    const body = this.physics.addProp(g, new THREE.Vector3(2.15, 0.76, 0.92), 1.4, {
      hp: 260, restitution: 0.15, friction: 0.8,
      extra: { prop: 'car', paint, glass, wins, wheels, value: 48000, broken: 0, onFire: null },
    });
    return body;
  }

  addBarrel(x, z) {
    const g = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: 0xc62f22, roughness: 0.5, metalness: 0.3 });
    const yel = new THREE.MeshStandardMaterial({ color: 0xffc531, roughness: 0.5 });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16), red); m.castShadow = true; m.receiveShadow = true; g.add(m);
    for (const y of [-0.25, 0.25]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.305, 0.305, 0.08, 16), yel); r.position.y = y; g.add(r); }
    g.position.set(x, 0.45, z);
    this.scene.add(g);
    return this.physics.addProp(g, new THREE.Vector3(0.3, 0.45, 0.3), 0.18, { hp: 22, restitution: 0.3, friction: 0.5, extra: { prop: 'barrel', value: 400 } });
  }

  damageProp(b, dmg, info = {}) {
    if (b.dead || !(b.hp < Infinity)) return;
    b.hp -= dmg;
    if (b.prop === 'car') {
      if (b.hp < 190 && !b.broken) {
        b.broken = 1;
        for (const w of b.wins) { w.material = w.material.clone(); w.material.opacity = 0.15; w.material.color.setHex(0x333a40); }
        this.audio.play('glassbreak', { pos: b.pos, vol: 1 });
        for (let i = 0; i < 30; i++) this.fx.shard(b.pos.clone().add(new THREE.Vector3(R(-1, 1), R(0.3, 0.8), R(-0.8, 0.8))), new THREE.Vector3(R(-3, 3), R(1, 4), R(-3, 3)));
        this.addMoney(3500, b.pos);
      }
      if (b.hp < 110 && !b.onFire) {
        b.onFire = this.fx.startFire(b.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 30, 0.7, this.audio);
        b.fireFollow = true;
      }
      if (b.hp <= 0) this.later(R(0.05, 0.25), () => this.explodeCar(b, info.chain));
    } else if (b.prop === 'barrel') {
      if (b.hp <= 0) this.later(R(0.04, 0.2), () => this.explodeBarrel(b, info.chain));
    }
  }

  explodeCar(b, chain) {
    if (b.exploded) return;
    b.exploded = true; b.hp = Infinity;
    const p = b.pos.clone();
    this.explode(p.clone().add(new THREE.Vector3(0, 0.3, 0)), 1.5, 4.8, { chain: true, source: 'car', exclude: b });
    b.paint.color.setHex(0x2a2522); b.paint.roughness = 1; b.paint.metalness = 0.1;
    this.physics.applyImpulse(b, new THREE.Vector3(R(-0.8, 0.8), 7.5, R(-0.8, 0.8)), b.pos.clone().add(new THREE.Vector3(R(0.8, 1.6) * (Math.random() < 0.5 ? -1 : 1), -0.6, R(-0.5, 0.5))));
    // wheels fly off as separate props
    const wm = b.wheels;
    for (let i = 0; i < wm.length; i += 2) {
      const w = wm[i], hub = wm[i + 1];
      const wp = w.getWorldPosition(new THREE.Vector3());
      b.mesh.remove(w); b.mesh.remove(hub);
      const grp = new THREE.Group(); grp.add(w); grp.add(hub);
      w.position.set(0, 0, 0); hub.position.set(0, 0, 0);
      grp.position.copy(wp); grp.quaternion.copy(b.quat);
      this.scene.add(grp);
      const wb = this.physics.addProp(grp, new THREE.Vector3(0.36, 0.36, 0.13), 0.05, { restitution: 0.45, friction: 0.5 });
      wb.quat.copy(grp.quaternion);
      this.physics.applyImpulse(wb, new THREE.Vector3(R(-0.4, 0.4), R(0.4, 0.7), R(-0.4, 0.4)), wp);
    }
    b.wheels = [];
    if (b.onFire) b.onFire.t = 0; else b.onFire = this.fx.startFire(p, 30, 1.0, this.audio);
    b.onFire.size = 1.1; b.fireFollow = true;
    this.addMoney(b.value, p);
    this.toast('CARRO PELOS ARES!');
  }

  explodeBarrel(b, chain) {
    if (b.dead) return;
    const p = b.pos.clone();
    this.physics.removeBody(b);
    this.explode(p, 1.05, 3.8, { chain: true, source: 'barrel' });
    this.fx.startFire(new THREE.Vector3(p.x, this.physics.floorAt(p.x, p.z) + 0.1, p.z), 8, 0.9, this.audio);
    this.addMoney(b.value, p);
  }

  later(t, fn) { this.timers.push({ t, fn }); }

  // ---------------- player ----------------
  initPlayer() {
    this.player = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: false, bob: 0, bobAmp: 0, stepT: 0 };
    this.input = { mx: 0, mz: 0, jump: false, lookDX: 0, lookDY: 0, keys: {} };
  }

  solidAtPlayer(x, y, z) {
    const r = 0.28;
    for (const [dx, dz] of [[-r, -r], [r, -r], [-r, r], [r, r], [0, 0]]) {
      for (const dy of [0.35, 0.95, 1.55]) {
        const c = worldToCell(x + dx, y + dy, z + dz);
        if (c >= 0 && this.world.mat[c]) return true;
      }
    }
    return false;
  }
  groundUnder(x, y, z) {
    // highest support below feet+0.55 (step-up height)
    let g = this.physics.floorAt(x, z);
    for (const [dx, dz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) {
      for (let j = Math.floor((y + 0.55) / VOX); j >= 0; j--) {
        const c = worldToCell(x + dx, j * VOX + 0.01, z + dz);
        if (c >= 0 && this.world.mat[c]) { g = Math.max(g, (j + 1) * VOX); break; }
      }
    }
    return g;
  }

  updatePlayer(dt, body = this.player, inp = this.input, withCamera = true) {
    const p = body;
    const isMain = p === this.player;
    // look
    const sens = (this.zoomed ? 0.35 : 1);
    p.yaw -= inp.lookDX * sens; p.pitch -= inp.lookDY * sens;
    this.sway.x += (-inp.lookDX * 0.6 - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (inp.lookDY * 0.6 - this.sway.y) * Math.min(1, dt * 10);
    this.sway.multiplyScalar(Math.exp(-dt * 6));
    inp.lookDX = 0; inp.lookDY = 0;
    // recoil recovery
    if (isMain) { const rec = this.recoilP * Math.min(1, dt * 7); p.pitch -= rec * 0.55; this.recoilP -= rec; }
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
    // move
    let mx = inp.mx, mz = inp.mz;
    const k = inp.keys;
    if (k.KeyW) mz -= 1; if (k.KeyS) mz += 1; if (k.KeyA) mx -= 1; if (k.KeyD) mx += 1;
    // keyboard aiming (arrow keys), accelerates while held; slower when zoomed
    const ax = (k.ArrowRight ? 1 : 0) - (k.ArrowLeft ? 1 : 0), ay = (k.ArrowDown ? 1 : 0) - (k.ArrowUp ? 1 : 0);
    if (ax || ay) this.keyAim = Math.min(1, (this.keyAim || 0) + dt * 2.5); else if (isMain) this.keyAim = 0;
    const ks = (0.45 + 1.15 * (this.keyAim || 0)) * dt * (this.camera.fov / 70) * (k.AltLeft || k.ControlLeft ? 0.3 : 1);
    p.yaw -= ax * ks; p.pitch -= ay * ks * 0.8;
    const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
    const speed = (k.ShiftLeft ? 7.5 : 5) * (this.zoomed ? 0.4 : 1);
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    const wx = (mx * cy + mz * sy) * speed, wz = (-mx * sy + mz * cy) * speed;
    if (p.knockT > 0) { if (p.onGround) { p.vel.x *= 1 - Math.min(1, dt * 4); p.vel.z *= 1 - Math.min(1, dt * 4); } }
    else {
      p.vel.x += (wx - p.vel.x) * Math.min(1, dt * 12);
      p.vel.z += (wz - p.vel.z) * Math.min(1, dt * 12);
    }
    if ((inp.jump || k.Space) && p.onGround) { p.vel.y = 5.6; p.onGround = false; }
    inp.jump = false;
    p.vel.y -= 16 * dt;
    // horizontal with voxel collision (axis separated, with step-up)
    const B = p.bounds;
    const inB = (x, z) => !B || (x >= B.x0 && x <= B.x1 && z >= B.z0 && z <= B.z1);
    const tryAxis = (dx, dz) => {
      const nx = p.pos.x + dx, nz = p.pos.z + dz;
      // a boss walks only inside its own fort (but can be knocked out of it)
      if (B && !(p.knockT > 0) && inB(p.pos.x, p.pos.z) && !inB(nx, nz)) return;
      if (!this.solidAtPlayer(nx, p.pos.y, nz)) { p.pos.x = nx; p.pos.z = nz; return; }
      if (p.onGround && !this.solidAtPlayer(nx, p.pos.y + 0.55, nz)) { p.pos.x = nx; p.pos.z = nz; p.pos.y += 0.5; }
    };
    tryAxis(p.vel.x * dt, 0); tryAxis(0, p.vel.z * dt);
    // world bounds
    p.pos.x = Math.max(-40, Math.min(40, p.pos.x)); p.pos.z = Math.max(-40, Math.min(28, p.pos.z));
    // vertical
    p.pos.y += p.vel.y * dt;
    const g = this.groundUnder(p.pos.x, p.pos.y, p.pos.z);
    if (p.pos.y <= g) { p.pos.y = g; if (p.vel.y < -6) this.audio.play('step', { vol: 0.4, rate: 0.8 }); if (p.onLand && !p.onGround) p.onLand(-p.vel.y); p.vel.y = 0; p.onGround = true; }
    else p.onGround = p.pos.y - g < 0.05;
    // head bump
    if (p.vel.y > 0) { const c = worldToCell(p.pos.x, p.pos.y + 1.75, p.pos.z); if (c >= 0 && this.world.mat[c]) p.vel.y = 0; }
    // bob & steps
    const hs = Math.hypot(p.vel.x, p.vel.z);
    p.bobAmp += ((p.onGround ? Math.min(1, hs / 5) : 0) - p.bobAmp) * Math.min(1, dt * 8);
    p.bob += dt * hs * 1.9;
    p.stepT += dt * hs;
    if (p.onGround && p.stepT > 2.1) { p.stepT = 0; this.audio.play('step', { vol: 0.18, rateJitter: 0.15, pos: withCamera ? null : p.pos }); }
    if (!withCamera) return;
    // camera
    const cam = this.camera;
    cam.position.set(p.pos.x, p.pos.y + 1.62 + Math.abs(Math.sin(p.bob)) * 0.04 * p.bobAmp, p.pos.z);
    // shake (trauma^2)
    const sh = this.trauma * this.trauma;
    const t = performance.now() / 1000;
    const wob = this.aimWobble;
    cam.rotation.set(0, 0, 0, 'YXZ');
    cam.rotation.y = p.yaw + (Math.sin(t * 37) * 0.025 * sh) + Math.sin(t * 9.1) * wob;
    cam.rotation.x = p.pitch + (Math.sin(t * 41 + 1) * 0.03 * sh) + Math.sin(t * 11.3) * wob;
    cam.rotation.z = Math.sin(t * 29 + 2) * 0.02 * sh;
    cam.position.x += Math.sin(t * 47) * 0.06 * sh; cam.position.y += Math.sin(t * 53 + 3) * 0.06 * sh;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    this.aimWobble = 0;
    // fov
    const targetFov = this.zoomed ? (this.weapons[this.wi].id === 'rifle50' ? 16 : 40) : this.baseFov;
    this.fovKick *= Math.exp(-dt * 6);
    cam.fov += (targetFov + this.fovKick - cam.fov) * Math.min(1, dt * 14);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    this.audio.setListener(cam.position, cam.getWorldDirection(new THREE.Vector3()));
  }

  // ---------------- feedback helpers ----------------
  shake(a) { if (this.ctxAI) return; this.trauma = Math.min(1, this.trauma + a); }
  recoil(pitch, yaw) { this.player.pitch += pitch; this.player.yaw += yaw; if (!this.ctxAI) this.recoilP += pitch; }
  fovPunch(d) { if (this.ctxAI) return; this.fovKick += d; }
  haptic(s) { if (this.ctxAI) return; Haptics.impact(s); }
  vmFlash(i) { if (this.ctxAI) return; this.vmLight.intensity = i * 1.5; }
  slowmo(scale, dur) { if (this.manualSlow) return; this.targetScale = scale; this.slowmoT = dur; }

  onFired(w, info) { if (this.duel) this.duel.onFired(w, info); }

  floaterText(text, pos, color) {
    const el = document.createElement('div');
    el.className = 'floater'; el.textContent = text;
    if (color) el.style.color = color;
    $('floaters').appendChild(el);
    this.floaters.push({ el, pos: pos.clone(), t: 0 });
  }

  addMoney(v, pos) {
    if (!v) return;
    this.money += v;
    if (pos && this.mode === 'lab') {
      if (!this.pendingValue || this.pendingValue.t > 0.35) this.pendingValue = { v: 0, pos: pos.clone(), t: 0, n: 0 };
      this.pendingValue.v += v; this.pendingValue.n++;
      this.pendingValue.pos.lerp(pos, 1 / this.pendingValue.n);
    }
  }

  // ---------------- cell removal / chunks ----------------
  onCellRemoved(c, m, info = {}) {
    const def = MATS[m];
    const pos = cellCenter(c, new THREE.Vector3());
    this.fx.removeCellDecals(c);
    this.physics.queueWake(pos);
    this.addMoney(def.value, pos);
    // sound batching per material
    const fr = this.frameRemovals.get(m) || { n: 0, pos: new THREE.Vector3() };
    fr.n++; fr.pos.add(pos); this.frameRemovals.set(m, fr);
    if (m === MAT.GLASS) {
      const n = info.cause === 'explosion' ? 5 : 9;
      for (let i = 0; i < n; i++) {
        const v = (info.vel ? info.vel.clone().multiplyScalar(R(0.2, 0.7)) : new THREE.Vector3()).add(new THREE.Vector3(R(-1.5, 1.5), R(-0.5, 2), R(-1.5, 1.5)));
        this.fx.shard(pos.clone().add(new THREE.Vector3(R(-0.2, 0.2), R(-0.2, 0.2), R(-0.2, 0.2))), v);
      }
      return;
    }
    const vel = info.vel ? info.vel.clone() : new THREE.Vector3();
    if (info.cause === 'crumble') vel.set(R(-0.4, 0.4), R(-0.5, 0), R(-0.4, 0.4));
    const canBody = this.frameBodies < this.q.debris;
    if (canBody) {
      this.frameBodies++;
      const scale = info.cause === 'bullet' ? R(0.35, 0.5) : info.cause === 'crumble' ? R(0.6, 0.95) : R(0.45, 0.95);
      const n = info.cause === 'bullet' ? 1 : (Math.random() < 0.35 ? 2 : 1);
      for (let i = 0; i < n; i++) {
        const off = n > 1 ? new THREE.Vector3(R(-0.12, 0.12), R(-0.12, 0.12), R(-0.12, 0.12)) : new THREE.Vector3();
        this.physics.spawnDebris(m, pos.clone().add(off), vel.clone().add(new THREE.Vector3(R(-1, 1), R(0, 1.5), R(-1, 1))), n > 1 ? scale * 0.7 : scale, this.world.tint[c] || def.color, {});
      }
    }
    const nc = canBody ? 3 : 7;
    for (let i = 0; i < nc; i++) this.fx.chip(pos, vel.clone().multiplyScalar(R(0.3, 1)).add(new THREE.Vector3(R(-2, 2), R(0, 3), R(-2, 2))), R(0.04, 0.1), def.chip);
    if (def.dust && Math.random() < (info.cause === 'explosion' ? 0.5 : 0.9)) this.fx.dust(pos, def.dust, { a: 0.45, s1: R(1.5, 2.8), vy: R(0, 0.6) });
  }

  onChunk(cells) {
    if (cells.length <= 2) { for (const c of cells) this.world.removeCell(c, { cause: 'crumble' }); return; }
    let val = 0; const ctr = new THREE.Vector3(); const tmp = new THREE.Vector3();
    for (const c of cells) { val += MATS[this.world.mat[c]].value; ctr.add(cellCenter(c, tmp)); }
    ctr.divideScalar(cells.length);
    for (const c of cells) this.fx.removeCellDecals(c);
    const taken = this.world.takeCells(cells);
    const b = this.physics.spawnChunk(taken);
    this.addMoney(val, ctr);
    if (cells.length > 25) {
      this.audio.play('creak', { pos: ctr, vol: Math.min(1, 0.3 + cells.length / 200), rate: R(0.6, 0.9) });
      if (cells.length > 120) {
        this.audio.play('rubble', { pos: ctr, vol: 1, rate: 0.6, delay: 0.25 });
        this.later(0.9, () => this.audio.play('rubble', { pos: ctr, vol: 1, rate: 0.5 }));
        if (!this.collapsedToast || cells.length > 400) { this.toast(cells.length > 400 ? 'DESABAMENTO TOTAL!' : 'DESABANDO!'); this.collapsedToast = true; }
        this.slowmo(0.45, 0.6);
      }
      for (let i = 0; i < Math.min(14, cells.length / 8); i++) {
        const c = cells[(Math.random() * cells.length) | 0];
        this.fx.dust(cellCenter(c, tmp).clone(), MATS[taken[0].m].dust || [0.7, 0.7, 0.7], { a: 0.4, s1: 3, vy: R(-0.5, 0.5) });
      }
    }
    return b;
  }

  onCrumble(j, ratio) {
    const now = performance.now();
    if (this._lastCrumble && now - this._lastCrumble < 900) return;
    this._lastCrumble = now;
    const h = this.layout.house;
    const p = new THREE.Vector3((h.x0 + h.x1) / 2, j * VOX, (h.z0 + h.z1) / 2);
    this.audio.play('creak', { pos: p, vol: 0.9, rate: R(0.5, 0.75) });
    this.audio.play('crumble', { pos: p, vol: 0.6, rate: 0.7 });
    this.toast('A ESTRUTURA ESTÁ CEDENDO…');
    this.shake(0.15); this.haptic(0.3);
  }

  flushFrameSounds() {
    let played = 0;
    for (const [m, fr] of this.frameRemovals) {
      if (played > 3) break;
      const def = MATS[m];
      const p = fr.pos.divideScalar(fr.n);
      const vol = Math.min(1, 0.3 + fr.n * 0.06);
      if (m === MAT.GLASS) { this.audio.play(fr.n > 3 ? 'glassbreak' : 'glasshit', { pos: p, vol: Math.min(1, 0.5 + fr.n * 0.08) }); if (fr.n > 4) this.later(R(0.2, 0.4), () => this.audio.play('glassfall', { pos: p, vol: 0.6 })); }
      else if (m === MAT.WOOD || m === MAT.TRIM) this.audio.play('woodbreak', { pos: p, vol });
      else if (m === MAT.METAL) this.audio.play('metalfall', { pos: p, vol });
      else this.audio.play(fr.n > 6 ? 'rubble' : 'crumble', { pos: p, vol, rate: fr.n > 20 ? 0.75 : 1 });
      played++;
    }
    this.frameRemovals.clear();
  }

  physicsEvents() {
    const ev = this.physics.events; this.physics.events = [];
    for (const e of ev) {
      if (e.type === 'impact') {
        const b = e.b;
        const big = b.kind === 'chunk' ? b.pieces.length : 1;
        if (b.kind === 'chunk' && e.speed > 3) {
          if (this.sndBudget < 6) { this.sndBudget++; this.audio.play(big > 30 ? 'rubble' : 'crumble', { pos: b.pos, vol: Math.min(1, 0.25 + big / 60 + e.speed / 20), rate: big > 60 ? 0.65 : 0.9 }); }
          if (big > 30) { this.audio.thump(Math.min(1.2, big / 150), { pos: b.pos }); const d = b.pos.distanceTo(this.camera.position); this.shake(Math.min(0.5, big / 300 * 18 / (d + 6))); this.haptic(Math.min(0.9, big / 200)); }
          if (this.duel && big > 3) this.duel.crush(b, e.speed);
          // crush whatever it lands on
          if (e.cell >= 0 && this.world.mat[e.cell]) {
            const dmg = b.mass * e.speed * 55;
            this.world.damageCell(e.cell, dmg, { cause: 'impact', vel: new THREE.Vector3(R(-1, 1), 1, R(-1, 1)) });
          }
          const nd = Math.min(8, 1 + big / 10);
          const dc = MATS[b.mainMat].dust || [0.6, 0.6, 0.6];
          for (let i = 0; i < nd; i++) this.fx.dust(b.pos.clone().add(new THREE.Vector3(R(-1, 1) * b.radius * 0.6, -b.radius * 0.3, R(-1, 1) * b.radius * 0.6)), dc, { a: 0.4, s1: 2.5 + big / 40 });
        } else if (b.kind === 'prop') {
          if (e.speed > 2.5 && this.sndBudget < 6) { this.sndBudget++; this.audio.play(b.prop === 'car' ? 'metalfall' : 'can', { pos: b.pos, vol: Math.min(1, e.speed / 10) }); }
          if (b.prop && e.speed > 9) this.damageProp(b, e.speed * 3);
        } else if (e.speed > 2.5 && this.sndBudget < 8) {
          this.sndBudget++;
          const m = b.mainMat;
          this.audio.play(MATS[m].hit === 'metalhit' ? 'metaldrop' : m === MAT.WOOD ? 'woodhit' : 'hit', { pos: b.pos, vol: Math.min(0.5, e.speed / 18), rate: R(1.0, 1.4) });
        }
      } else if (e.type === 'shatter') {
        if (this.sndBudget < 6) { this.sndBudget++; this.audio.play(e.mat === MAT.WOOD ? 'woodbreak' : 'crumble', { pos: e.pos, vol: Math.min(1, 0.3 + e.n / 40) }); }
        const d = MATS[e.mat].dust; if (d) for (let i = 0; i < Math.min(6, 1 + e.n / 6); i++) this.fx.dust(e.pos, d, { a: 0.45, s1: 2.6 });
        this.fx.chipsBurst(e.pos, Math.min(16, 4 + e.n), MATS[e.mat].chip, 4, 0.08);
      } else if (e.type === 'chips') {
        this.fx.chipsBurst(e.pos, e.n, MATS[e.mat].chip, 3, 0.07);
      }
    }
  }

  // ---------------- weapons support ----------------
  impactFX(point, normal, m, strength, cell, kind) {
    const def = MATS[m] || MATS[MAT.CONCRETE];
    const n = normal || new THREE.Vector3(0, 1, 0);
    if (m === MAT.METAL) {
      for (let i = 0; i < 6 + strength * 6; i++) this.fx.spark(point, n.clone().multiplyScalar(R(2, 6)).add(new THREE.Vector3(R(-3, 3), R(-1, 3), R(-3, 3))), { size: 0.08 });
      this.fx.flashSprite(point, 0.4, [1, 0.9, 0.7], 0.05);
    } else if (m !== MAT.GLASS) {
      this.fx.chipsBurst(point, 3 + Math.round(strength * 4), def.chip, 4 + strength * 3, 0.05, n);
      if (def.dust) this.fx.dust(point.clone().addScaledVector(n, 0.15), def.dust, { a: 0.5, s0: 0.2, s1: 1 + strength, vx: n.x * 1.5, vy: n.y * 1.5 + 0.2, vz: n.z * 1.5, life: R(1, 2) });
      if (m === MAT.CONCRETE || m === MAT.BRICK || m === MAT.FOUND) if (Math.random() < 0.5) this.fx.spark(point, n.clone().multiplyScalar(4).add(new THREE.Vector3(R(-2, 2), R(0, 2), R(-2, 2))), { size: 0.05, life: 0.15 });
    }
    if (this.sndBudget < 7) {
      this.sndBudget++;
      const s = def.hit;
      this.audio.play(s === 'hit' ? (Math.random() < 0.5 ? 'bullethit' : 'hit') : s, { pos: point, vol: 0.35 + strength * 0.3, rate: R(0.9, 1.3) });
    }
  }

  hitscan(o, dir, opts) {
    const maxT = 260;
    const from = opts.from || o;
    if (opts.penetrate) return this.penetratingShot(o, dir, opts);
    let dmg = opts.dmg;
    let origin = o.clone();
    let travelled = 0;
    for (let pass = 0; pass < 4; pass++) {
      const wh = this.world.raycast(origin, dir, maxT - travelled);
      const th = this.terrain.raycast(origin, dir, maxT - travelled);
      const bh = this.physics.raycastBodies(origin, dir, maxT - travelled);
      const boh = this.duel ? this.duel.rayBosses(origin, dir, maxT - travelled, this.player) : null;
      let best = null, bt = 1e9;
      if (wh && wh.t < bt) { bt = wh.t; best = 'w'; }
      if (th && th.t < bt) { bt = th.t; best = 't'; }
      if (bh && bh.t < bt) { bt = bh.t; best = 'b'; }
      if (boh && boh.t < bt) { bt = boh.t; best = 'boss'; }
      const end = origin.clone().addScaledVector(dir, best ? bt : 120);
      if (opts.tracer && pass === 0) this.fx.tracer(from, end, opts.tracerW || 0.02, 0.06);
      if (!best) return null;
      if (best === 'boss') {
        const p = origin.clone().addScaledVector(dir, bt);
        const dmg = (opts.kind === 'pellet' ? 3 : opts.kind === 'smg' ? 2.5 : 6) * (boh.head ? 1.6 : 1);
        this.duel.damage(boh.b, dmg, 'tiro', p);
        boh.b.vel.addScaledVector(dir, opts.kind === 'pellet' || opts.kind === 'smg' ? 0.5 : 1.2);
        this.fx.chipsBurst(p, 4, 0xffe14a, 3, 0.04, dir.clone().negate());
        return { point: p };
      }
      if (best === 'w') {
        const m = wh.mat;
        const destroyed = this.world.damageCell(wh.cell, dmg * (0.85 + Math.random() * 0.3), { cause: 'bullet', vel: dir.clone().multiplyScalar(opts.force * 1.5) });
        this.impactFX(wh.point, wh.normal, m, opts.kind === 'pellet' ? 0.3 : 0.6, wh.cell);
        if (!destroyed && m !== MAT.GLASS) this.fx.decal('hole', wh.point, wh.normal, opts.kind === 'pellet' ? 0.08 : 0.12, wh.cell);
        if (m === MAT.GLASS) { dmg *= 0.8; travelled += bt + 0.05; origin = wh.point.clone().addScaledVector(dir, 0.05); continue; }
        return wh;
      }
      if (best === 't') {
        this.fx.chipsBurst(th.point, 4, 0x6b5a40, 3, 0.05, th.normal);
        this.fx.dust(th.point, [0.55, 0.48, 0.38], { a: 0.5, s0: 0.3, s1: 1.4, vy: 1 });
        if (this.sndBudget < 6) { this.sndBudget++; this.audio.play('hit', { pos: th.point, vol: 0.25, rate: 1.4 }); }
        return th;
      }
      if (best === 'b') {
        const b = bh.b, p = origin.clone().addScaledVector(dir, bh.t);
        this.physics.applyImpulse(b, dir.clone().multiplyScalar(opts.force * (b.kind === 'prop' ? 0.08 : 0.06)), p);
        if (b.kind === 'prop') {
          this.impactFX(p, dir.clone().negate(), MAT.METAL, 0.5);
          if (b.prop === 'car' && this.sndBudget < 7) { this.sndBudget++; this.audio.play('metalhit', { pos: p, vol: 0.6 }); }
          this.damageProp(b, dmg * (b.prop === 'barrel' ? 1 : 0.35));
        } else this.impactFX(p, dir.clone().negate(), b.mainMat, 0.4);
        return { point: p };
      }
    }
    return null;
  }

  // .50: tunnels through several cells while energy lasts
  penetratingShot(o, dir, opts) {
    let energy = opts.penetrate;
    let last = null, first = null;
    const hitProps = new Set();
    // props along the line
    const bh = this.physics.raycastBodies(o, dir, 200);
    const hits = [];
    this.world.traverse(o, dir, 200, (c, t, axis, sign) => {
      if (energy <= 0) return true;
      const m = this.world.mat[c];
      const n = new THREE.Vector3(); if (axis === 0) n.x = sign; else if (axis === 1) n.y = sign; else n.z = sign;
      const p = o.clone().addScaledVector(dir, t);
      if (!first) first = { p, n, m, t, c };
      hits.push({ c, m, p, n, t });
      energy -= MATS[m].hp * 1.5;
      return false;
    });
    const th = this.terrain.raycast(o, dir, 200);
    let endT = hits.length ? hits[hits.length - 1].t : (th ? th.t : 160);
    if (energy > 0 && th) endT = th.t;
    if (bh && bh.t < endT) { const b = bh.b; this.physics.applyImpulse(b, dir.clone().multiplyScalar(b.kind === 'prop' ? 2.5 : 1.5), o.clone().addScaledVector(dir, bh.t)); if (b.kind === 'prop') this.damageProp(b, 180); }
    if (this.duel) {
      const boh = this.duel.rayBosses(o, dir, Math.min(endT, 160) + 0.5, this.player);
      if (boh) { const p = o.clone().addScaledVector(dir, boh.t); this.duel.damage(boh.b, boh.head ? 45 : 28, '.50', p); boh.b.vel.addScaledVector(dir, 6); boh.b.vel.y += 2; boh.b.knockT = 0.5; boh.b.onGround = false; }
    }
    this.fx.tracer(opts.from, o.clone().addScaledVector(dir, Math.min(endT, 160)), 0.05, 0.12, 0xfff2c0);
    let k = 0;
    for (const h of hits) {
      const frac = 1 - k / Math.max(1, hits.length);
      this.world.damageCell(h.c, opts.dmg * (0.6 + frac * 0.6), { cause: 'bullet', vel: dir.clone().multiplyScalar(7 + frac * 8) });
      // splash the cells around the tunnel a little
      for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const c2 = worldToCell(h.p.x + d[0] * VOX * 0.8, h.p.y + d[1] * VOX * 0.8, h.p.z + d[2] * VOX * 0.8);
        if (c2 >= 0 && this.world.mat[c2]) this.world.damageCell(c2, opts.dmg * 0.4 * frac, { cause: 'bullet', vel: dir.clone().multiplyScalar(5).add(new THREE.Vector3(d[0], d[1], d[2]).multiplyScalar(3)) });
      }
      if (k === 0 || k === hits.length - 1 || Math.random() < 0.3) this.impactFX(h.p, k === 0 ? h.n : dir.clone(), h.m, 1, h.c);
      k++;
    }
    if (first) {
      // exit blast: debris spray out of the far side
      const exit = hits[hits.length - 1].p;
      const dc = MATS[first.m].dust || [0.7, 0.7, 0.7];
      for (let i = 0; i < 6; i++) this.fx.dust(exit, dc, { vx: dir.x * 5, vy: dir.y * 5 + 0.3, vz: dir.z * 5, a: 0.5, s1: 2.2 });
      this.audio.play('crumble', { pos: first.p, vol: 0.8 });
    } else if (th) {
      this.fx.dust(th.point, [0.55, 0.48, 0.38], { a: 0.55, s1: 2.5, vy: 2 });
      this.fx.chipsBurst(th.point, 10, 0x6b5a40, 5, 0.07, th.normal);
    }
    return first;
  }

  spawnProjectile(type, pos, vel, opts = {}) {
    const mesh = this.projMeshes[type]();
    mesh.position.copy(pos);
    this.scene.add(mesh);
    const p = { type, pos: pos.clone(), vel: vel.clone(), mesh, age: 0, fuse: opts.fuse != null ? opts.fuse : 3, spin: new THREE.Vector3(R(-12, 12), R(-12, 12), R(-12, 12)), bounces: 0, energy: type === 'cannonball' ? 2600 : 0, exploded: false, rolling: false, trailAcc: 0 };
    if (type === 'rocket') { p.thrust = this.audio.hiss({ freq: 900, q: 0.6, vol: 0.3 }); p.trailAcc = 0; }
    this.projectiles.push(p);
    if (this.duel) this.duel.onProjectile(p);
    return p;
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      if (p.dead) {
        if (this.duel && p.owner && !p.impactSent && !p.exploded) this.duel.onImpact(p.pos);
        this.scene.remove(p.mesh); if (p.thrust) p.thrust.stop(); this.projectiles.splice(i, 1); continue;
      }
      if (this.duel && p.rolling && !p.impactSent) { p.impactSent = true; this.duel.onImpact(p.pos); }
      const speed = p.vel.length();
      const steps = Math.max(1, Math.ceil(speed * dt / 0.2));
      const h = dt / steps;
      for (let s = 0; s < steps && !p.dead; s++) this.stepProjectile(p, h);
      p.mesh.position.copy(p.pos);
      if (p.type === 'rocket') p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), p.vel.clone().normalize());
      else if (!p.rolling) p.mesh.rotation.set(p.mesh.rotation.x + p.spin.x * dt, p.mesh.rotation.y + p.spin.y * dt, p.mesh.rotation.z + p.spin.z * dt);
      if (p.type === 'grenade') {
        p.fuse -= dt;
        if (p.fuse <= 0) { this.explode(p.pos.clone().add(new THREE.Vector3(0, 0.15, 0)), 1.0, 3.6, { source: 'grenade' }); p.dead = true; p.exploded = true; }
      }
      if (p.type === 'rocket') {
        p.trailAcc += dt;
        while (p.trailAcc > 0.012) {
          p.trailAcc -= 0.012;
          const back = p.pos.clone().addScaledVector(p.vel.clone().normalize(), -0.35);
          this.fx.smoke(back, { dark: R(0.75, 0.9), s0: 0.25, s1: R(1.2, 2.2), life: R(1.5, 3), vy: R(0.1, 0.4), a: 0.45, drag: 1.5, spread: 0.1 });
          if (Math.random() < 0.6) this.fx.fireball(back, { s0: 0.3, s1: 0.6, life: 0.12, vy: 0 });
        }
        if (p.age > 5) { this.explode(p.pos.clone(), 1.6, 4.6, { source: 'rocket' }); p.dead = true; }
      }
      if (p.type === 'cannonball' && p.rolling && p.age > 25) p.dead = true;
      if ((p.type === 'rock' || p.type === 'ball') && p.age > 8) p.dead = true;
      if (p.pos.y < -20 || Math.abs(p.pos.x) > 200 || Math.abs(p.pos.z) > 200) p.dead = true;
    }
  }

  stepProjectile(p, h) {
    const grav = p.type === 'rocket' ? -1.2 : p.type === 'ball' ? -9.81 : -13;
    if (p.type === 'rocket') { const d = p.vel.clone().normalize(); p.vel.addScaledVector(d, 26 * h); if (p.vel.length() > 70) p.vel.setLength(70); }
    p.vel.y += grav * h;
    if (p.windK) p.vel.addScaledVector(this.wind, p.windK * h);
    if (p.rolling) {
      // heavy ball rolling on the ground
      p.vel.multiplyScalar(1 - Math.min(1, 0.9 * h));
      const f = this.physics.floorAt(p.pos.x, p.pos.z) + 0.13;
      p.pos.addScaledVector(p.vel, h);
      if (p.pos.y < f) { p.pos.y = f; p.vel.y = Math.max(0, p.vel.y); }
      const c = worldToCell(p.pos.x, p.pos.y, p.pos.z);
      if (c >= 0 && this.world.mat[c]) { p.vel.x *= -0.3; p.vel.z *= -0.3; p.pos.addScaledVector(p.vel, h * 2); }
      p.mesh.rotation.x += p.vel.z * h / 0.13; p.mesh.rotation.z -= p.vel.x * h / 0.13;
      return;
    }
    const len = p.vel.length() * h;
    if (len < 1e-6) return;
    const dir = p.vel.clone().divideScalar(p.vel.length());
    const wh = this.world.raycast(p.pos, dir, len);
    const th = this.terrain.raycast(p.pos, dir, len + 0.01);
    const bh = this.physics.raycastBodies(p.pos, dir, len);
    let best = null, bt = 1e9;
    if (wh && wh.t < bt) { best = 'w'; bt = wh.t; }
    if (th && th.t < bt) { best = 't'; bt = th.t; }
    if (bh && bh.t < bt && (bh.b.kind === 'prop' || p.type === 'rocket' || p.type === 'cannonball')) { best = 'b'; bt = bh.t; }
    const boh = this.duel ? this.duel.rayBosses(p.pos, dir, len, p.age < 0.4 ? p.owner : null) : null;
    if (boh && boh.t < bt) {
      const point = p.pos.clone().addScaledVector(dir, boh.t), sp = p.vel.length();
      if (p.type === 'rocket') { this.explode(point, 1.6, 4.6, { source: 'rocket' }); p.dead = true; p.exploded = true; return; }
      const dmg = { rock: 6, ball: 4, grenade: 2, cannonball: 22 }[p.type] || 5;
      this.duel.damage(boh.b, dmg * (boh.head ? 1.5 : 1), 'projétil', point);
      boh.b.vel.addScaledVector(dir, p.type === 'cannonball' ? 9 : 1.5); boh.b.knockT = 0.4;
      if (p.type === 'cannonball') { p.vel.multiplyScalar(0.7); p.pos.copy(point).addScaledVector(dir, 0.6); this.shake(0.3); this.audio.play('bigimpact', { pos: point, vol: 1 }); return; }
      p.vel.multiplyScalar(-0.25); p.pos.copy(point).addScaledVector(dir, -0.1);
      if (p.type !== 'grenade') p.dead = true;
      return;
    }
    if (!best) { p.pos.addScaledVector(dir, len); return; }
    const point = p.pos.clone().addScaledVector(dir, bt);
    const normal = best === 'w' ? wh.normal : best === 't' ? th.normal : dir.clone().negate();
    const speed = p.vel.length();
    switch (p.type) {
      case 'rocket':
        this.explode(point.addScaledVector(normal, 0.2), 1.6, 4.6, { source: 'rocket' }); p.dead = true; p.exploded = true; return;
      case 'grenade': {
        if (best === 'b') this.physics.applyImpulse(bh.b, dir.clone().multiplyScalar(0.3), point);
        if (best === 'w' && wh.mat === MAT.GLASS) { this.world.damageCell(wh.cell, 10, { cause: 'bullet', vel: p.vel.clone().multiplyScalar(0.3) }); p.pos.copy(point).addScaledVector(dir, 0.05); return; }
        const vn = p.vel.dot(normal);
        p.vel.addScaledVector(normal, -vn * 1.4);
        p.vel.multiplyScalar(0.6);
        p.pos.copy(point).addScaledVector(normal, 0.08);
        if (speed > 2 && this.sndBudget < 6) { this.sndBudget++; this.audio.play('can', { pos: point, vol: Math.min(0.7, speed / 14), rate: 1.3 }); }
        p.spin.multiplyScalar(0.6);
        return;
      }
      case 'rock':
      case 'ball': {
        const isBall = p.type === 'ball';
        const dmg = isBall ? 4 + speed * 1.15 : 8 + speed * 0.9;
        if (best === 'w') {
          const m = wh.mat;
          const destroyed = this.world.damageCell(wh.cell, dmg, { cause: 'bullet', vel: p.vel.clone().multiplyScalar(0.25) });
          this.impactFX(point, normal, m, isBall ? 0.4 : 0.5, wh.cell);
          if (destroyed && (m === MAT.GLASS || m === MAT.TILE || (isBall && speed > 35))) {
            p.vel.multiplyScalar(m === MAT.GLASS ? 0.85 : 0.55);
            p.pos.copy(point).addScaledVector(dir, 0.05);
            return;
          }
          if (!destroyed && m !== MAT.GLASS && isBall) this.fx.decal('hole', point, normal, 0.06, wh.cell);
        } else if (best === 'b') {
          this.physics.applyImpulse(bh.b, dir.clone().multiplyScalar(speed * (isBall ? 0.004 : 0.01)), point);
          if (bh.b.kind === 'prop') { this.damageProp(bh.b, dmg * 0.4); this.audio.play(bh.b.prop === 'car' ? 'metalhit' : 'can', { pos: point, vol: 0.6 }); }
        } else this.impactFX(point, normal, MAT.STONE, 0.3);
        // bounce once then rest as debris
        const vn = p.vel.dot(normal);
        p.vel.addScaledVector(normal, -vn * 1.35).multiplyScalar(0.35);
        p.pos.copy(point).addScaledVector(normal, 0.06);
        p.bounces++;
        if (p.bounces > 1 || speed < 4) {
          p.dead = true;
          if (!isBall) this.physics.spawnDebris(MAT.STONE, p.pos.clone(), p.vel.clone(), 0.38, 0x8b8a86, { breakable: false });
        }
        return;
      }
      case 'cannonball': {
        if (!p.exploded) { p.exploded = true; this.explode(point.clone().addScaledVector(normal, 0.2), 0.75, 2.4, { source: 'cannon', noCrater: best !== 't' }); }
        if (best === 'b') { this.physics.applyImpulse(bh.b, dir.clone().multiplyScalar(speed * 0.06), point); if (bh.b.kind === 'prop') this.damageProp(bh.b, 150); p.vel.multiplyScalar(0.6); p.pos.copy(point).addScaledVector(dir, 0.3); return; }
        if (best === 't') {
          this.terrain.crater(point.x, point.z, 1.0, 0.35);
          const vn = p.vel.dot(normal);
          p.vel.addScaledVector(normal, -vn * 1.25).multiplyScalar(0.55);
          p.pos.copy(point).addScaledVector(normal, 0.14);
          this.fx.chipsBurst(point, 10, 0x6b5a40, 5, 0.08, normal);
          if (p.vel.length() < 9) p.rolling = true;
          return;
        }
        // plough through voxels: destroy a ~1m wide hole while kinetic energy lasts
        const cost = this.carve(point, dir, 0.62, p);
        p.energy -= cost;
        p.vel.multiplyScalar(Math.max(0, Math.sqrt(Math.max(0, p.energy) / 2600)));
        if (p.energy <= 0 || p.vel.length() < 8) {
          const vn = p.vel.dot(normal);
          p.vel.addScaledVector(normal, -vn * 1.2).multiplyScalar(0.3);
          p.pos.copy(point).addScaledVector(normal, 0.15);
          p.rolling = true;
        } else p.pos.copy(point).addScaledVector(dir, 0.1);
        this.shake(0.15);
        return;
      }
    }
  }

  carve(point, dir, radius, p) {
    let cost = 0;
    const r = Math.ceil(radius / VOX);
    const ci = Math.floor((point.x + 24) / VOX), cj = Math.floor(point.y / VOX), ck = Math.floor((point.z + 26) / VOX);
    const v = dir.clone().multiplyScalar(p.vel.length() * 0.45);
    const tmp = new THREE.Vector3();
    for (let dj = -r; dj <= r; dj++) for (let dk = -r; dk <= r; dk++) for (let di = -r; di <= r; di++) {
      const c = worldToCell(point.x + di * VOX, point.y + dj * VOX, point.z + dk * VOX);
      if (c < 0 || !this.world.mat[c]) continue;
      cellCenter(c, tmp);
      const d = tmp.distanceTo(point);
      if (d > radius + VOX * 0.5) continue;
      const m = this.world.mat[c];
      const hp = this.world.hp[c];
      cost += Math.min(hp, MATS[m].hp) * 1.1;
      this.world.damageCell(c, hp + 1, { cause: 'kinetic', vel: v.clone().add(new THREE.Vector3(R(-2, 2), R(0, 3), R(-2, 2))) });
    }
    if (cost > 0 && this.sndBudget < 7) { this.sndBudget++; this.audio.play('crumble', { pos: point, vol: 1, rate: 0.8 }); this.audio.play('bigimpact', { pos: point, vol: 0.6, rate: 0.9 }); }
    return cost;
  }

  // ---------------- explosions ----------------
  explode(pos, P, R0, opts = {}) {
    const world = this.world, physics = this.physics, fx = this.fx;
    const tmp = new THREE.Vector3();
    // chain-reaction combo
    if (opts.chain) {
      this.combo = this.comboT > 0 ? this.combo + 1 : 1;
      this.comboT = 2.5;
      if (this.combo >= 2) this.toast(`REAÇÃO EM CADEIA x${this.combo}`);
    }
    // --- voxel damage with occlusion (thick walls shelter what's behind them)
    const r = Math.ceil(R0 / VOX);
    const ci = Math.floor((pos.x + 24) / VOX), cj = Math.floor(pos.y / VOX), ck = Math.floor((pos.z + 26) / VOX);
    const todo = [];
    const dir = new THREE.Vector3();
    for (let dj = -r; dj <= r; dj++) for (let dk = -r; dk <= r; dk++) for (let di = -r; di <= r; di++) {
      const c = worldToCell(pos.x + di * VOX, pos.y + dj * VOX, pos.z + dk * VOX);
      if (c < 0 || !world.mat[c]) continue;
      cellCenter(c, tmp);
      const d = tmp.distanceTo(pos);
      if (d > R0) continue;
      let att = 1;
      if (d > VOX * 0.8) {
        dir.copy(tmp).sub(pos).divideScalar(d);
        if (d > 1.3) world.traverse(pos, dir, d - VOX * 0.6, (cc) => { if (cc !== c) { att *= 1 - MATS[world.mat[cc]].block * 0.45; } return att < 0.05; });
      }
      if (att < 0.05) continue;
      const fall = Math.pow(1 - d / R0, 1.1);
      const dmg = 360 * P * fall * att * R(0.8, 1.2);
      todo.push({ c, dmg, d, att, fall });
    }
    let destroyedN = 0, glassN = 0;
    for (const t of todo) {
      if (!world.mat[t.c]) continue;
      cellCenter(t.c, tmp);
      const v = tmp.clone().sub(pos).normalize().multiplyScalar((4 + 22 * P * t.fall) * R(0.6, 1.2)).add(new THREE.Vector3(0, R(1.5, 4.5) * P, 0));
      const m = world.mat[t.c];
      if (world.damageCell(t.c, t.dmg, { cause: 'explosion', vel: v })) { destroyedN++; if (m === MAT.GLASS) glassN++; }
    }
    // glass further away shatters from the pressure wave
    const gr = Math.ceil(R0 * 1.8 / VOX);
    for (let dj = -gr; dj <= gr; dj += 1) for (let dk = -gr; dk <= gr; dk += 1) for (let di = -gr; di <= gr; di += 1) {
      const c = worldToCell(pos.x + di * VOX, pos.y + dj * VOX, pos.z + dk * VOX);
      if (c < 0 || world.mat[c] !== MAT.GLASS) continue;
      const d = cellCenter(c, tmp).distanceTo(pos);
      if (d < R0 * 1.8 && Math.random() < 0.85) {
        world.damageCell(c, 20, { cause: 'explosion', vel: tmp.clone().sub(pos).normalize().multiplyScalar(R(3, 7)) }); glassN++;
      }
    }
    // --- bodies & props
    const hits = physics.blast(pos, 16 * P, R0 * 1.7, opts.exclude || null);
    for (const h of hits) this.damageProp(h.b, 260 * P * h.f, { chain: true });
    if (this.duel) { this.duel.explosionHit(pos, P, R0); this.duel.onImpact(pos); }
    // --- terrain
    const gh = this.terrain.heightAt(pos.x, pos.z);
    const above = pos.y - gh;
    if (above < R0 * 0.55) {
      const depth = P * 0.42 * (1 - above / (R0 * 0.55));
      if (!opts.noCrater) this.terrain.crater(pos.x, pos.z, R0 * 0.42, depth);
      else this.terrain.scorch(pos.x, pos.z, R0 * 0.5);
      for (let i = 0; i < 10 * P; i++) this.fx.chip(new THREE.Vector3(pos.x, gh + 0.1, pos.z), new THREE.Vector3(R(-6, 6), R(4, 11), R(-6, 6)).multiplyScalar(P * 0.8), R(0.06, 0.16), 0x5d4a33);
      // rubble on ground in the area gets refreshed
      physics.rebuildRubble();
    }
    // scorch decals on nearby surfaces
    for (const d of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, 1, 0]]) {
      const dd = new THREE.Vector3(d[0], d[1], d[2]);
      const h = world.raycast(pos, dd, R0 * 0.8);
      if (h) fx.decal('scorch', h.point, h.normal, R0 * 0.9, h.cell);
    }
    // --- visuals
    const dist = this.camera.position.distanceTo(pos);
    fx.flashSprite(pos, 7 * P * R0 / 3, [1, 0.92, 0.75], 0.12);
    fx.light(pos, 80 * P, 0.35 + P * 0.15);
    fx.shockwave(pos, R0 * 2.4, 0.35 + P * 0.15);
    const fq = this.q.fx || 0.75;
    const nFire = Math.round((12 * P + 4) * (0.5 + fq * 0.5));
    for (let i = 0; i < nFire; i++) {
      const v = new THREE.Vector3(R(-1, 1), R(-0.2, 1), R(-1, 1)).normalize().multiplyScalar(R(2, 9) * P);
      fx.fireball(pos.clone().add(v.clone().multiplyScalar(0.08)), { vx: v.x, vy: v.y + 1, vz: v.z, s0: 1.2 * P, s1: R(2.6, 4.2) * P * (R0 / 4), life: R(0.5, 1.0) * (0.7 + P * 0.3), drag: 3.2 });
    }
    const nSmoke = Math.round((12 * P + 4) * fq);
    for (let i = 0; i < nSmoke; i++) {
      const v = new THREE.Vector3(R(-1, 1), R(0, 1), R(-1, 1)).normalize().multiplyScalar(R(1, 5) * P);
      fx.smoke(pos.clone().add(v.clone().multiplyScalar(0.2)), { dark: R(0.12, 0.3), vx: v.x, vy: v.y + R(1, 2.5), vz: v.z, s0: 1.5 * P, s1: R(4, 6.5) * P, life: R(3.5, 7), a: 0.65, drag: 1.2, spread: R0 * 0.3 });
    }
    for (let i = 0; i < 22 * P * fq; i++) fx.spark(pos, new THREE.Vector3(R(-1, 1), R(-0.1, 1.2), R(-1, 1)).normalize().multiplyScalar(R(8, 22)), { size: R(0.08, 0.16), life: R(0.4, 1.2), g: -9 });
    const nRing = Math.round(18 * fq);
    if (above < 2) for (let i = 0; i < nRing; i++) {
      const a = i / nRing * Math.PI * 2;
      fx.dust(new THREE.Vector3(pos.x + Math.cos(a) * 0.8, gh + 0.2, pos.z + Math.sin(a) * 0.8), [0.62, 0.56, 0.47], { vx: Math.cos(a) * R(6, 11) * P, vz: Math.sin(a) * R(6, 11) * P, vy: R(0.1, 0.6), a: 0.5, s1: R(3, 5), drag: 2, life: R(2, 4) });
    }
    // lingering fire on wood nearby
    if (P >= 1 && Math.random() < 0.6) {
      const h = world.raycast(pos, new THREE.Vector3(0, -1, 0), 3);
      if (h && (h.mat === MAT.WOOD || h.mat === MAT.TRIM)) fx.startFire(h.point, 7, 0.6, this.audio);
    }
    // --- sound
    const sdelay = 0;
    this.audio.play('explosion', { pos, vol: 1, rate: 1.05 - P * 0.15, reverb: 0.8, ref: 14 });
    if (P >= 1.2) this.audio.play('cannon', { pos, vol: 0.9, rate: 0.55, idx: 1, reverb: 0.6, ref: 14 });
    this.audio.thump(P * 1.1, { pos });
    if (destroyedN > 6) this.later(R(0.25, 0.5), () => this.audio.play('rubble', { pos, vol: Math.min(1, 0.4 + destroyedN / 60), rate: R(0.7, 0.95) }));
    if (glassN > 3) this.later(R(0.05, 0.2), () => this.audio.play('glassbreak', { pos, vol: 0.9 }));
    // --- feel
    const fall = Math.min(1, 22 / (dist + 6));
    this.shake(Math.min(1, P * 0.85 * fall));
    this.fovPunch(P * 6 * fall);
    this.haptic(P * fall * 1.1);
    if (P >= 1.4 && dist < 45) this.slowmo(0.35, 0.55);
    if (sdelay) {}
  }

  // ---------------- input & HUD ----------------
  initInput() {
    const inp = () => this.input;
    window.addEventListener('keydown', e => {
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      this.input.keys[e.code] = true;
      if (!this.started) return;
      if ((e.code === 'KeyF' || e.code === 'Enter' || e.code === 'KeyX') && !e.repeat) this.fireDown();
      if (e.code.startsWith('Digit')) { const n = +e.code.slice(5) - 1; if (n >= 0 && n < this.weapons.length) this.selectWeapon(n); }
      if (e.code === 'KeyV' && this.duel) this.toggleView();
      if (e.code === 'KeyM' && this.duel && this.duel.crew) { this.duel.crew.setAerial(!this.duel.aerial); if (this.duel.aerial && document.pointerLockElement) document.exitPointerLock(); }
      if (e.code === 'KeyQ') this.selectWeapon((this.wi + this.weapons.length - 1) % this.weapons.length);
      if (e.code === 'KeyE') this.selectWeapon((this.wi + 1) % this.weapons.length);
      if (e.code === 'KeyT') this.toggleSlow();
      if (e.code === 'KeyR' && e.shiftKey) this.resetLevel();
      if (e.code === 'KeyZ') this.toggleZoom();
    });
    window.addEventListener('keyup', e => {
      this.input.keys[e.code] = false;
      if (this.started && (e.code === 'KeyF' || e.code === 'Enter' || e.code === 'KeyX')) this.fireUp();
    });
    const canvas = () => this.renderer.domElement;
    // mouse (desktop): pointer lock
    // mouse: left = fire; right button held + drag = aim (works even where pointer lock is blocked); right click = zoom
    const surfEl = () => $('touch');
    const locked = () => document.pointerLockElement === surfEl();
    this.rDrag = null;
    document.addEventListener('mousedown', e => {
      if (!this.started || (e.target !== surfEl() && e.target !== canvas())) return;
      if (e.button === 0 && this.duel && this.duel.aerial) { if (locked()) document.exitPointerLock(); else this.duel.crew.aerialTap(e.clientX, e.clientY); return; }
      if (e.button === 0) {
        if (!locked() && !this.triedLock) { this.triedLock = true; try { const p = surfEl().requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (er) {} }
        this.fireDown();
      }
      if (e.button === 2) this.rDrag = { moved: 0 };
    });
    document.addEventListener('mouseup', e => {
      if (e.button === 0) this.fireUp();
      if (e.button === 2 && this.rDrag) { if (this.rDrag.moved < 6) this.toggleZoom(); this.rDrag = null; }
    });
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('mousemove', e => {
      const k = 0.0022 * (this.camera.fov / 70);
      if (locked()) { this.input.lookDX += e.movementX * k; this.input.lookDY += e.movementY * k; }
      else if (this.rDrag) { this.rDrag.moved += Math.abs(e.movementX) + Math.abs(e.movementY); this.input.lookDX += e.movementX * k * 1.6; this.input.lookDY += e.movementY * k * 1.6; }
    });
    document.addEventListener('pointerlockchange', () => { this.triedLock = locked(); });
    // touch: left half joystick, right half look (buttons handle themselves)
    this.touches = new Map();
    const joy = $('joy'), knob = $('knob');
    const sens = () => +(this.loadPref('sens', '1')) * 0.0055;
    const onStart = e => {
      if (!this.started) return;
      for (const t of e.changedTouches) {
        if (t.target.closest && t.target.closest('.btn, .panel, button')) continue;
        const left = t.clientX < window.innerWidth * 0.4;
        if (left && ![...this.touches.values()].some(v => v.type === 'move')) {
          this.touches.set(t.identifier, { type: 'move', x0: t.clientX, y0: t.clientY });
          joy.style.left = (t.clientX - 75) + 'px'; joy.style.top = (t.clientY - 75) + 'px'; joy.classList.add('active');
        } else this.touches.set(t.identifier, { type: 'look', x: t.clientX, y: t.clientY, x0: t.clientX, y0: t.clientY, t0: performance.now() });
      }
      e.preventDefault();
    };
    const onMove = e => {
      for (const t of e.changedTouches) {
        const s = this.touches.get(t.identifier);
        if (!s) continue;
        if (s.type === 'move') {
          let dx = t.clientX - s.x0, dy = t.clientY - s.y0;
          const l = Math.hypot(dx, dy), max = 60;
          if (l > max) { dx *= max / l; dy *= max / l; }
          knob.style.transform = `translate(${dx}px, ${dy}px)`;
          this.input.mx = dx / max; this.input.mz = dy / max;
        } else {
          const k = sens() * (this.camera.fov / 70);
          this.input.lookDX += (t.clientX - s.x) * k; this.input.lookDY += (t.clientY - s.y) * k;
          s.x = t.clientX; s.y = t.clientY;
        }
      }
      e.preventDefault();
    };
    const onEnd = e => {
      for (const t of e.changedTouches) {
        const s = this.touches.get(t.identifier);
        if (!s) continue;
        if (s.type === 'move') { this.input.mx = 0; this.input.mz = 0; knob.style.transform = ''; joy.classList.remove('active'); joy.style.left = ''; joy.style.top = ''; }
        // a short tap on the aerial map gives an order to the henchmen
        else if (this.duel && this.duel.aerial && Math.hypot(t.clientX - s.x0, t.clientY - s.y0) < 14) this.duel.crew.aerialTap(t.clientX, t.clientY);
        this.touches.delete(t.identifier);
      }
    };
    const surf = $('touch');
    surf.addEventListener('touchstart', onStart, { passive: false });
    surf.addEventListener('touchmove', onMove, { passive: false });
    surf.addEventListener('touchend', onEnd); surf.addEventListener('touchcancel', onEnd);
    // fire button supports drag-to-look while held (aim while shooting)
    const fire = $('fire');
    let fireTouch = null;
    fire.addEventListener('touchstart', e => { e.preventDefault(); const t = e.changedTouches[0]; fireTouch = { id: t.identifier, x: t.clientX, y: t.clientY }; fire.classList.add('down'); this.fireDown(); }, { passive: false });
    fire.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) if (fireTouch && t.identifier === fireTouch.id) {
        const k = sens() * 0.6 * (this.camera.fov / 70);
        this.input.lookDX += (t.clientX - fireTouch.x) * k; this.input.lookDY += (t.clientY - fireTouch.y) * k;
        fireTouch.x = t.clientX; fireTouch.y = t.clientY;
      }
    }, { passive: false });
    const fireEnd = e => { e.preventDefault(); fireTouch = null; fire.classList.remove('down'); this.fireUp(); };
    fire.addEventListener('touchend', fireEnd, { passive: false }); fire.addEventListener('touchcancel', fireEnd, { passive: false });
    fire.addEventListener('mousedown', e => { e.stopPropagation(); this.fireDown(); });
  }

  fireDown(fromAI = false) {
    if (!this.started || this.arsenalOpen) return;
    if (this.duel) { if (this.duel.ctrl) return; if (this.duel.isAI() !== fromAI) return; if (!this.duel.canFire()) return; this.duel.onAimStart(); }
    this.audio.resume(); this.weapons[this.wi].down();
  }
  fireUp(fromAI = false) { if (this.duel && this.duel.isAI() !== fromAI) return; this.weapons[this.wi].up(); }

  selectWeapon(i, force = false) {
    if (this.duel && !force) {
      if (this.duel.isAI()) return;
      if (!this.duel.canSwitch()) { this.toast(this.duel.switchBlockedMsg()); return; }
      const id = this.weapons[i].id;
      if (this.duel.boss.stock[id] <= 0) { this.toast(this.duel.boss.locked.has(id) ? 'ARMA TRANCADA: PEGUE CAIXAS' : 'SEM ESTOQUE DESSA ARMA'); return; }
    }
    if (this.duel) this.duel.boss.wi = i;
    if (i === this.wi && this.weapons[i].equipped) return;
    if (this.wi >= 0 && this.weapons[this.wi]) this.weapons[this.wi].unequip();
    this.wi = i;
    if (this.ctxAI) { this.weapons[i].equip(); return; }
    if (this.zoomed && this.weapons[i].id !== 'rifle50') this.toggleZoom(false);
    this.weapons[i].equip();
    this.audio.play('ui', { vol: 0.3 });
    this.updateWeaponCard();
  }

  // duel: over-the-shoulder camera <-> first person (remembered between games)
  toggleView(force) {
    this.firstPerson = force != null ? force : !this.firstPerson;
    this.savePref('fp', this.firstPerson ? '1' : '0');
    $('view').classList.toggle('on', this.firstPerson);
    if (force == null) this.toast(this.firstPerson ? 'PRIMEIRA PESSOA' : 'CÂMERA DE TRÁS');
  }

  toggleZoom(force) {
    this.zoomed = force != null ? force : !this.zoomed;
    $('zoom').classList.toggle('on', this.zoomed);
    $('scope').style.display = this.zoomed && this.weapons[this.wi].id === 'rifle50' ? 'block' : 'none';
  }
  toggleSlow() {
    this.manualSlow = !this.manualSlow;
    this.targetScale = this.manualSlow ? 0.25 : 1; this.slowmoT = 0;
    $('slow').classList.toggle('on', this.manualSlow);
  }

  buildHUD() {
    const lvColors = ['#8BD3E6', '#9BE36B', '#FFC531', '#FF8A2A', '#FF4D4D', '#C77DFF'];
    this.lvColors = lvColors;
    // weapons as icons: a small 3x3 grid that opens under the weapon button (the name shows up top when you pick one)
    const grid = $('wgrid');
    this.weapons.forEach((w, i) => {
      const b = document.createElement('button');
      b.className = 'wcard'; b.setAttribute('aria-label', w.name); b.title = w.name;
      b.innerHTML = weaponIcon(w.id, 24) + '<span class="stock"></span>';
      const pick = e => { e.stopPropagation(); if (e.type === 'touchstart') e.preventDefault(); this.selectWeapon(i); this.closeArsenal(); };
      b.addEventListener('click', pick); b.addEventListener('touchstart', pick, { passive: false });
      grid.appendChild(b);
    });
    // touchstart (not click): phones don't send clicks while another finger is down, e.g. on the joystick
    const on = (id, fn) => { const el = $(id); el.addEventListener('click', e => { e.stopPropagation(); this.audio.resume(); fn(); }); el.addEventListener('touchstart', e => { e.stopPropagation(); e.preventDefault(); this.audio.resume(); fn(); }, { passive: false }); };
    on('prev', () => this.selectWeapon((this.wi + this.weapons.length - 1) % this.weapons.length));
    on('next', () => this.selectWeapon((this.wi + 1) % this.weapons.length));
    on('arsenal', () => this.openArsenal());
    on('arsenal-close', () => this.closeArsenal());
    on('zoom', () => this.toggleZoom());
    on('jump', () => { this.input.jump = true; });
    on('view', () => this.toggleView());
    on('slow', () => this.toggleSlow());
    on('reset', () => { this.resetLevel(); this.toast('CENÁRIO NOVINHO'); });
    on('settings', () => { $('settings-panel').style.display = 'flex'; this.arsenalOpen = true; });
    on('settings-close', () => { $('settings-panel').style.display = 'none'; this.arsenalOpen = false; });
    on('fullscreen', () => this.goFullscreen());
    for (const k of Object.keys(QUALITY)) {
      const b = document.createElement('button');
      b.className = 'qbtn' + (k === this.qKey ? ' on' : ''); b.textContent = QUALITY[k].name; b.dataset.q = k;
      b.addEventListener('click', () => { this.setQuality(k); this.autoQualityDone = true; this.savePref('quality', k); });
      $('qrow').appendChild(b);
    }
    const vib = $('vib'); vib.checked = this.loadPref('vib', '1') === '1'; Haptics.enabled = vib.checked;
    vib.addEventListener('change', () => { Haptics.enabled = vib.checked; this.savePref('vib', vib.checked ? '1' : '0'); if (vib.checked) Haptics.pulse(40); });
    const snd = $('snd'); snd.checked = this.loadPref('snd', '1') === '1'; this.audio.muted = !snd.checked;
    snd.addEventListener('change', () => { this.audio.muted = !snd.checked; this.savePref('snd', snd.checked ? '1' : '0'); });
    const sens = $('sens'); sens.value = this.loadPref('sens', '1');
    sens.addEventListener('input', () => this.savePref('sens', sens.value));
    $('m-lab').addEventListener('click', () => this.start('lab'));
    $('m-duel').addEventListener('click', () => { $('modes').style.display = 'none'; $('duelopts').style.display = 'flex'; $('duelopts').parentElement.classList.add('duelmode'); });
    $('duel-back').addEventListener('click', () => { $('modes').style.display = 'flex'; $('duelopts').style.display = 'none'; $('duelopts').parentElement.classList.remove('duelmode'); });
    const ul = $('opt-unlock'); ul.checked = this.loadPref('unlock', '0') === '1';
    ul.addEventListener('change', () => this.savePref('unlock', ul.checked ? '1' : '0'));
    const U = o => Object.assign(o, { unlock: ul.checked });
    document.querySelectorAll('#duelopts .opt[data-diff]').forEach(b => b.addEventListener('click', () => this.start('duel', U({ cpu: true, diff: b.dataset.diff }))));
    $('two-players').addEventListener('click', () => this.start('duel', U({ cpu: false })));
    document.querySelectorAll('#duelopts .opt[data-rt]').forEach(b => b.addEventListener('click', () => this.start('duel', U({ n: 3, realtime: true, seats: ['human', 'cpu', 'cpu'], diff: b.dataset.rt }))));
    $('three-people').addEventListener('click', () => this.start('duel', U({ n: 3, seats: ['human', 'human', 'human'] })));
    $('three-cpu').addEventListener('click', () => this.start('duel', U({ n: 3, seats: ['human', 'cpu', 'cpu'], diff: 'medio' })));
    on('pass', () => this.duel && this.duel.passTurn());
    $('handoff-ok').addEventListener('click', () => { this.audio.resume(); this.duel && this.duel.handoffReady(); });
    $('r-again').addEventListener('click', () => { $('result').style.display = 'none'; this.setMode('duel', this.duelOpts); });
    $('r-menu').addEventListener('click', () => { $('result').style.display = 'none'; this.toMenu(); });
    $('to-menu').addEventListener('click', () => { $('settings-panel').style.display = 'none'; this.arsenalOpen = false; this.toMenu(); });
  }

  setQuality(k) {
    this.qKey = k;
    Object.assign(this.q, QUALITY[k]);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pr));
    this.sun.castShadow = this.q.shadows;
    if (this.q.shadows && this.sun.shadow.mapSize.x !== this.q.shadowSize) {
      this.sun.shadow.mapSize.set(this.q.shadowSize, this.q.shadowSize);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this.world.setShadows(this.q.shadows); this.physics.setShadows(this.q.shadows);
    this.onResize();
    document.querySelectorAll('.qbtn').forEach(b => b.classList.toggle('on', b.dataset.q === k));
  }

  async start(mode = 'lab', opts = {}) {
    $('modes').style.display = 'none'; $('duelopts').style.display = 'none'; $('loading').style.display = 'block'; $('duelopts').parentElement.classList.remove('duelmode');
    this.goFullscreen();
    if (!this.audio.ready) { try { await this.audio.init(); } catch (e) { console.warn(e); } }
    this.audio.resume();
    this.audio.loop('ambience', 0.22);
    $('start').style.display = 'none'; $('loading').style.display = 'none'; $('modes').style.display = 'flex';
    $('hud').style.visibility = 'visible';
    this.started = true;
    this.setMode(mode, opts);
    this.startTime = performance.now();
  }

  setMode(mode, opts = {}) {
    if (this.duel) { this.duel.dispose(); this.duel = null; }
    for (const w of this.labWeapons) w.unequip();
    if (this.zoomed) this.toggleZoom(false);
    this.mode = mode;
    this.timeScale = 1; this.targetScale = 1; this.manualSlow = false; $('slow').classList.remove('on');
    if (mode === 'duel') {
      this.duelOpts = opts;
      this.layout = opts.n === 3 ? DUEL3_LAYOUT : DUEL_LAYOUT;
      opts.layout = this.layout;
      this.resetLevel();
      this.duel = new Duel(this, opts);
      $('logo').style.display = 'none'; $('score').style.display = 'none';
      $('slow').style.display = 'none'; $('reset').style.display = 'none';
      $('view').style.display = ''; this.toggleView(this.loadPref('fp', '0') === '1');
      this.updateWeaponCard();
    } else {
      this.layout = LAYOUT;
      this.weapons = this.labWeapons; this.player = this.labPlayer; this.aimFrame = this.camera;
      setSleeveColor(0xff8a2a);
      this.resetLevel();
      $('logo').style.display = ''; $('score').style.display = '';
      $('slow').style.display = ''; $('reset').style.display = '';
      $('view').style.display = 'none';
      $('cross').style.display = 'block';
      this.wi = -1;
      this.selectWeapon(0);
    }
    this._ammoKey = null;
  }

  toMenu() {
    if (this.duel) { this.duel.dispose(); this.duel = null; }
    for (const w of this.weapons) w.unequip();
    this.mode = 'lab'; this.layout = LAYOUT;
    this.weapons = this.labWeapons; this.player = this.labPlayer; this.aimFrame = this.camera;
    this.started = false;
    this.resetLevel();
    $('start').style.display = 'flex';
    $('hud').style.visibility = 'hidden';
  }

  goFullscreen() {
    const el = document.documentElement;
    try {
      const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen && el.webkitRequestFullscreen();
      if (p && p.then) p.then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) {} }).catch(() => {});
    } catch (e) {}
  }

  openArsenal() { const g = $('wgrid'); const open = g.style.display !== 'grid'; g.style.display = open ? 'grid' : 'none'; }
  closeArsenal() { $('wgrid').style.display = 'none'; this.arsenalOpen = false; }

  updateWeaponCard() {
    const w = this.weapons[this.wi];
    $('wlevel').textContent = 'NÍVEL ' + w.level;
    $('wlevel').style.background = this.lvColors[w.level - 1];
    $('wname').textContent = w.name;
    $('wicon').innerHTML = weaponIcon(w.id, 26);
    $('zoom').style.display = 'flex';
    document.querySelectorAll('.wcard').forEach((b, i) => b.classList.toggle('on', i === this.wi));
    if (this._lastWid !== undefined && this._lastWid !== w.id) this.notice(w.name);
    this._lastWid = w.id;
  }

  // short notices: one thin line at the top, two at most, they fade on their own
  toast(text) {
    const box = $('toasts');
    if (box.lastChild && box.lastChild.dataset.t === text) return;
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = text; el.dataset.t = text;
    box.appendChild(el);
    setTimeout(() => el.classList.add('out'), 1700);
    setTimeout(() => el.remove(), 2200);
    while (box.children.length > 2) box.firstChild.remove();
  }
  notice(text) { this.toast(text); }

  floater(v, pos) {
    const el = document.createElement('div');
    el.className = 'floater'; el.textContent = '+' + fmt(v);
    $('floaters').appendChild(el);
    this.floaters.push({ el, pos: pos.clone(), t: 0 });
  }

  updateHUD(force) {
    const pct = this.world.totalHouse ? this.world.removedHouse / this.world.totalHouse : 0;
    if (force || this._lastMoney !== this.money) { $('money').textContent = fmt(this.money); this._lastMoney = this.money; }
    $('bar').style.width = Math.min(100, pct * 100).toFixed(1) + '%';
    $('pct').textContent = 'Destruição ' + Math.round(pct * 100) + '%';
    const w = this.weapons[this.wi];
    if (w && $('wstatus').textContent !== w.status) $('wstatus').textContent = w.status;
    if (w) {
      const am = w.ammo();
      const key = w.id + ':' + (am ? am.join('/') : 'inf');
      if (key !== this._ammoKey) {
        this._ammoKey = key;
        const n = $('ammo-n'), pips = $('pips');
        if (!am) { n.innerHTML = '∞'; n.classList.remove('empty'); pips.innerHTML = ''; }
        else {
          n.innerHTML = `${am[0]}<small>/${am[1]}</small>`;
          n.classList.toggle('empty', am[0] === 0);
          pips.className = w.id === 'shotgun' ? 'shell' : am[1] <= 5 ? 'big' : '';
          let h = '';
          for (let i = 0; i < am[1]; i++) h += `<i class="${i < am[0] ? '' : 'off'}"></i>`;
          pips.innerHTML = h;
        }
      }
    }
    if (this.mode === 'lab' && pct > 0.85 && !this.flatToast) { this.flatToast = true; this.toast('CASA NO CHÃO! Toque em reiniciar'); }
  }

  // ---------------- main loop ----------------
  loop() {
    requestAnimationFrame(this.loop);
    if (this.paused) { this.clock.getDelta(); return; }
    const rdt = Math.min(0.05, this.clock.getDelta());
    const t0 = performance.now();
    this.update(rdt);
    this.updMs = (this.updMs || 0) * 0.9 + (performance.now() - t0) * 0.1;
    this.render();
  }

  // test hook: advance the simulation without rendering every frame
  sim(seconds, step = 1 / 30) {
    for (let t = 0; t < seconds; t += step) this.update(step);
    this.render();
  }

  update(rdt) {
    // time scale (slow motion) eases in/out
    if (this.slowmoT > 0) { this.slowmoT -= rdt; if (this.slowmoT <= 0 && !this.manualSlow) this.targetScale = 1; }
    this.timeScale += (this.targetScale - this.timeScale) * Math.min(1, rdt * (this.targetScale < this.timeScale ? 18 : 3));
    const dt = rdt * this.timeScale;
    this.sndBudget = 0; this.frameBodies = 0;
    if (this.started) {
      if (this.duel) this.duel.update(rdt, dt);
      else {
        this.updatePlayer(rdt);
        for (const w of this.weapons) if (w.equipped) w.update(dt);
      }
      this.updateProjectiles(dt);
      for (let i = this.timers.length - 1; i >= 0; i--) { const t = this.timers[i]; t.t -= dt; if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); } }
      const P0 = performance.now();
      this.world.updateCrumble(dt);
      this.world.integrity();
      const P1 = performance.now();
      // physics at fixed step
      this.physAcc = (this.physAcc || 0) + dt;
      let n = 0;
      while (this.physAcc >= 1 / 60 && n < 3) { this.physics.step(1 / 60); this.physAcc -= 1 / 60; n++; }
      if (n === 3) this.physAcc = 0;
      const P2 = performance.now();
      this.physicsEvents();
      this.world.integrity();
      const P3 = performance.now();
      const pr = this.prof || (this.prof = { integ: 0, phys: 0, ev: 0, fx: 0, n: 0 });
      pr.integ += (P1 - P0) + (P3 - P2) * 0; pr.phys += P2 - P1; pr.ev += P3 - P2; pr.n++;
      this.flushFrameSounds();
      for (const b of this.physics.props) if (b.onFire && b.fireFollow && !b.dead) b.onFire.p.copy(b.pos).add(new THREE.Vector3(0, 0.5, 0));
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
      // damage value floaters
      if (this.pendingValue) { this.pendingValue.t += rdt; if (this.pendingValue.t > 0.35) { this.floater(this.pendingValue.v, this.pendingValue.pos); this.pendingValue = null; } }
      this.auto(rdt);
    } else {
      // idle camera orbit on the title screen
      const t = performance.now() / 1000;
      this.camera.position.set(Math.sin(t * 0.12) * 22, 9, 16 + Math.cos(t * 0.12) * 6);
      this.camera.lookAt(0, 3.5, -5);
      this.camera.updateMatrixWorld(true);
    }
    const F0 = performance.now();
    this.fx.update(dt, (x, z) => this.physics.floorAt(x, z), this.camera);
    if (this.prof) this.prof.fx += performance.now() - F0;
    this.vmLight.intensity *= Math.exp(-rdt * 30);
    // floaters
    const v = new THREE.Vector3();
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += rdt;
      v.copy(f.pos); v.y += f.t * 1.5;
      v.project(this.camera);
      if (f.t > 1.4 || v.z > 1) { f.el.remove(); this.floaters.splice(i, 1); continue; }
      f.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * window.innerWidth}px, ${(-v.y * 0.5 + 0.5) * window.innerHeight}px) translate(-50%,-50%) scale(${1 + Math.max(0, 0.3 - f.t)})`;
      f.el.style.opacity = Math.min(1, (1.4 - f.t) * 2);
    }
    this.updateHUD();
  }

  render() {
    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.camera);
    if (this.started && !this.duel && !(this.zoomed && this.weapons[this.wi].id === 'rifle50' && !this.weapons[this.wi].anim)) {
      r.clearDepth();
      r.render(this.vmScene, this.vmCam);
    }
  }

  // auto quality: measure the first seconds of play and drop to low if the phone struggles
  auto(rdt) {
    if (this.autoQualityDone) return;
    const el = (performance.now() - this.startTime) / 1000;
    if (el < 2) return;
    this.fpsSamples.push(rdt);
    if (el > 6) {
      const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
      this.autoQualityDone = true;
      if (avg > 1 / 38 && this.qKey !== 'baixa') { this.setQuality('baixa'); this.toast('Qualidade ajustada: Baixa'); }
      else if (avg < 1 / 58 && this.qKey === 'media' && (window.devicePixelRatio || 1) >= 2) { /* stays media: safe default */ }
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  try { window.game = new Game(); }
  catch (e) {
    console.error(e);
    const el = document.getElementById('loading');
    if (el) { el.style.display = 'block'; el.textContent = 'Erro ao iniciar o 3D: ' + e.message; }
  }
});
