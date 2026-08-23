// 沉浸式新闻树 · 入口：场景组装、模块装配、动画主循环
import * as THREE from "/vendor/three/three.module.js";
import { CONFIG } from "./config.js";
import { loadNews } from "./news-data.js";
import { NewsTree } from "./tree.js";
import { BackgroundManager } from "./background.js";
import { DayNightSystem } from "./daynight.js";
import { Interaction } from "./interaction.js";
import { UI } from "./ui.js";
import { makeGlowTexture, makeCloudTexture } from "./textures.js";
import { clamp01, lerp } from "./anim.js";

function byId(id) { return document.getElementById(id); }

const canvas = byId("scene-canvas");

// ---------- 渲染器 ----------
const renderer = new THREE.WebGLRenderer({
  canvas: canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.maxDPR));
renderer.setSize(innerWidth, innerHeight, false);
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x1c2c55, 16, 44);

const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, innerWidth / innerHeight, 0.1, 300);
const camBase = new THREE.Vector3(CONFIG.camera.basePos[0], CONFIG.camera.basePos[1], CONFIG.camera.basePos[2]);
const camLook = new THREE.Vector3(CONFIG.camera.lookAt[0], CONFIG.camera.lookAt[1], CONFIG.camera.lookAt[2]);
camera.position.copy(camBase);
camera.lookAt(camLook);

// ---------- 地面（草原） ----------
const GROUND_V = `
uniform float uTime;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec3 p = position;
  p.y += sin(p.x * 0.35 + uTime * 0.3) * 0.06 + cos(p.z * 0.3 + uTime * 0.24) * 0.06;
  vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const GROUND_F = `
uniform float uNight;
uniform vec3 uDayGrass;
uniform vec3 uNightGrass;
uniform vec3 uFog;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vec3 base = mix(uDayGrass, uNightGrass, uNight);
  float pat = sin(vUv.x * 90.0 + sin(vUv.y * 70.0) * 3.0) * 0.5 + 0.5;
  base *= 0.85 + pat * 0.3;
  float d = length(vWorld.xz);
  float fade = smoothstep(16.0, 34.0, d);
  vec3 c = mix(base, uFog, fade);
  gl_FragColor = vec4(c, 1.0);
}
`;

function makeGround() {
  const geo = new THREE.PlaneGeometry(CONFIG.ground.size, CONFIG.ground.size, CONFIG.ground.segments, CONFIG.ground.segments);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uNight: { value: 1 },
      uDayGrass: { value: new THREE.Color("#4a8a35") },
      uNightGrass: { value: new THREE.Color("#0a2416") },
      uFog: { value: new THREE.Color("#1c2c55") }
    },
    vertexShader: GROUND_V,
    fragmentShader: GROUND_F
  });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  return { mesh: mesh, mat: mat };
}

// ---------- 星辰 ----------
const STAR_V = `
attribute float aSize;
attribute float aPhase;
uniform float uTime;
varying float vTw;
void main() {
  vec3 p = position;
  p.x += sin(uTime * 0.03 + aPhase) * 0.6;
  p.y += cos(uTime * 0.02 + aPhase * 1.3) * 0.3;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * (420.0 / max(0.1, -mv.z));
  vTw = aPhase;
}
`;

const STAR_F = `
uniform float uNight;
uniform float uTime;
varying float vTw;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  float a = smoothstep(0.5, 0.1, d);
  float tw = 0.55 + 0.45 * sin(uTime * (0.5 + vTw * 0.5) + vTw * 6.28);
  float alpha = uNight * a * tw;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(vec3(1.0), alpha);
}
`;

function makeStars() {
  const cfg = CONFIG.stars;
  const pos = [], size = [], phase = [];
  for (let i = 0; i < cfg.count; i++) {
    const r = cfg.radiusMin + Math.random() * (cfg.radiusMax - cfg.radiusMin);
    const y = r * (0.04 + Math.random() * 0.96);
    const phi = Math.random() * Math.PI * 2;
    const horiz = Math.sqrt(Math.max(0.001, r * r - y * y));
    pos.push(Math.cos(phi) * horiz, y, Math.sin(phi) * horiz);
    size.push(cfg.sizeMin + Math.random() * (cfg.sizeMax - cfg.sizeMin));
    phase.push(Math.random() * Math.PI * 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("aSize", new THREE.Float32BufferAttribute(size, 1));
  geo.setAttribute("aPhase", new THREE.Float32BufferAttribute(phase, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uNight: { value: 1 }
    },
    vertexShader: STAR_V,
    fragmentShader: STAR_F,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return { obj: pts, mat: mat };
}

// ---------- 实例化 ----------
const ground = makeGround();
const stars = makeStars();

// ---------- 日月与云 ----------
function makeSprite(tex, colorHex, scale) {
  const mat = new THREE.SpriteMaterial({
    map: tex,
    color: colorHex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 1
  });
  const sp = new THREE.Sprite(mat);
  sp.scale.setScalar(scale);
  scene.add(sp);
  return sp;
}

const glowTex = makeGlowTexture();
const cloudTex = makeCloudTexture();

const moon = makeSprite(glowTex, 0xeaf2ff, 2.2);
moon.position.set(-4.2, 5.8, -9);
const sun = makeSprite(glowTex, 0xffd9a0, 3.0);
sun.position.set(4.8, 5.6, -10);
sun.material.opacity = 0;

const clouds = [];
for (let i = 0; i < 6; i++) {
  const c = makeSprite(cloudTex, 0xffffff, 3 + Math.random() * 3);
  c.position.set(Math.random() * 18 - 9, 5.4 + Math.random() * 2.2, -11 - Math.random() * 4);
  c.material.opacity = 0;
  clouds.push({ obj: c, speed: 0.08 + Math.random() * 0.16 });
}

// ---------- 粒子树 ----------
const data = await loadNews();
const tree = new NewsTree(scene).build(data.categories);

// ---------- 背景与昼夜 ----------
const bg = new BackgroundManager({
  bgEl: byId("bg-layer"),
  maskEl: byId("bg-mask"),
  onSceneChange: function (mode) {
    const isScene = mode === "scene";
    stars.obj.visible = isScene;
    ground.mesh.visible = isScene;
    moon.visible = isScene;
    sun.visible = isScene;
    for (let i = 0; i < clouds.length; i++) clouds[i].obj.visible = isScene;
  }
});

const dn = new DayNightSystem({ bg: bg, scene: scene, duration: CONFIG.dayNight.duration });

dn.addListener(function (n) {
  tree.setNight(n);
  ground.mat.uniforms.uNight.value = n;
  ground.mat.uniforms.uFog.value.copy(scene.fog.color);
  stars.mat.uniforms.uNight.value = n;
  moon.material.opacity = n * 0.92;
  sun.material.opacity = (1 - n) * 0.95;
  for (let i = 0; i < clouds.length; i++) clouds[i].obj.material.opacity = (1 - n) * 0.75;
  ui.setNightLabel(n);
});

// ---------- 持久化设置 ----------
let savedMode = "pin";
try { savedMode = localStorage.getItem("ntree.mode") || "pin"; } catch (e) {}

let savedNight = 1;
try { savedNight = localStorage.getItem("ntree.night") === "day" ? 0 : 1; } catch (e) {}
dn.setNight(savedNight);

let savedBg = null;
try { savedBg = JSON.parse(localStorage.getItem("ntree.bg") || "null"); } catch (e) {}

// ---------- UI 与交互 ----------
const ui = new UI({
  mode: savedMode,
  onMode: function (m) { interaction.setMode(m); ui.syncMode(); },
  onToggleDayNight: function () { dn.toggle(); },
  onBgApply: function (opt) { applyBg(opt); },
  onOpenDetail: function (id) { ui.openDetail(id); },
  onUnpin: function () { interaction.unpin(); }
});

const interaction = new Interaction({
  canvas: canvas,
  camera: camera,
  tree: tree,
  ui: ui,
  getSize: function () { return { w: innerWidth, h: innerHeight }; },
  onOpenDetail: function (id) { ui.openDetail(id); }
});
interaction.attach();

function applyBg(opt) {
  if (opt.mode === "scene") {
    bg.setMode("scene");
    if (opt.night != null) dn.setNight(opt.night);
  } else {
    bg.setMode(opt.mode, opt);
  }
}

if (savedBg && savedBg.mode && savedBg.mode !== "scene") applyBg(savedBg);

// ---------- 窗口缩放 ----------
window.addEventListener("resize", function () {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.maxDPR));
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ---------- 主循环 ----------
const clock = new THREE.Clock();
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const mousePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -2.6);
const mouseTarget = new THREE.Vector3();
let parX = 0;
let parY = 0;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  dn.update(dt);
  bg.update(dt, dn.night);

  // 鼠标：世界坐标映射（粒子排斥）+ 轻微视差
  if (interaction.pointer.active) {
    const w = innerWidth;
    const h = innerHeight;
    const nx = (interaction.pointer.x / w) * 2 - 1;
    const ny = -(interaction.pointer.y / h) * 2 + 1;
    ndc.set(nx, ny);
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(mousePlane, mouseTarget)) {
      const dist = mouseTarget.length();
      tree.setMouseWorld(mouseTarget, clamp01(1 - dist / 5.5) * 0.9);
    }
    parX = lerp(parX, nx * CONFIG.camera.parallax, 0.05);
    parY = lerp(parY, -ny * CONFIG.camera.parallax * 0.4, 0.05);
  } else {
    parX *= 0.96;
    parY *= 0.96;
    tree.setMouseWorld(new THREE.Vector3(99, 99, 99), 0);
  }
  camera.position.x = camBase.x + parX;
  camera.position.y = camBase.y + parY * 0.3;
  camera.lookAt(camLook);

  interaction.update(dt);
  ui.update(dt);
  tree.update(dt);
  stars.mat.uniforms.uTime.value = t;
  ground.mat.uniforms.uTime.value = t;

  for (let i = 0; i < clouds.length; i++) {
    const c = clouds[i];
    c.obj.position.x += c.speed * dt;
    if (c.obj.position.x > 10) c.obj.position.x = -10;
  }

  renderer.render(scene, camera);
}

// ---------- 调试/测试 API ----------
window.__newsTree = {
  leafCount: tree.leafNodes.length,
  categoryCount: data.categories.length,
  newsCount: data.categories.reduce(function (n, c) {
    return n + c.twigs.reduce(function (m, tw) { return m + tw.leaves.length; }, 0);
  }, 0),
  particleCount: tree.particleCount,
  projectLeaf: function (id) { return tree.projectLeaf(id, camera, innerWidth, innerHeight); },
  pickAt: function (x, y) { return interaction.pickAt(x, y); },
  setMode: function (m) { interaction.setMode(m); ui.syncMode(); },
  getMode: function () { return interaction.mode; },
  toggleDayNight: function () { dn.toggle(); },
  getNight: function () { return dn.night; },
  setBg: function (mode, opt) { applyBg(Object.assign({ mode: mode }, opt || {})); },
  getBgMode: function () { return bg.mode; },
  openDetail: function (id) { ui.openDetail(id); },
  closeDetail: function () { ui.closeDetail(); },
  cardState: function () { return { visible: ui.cardVisible, leaf: ui.currentLeaf }; },
  hoverState: function () { return { current: interaction.current, pinned: interaction.pinned }; },
  getSceneState: function () {
    return {
      groundVisible: ground.mesh.visible,
      starsVisible: stars.obj.visible,
      moonOpacity: moon.material.opacity,
      sunOpacity: sun.material.opacity,
      night: dn.night,
      bgMode: bg.mode,
      skyMode: bg.mode === "scene" ? "gradient" : "custom"
    };
  }
};

tick();
