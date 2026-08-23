// 粒子树模块：骨架生成、粒子系统、悬停光效、节点拾取
import * as THREE from "/vendor/three/three.module.js";
import { CONFIG } from "./config.js";
import { makeGlowTexture } from "./textures.js";

const TAU = Math.PI * 2;
const rnd = Math.random;

function randSphere() {
  const u = rnd() * 2 - 1;
  const phi = rnd() * TAU;
  const s = Math.sqrt(1 - u * u);
  return { x: s * Math.cos(phi), y: u, z: s * Math.sin(phi) };
}

const VERTEX = `
uniform float uTime;
uniform float uNight;
uniform float uHoverLeaf;
uniform vec3 uHoverColor;
uniform vec3 uMouse;
uniform float uMouseStrength;
attribute vec3 aBase;
attribute vec3 aNightColor;
attribute vec3 aDayColor;
attribute vec3 aCenter;
attribute float aSize;
attribute float aAmp;
attribute float aAlpha;
attribute float aPhase;
attribute float aLeafId;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float t = uTime;
  vec3 pos = aBase;
  pos.x += sin(t * 0.55 + aPhase) * aAmp;
  pos.y += cos(t * 0.5 + aPhase * 1.7) * aAmp;
  pos.z += sin(t * 0.6 + aPhase * 2.3) * aAmp;
  float glow = abs(aLeafId - uHoverLeaf) < 0.5 ? 1.0 : 0.0;
  if (glow > 0.5) {
    vec3 dir = pos - aCenter;
    float dl = length(dir) + 0.0001;
    pos += (dir / dl) * glow * 0.045;
  }
  vec3 md = pos - uMouse;
  float mr = length(md) + 0.0001;
  float push = exp(-mr * mr * 1.15) * uMouseStrength;
  pos += (md / mr) * push * 0.55;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * (1.0 + glow * 1.1) * (260.0 / max(0.1, -mv.z));
  vec3 baseColor = mix(aDayColor, aNightColor, uNight);
  vColor = mix(baseColor, uHoverColor, glow * 0.85);
  vAlpha = aAlpha * mix(0.45, 1.0, glow * 0.65);
}
`;

const FRAGMENT = `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  float a = smoothstep(0.5, 0.06, d) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor, a);
}
`;

export class NewsTree {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.pickGroup = new THREE.Group();
    this.group.add(this.pickGroup);

    this.leafNodes = [];
    this.leafIndex = new Map();
    this.hoverIndex = -1;

    this.time = 0;
    this.night = 1;
    this.hoverColor = new THREE.Color("#7de8ff");
    this.hoverColorTarget = new THREE.Color("#7de8ff");
    this.mouse = new THREE.Vector3(99, 99, 99);
    this.mouseStrength = 0;
    this.lineColor = new THREE.Color("#ffffff");

    this.glow = null;
  }

  // ---------- 骨架 ----------
  buildSkeleton(categories) {
    const cfg = CONFIG.tree;
    const wood = [];
    const trunkPts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.05, 1.0, 0.02),
      new THREE.Vector3(-0.04, 2.0, -0.03),
      new THREE.Vector3(0.08, 3.0, 0.04),
      new THREE.Vector3(0.14, cfg.trunk.height, -0.1)
    ];
    const trunkCurve = new THREE.CatmullRomCurve3(trunkPts);
    wood.push({
      curve: trunkCurve,
      radiusAt: function (t) { return (1 - t) * cfg.trunk.baseRadius + t * cfg.trunk.topRadius; },
      density: cfg.trunk.density,
      color: "#6b4a33"
    });

    const n = categories.length;
    for (let ci = 0; ci < n; ci++) {
      const cat = categories[ci];
      const tA = 0.3 + (ci / Math.max(n - 1, 1)) * 0.62;
      const attach = trunkCurve.getPoint(tA);
      const az = (ci / n) * TAU + 0.35;
      const el = 0.42 + (ci % 4) * 0.055;
      const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
      const L = cfg.branch.lengthBase + (cat.twigs.length - 2) * cfg.branch.lengthPerTwig + (ci % 3) * 0.1;
      const tip = attach.clone().add(dir.clone().multiplyScalar(L));
      const mid = attach.clone().add(dir.clone().multiplyScalar(L * 0.55)).add(new THREE.Vector3(0, 0.28, 0));
      const curve = new THREE.CatmullRomCurve3([attach, mid, tip]);
      wood.push({
        curve: curve,
        radiusAt: function (t) { return 0.1 * (1 - t) + 0.028 * t; },
        density: cfg.branch.density,
        color: cat.color
      });

      // 细枝
      const twigCount = Math.min(cat.twigs.length, 3);
      for (let ti = 0; ti < twigCount; ti++) {
        const tt = Math.min(0.35 + ti * 0.3, 0.98);
        const p = curve.getPoint(tt);
        const tan = curve.getTangent(tt);
        const up = new THREE.Vector3(0, 1, 0);
        const perp = new THREE.Vector3().crossVectors(tan, up).normalize();
        const side = ti % 2 === 0 ? 1 : -1;
        perp.multiplyScalar(side);
        const twigDir = new THREE.Vector3()
          .addScaledVector(tan, 0.5)
          .addScaledVector(perp, 0.55)
          .addScaledVector(up, 0.28)
          .normalize();
        const len = cfg.twig.lengthBase * (0.85 + rnd() * 0.3);
        const tip2 = p.clone().addScaledVector(twigDir, len);
        const mid2 = p.clone().addScaledVector(twigDir, len * 0.55).add(new THREE.Vector3(0, 0.1, 0));
        const tCurve = new THREE.CatmullRomCurve3([p, mid2, tip2]);
        wood.push({
          curve: tCurve,
          radiusAt: function () { return 0.035; },
          density: cfg.twig.density,
          color: cat.color
        });
      }
    }
    return { wood: wood, trunk: trunkCurve };
  }

  // ---------- 粒子生成 ----------
  build(categories) {
    const cfg = CONFIG.tree;
    const skel = this.buildSkeleton(categories);
    const skelSegs = skel.wood;

    const positions = [], nightCols = [], dayCols = [], centers = [];
    const sizes = [], amps = [], alphas = [], phases = [], leafIds = [];

    const woodNight = new THREE.Color("#1d3a32");
    const woodDay = new THREE.Color("#8a5a33");

    for (let si = 0; si < skelSegs.length; si++) {
      const seg = skelSegs[si];
      const len = seg.curve.getLength();
      const count = Math.max(3, Math.floor(len * seg.density));
      const tint = new THREE.Color(seg.color);
      for (let i = 0; i < count; i++) {
        const t = (i + rnd() * 0.7) / count;
        const p = seg.curve.getPoint(t);
        const rad = seg.radiusAt(t) * (0.35 + rnd() * 0.7);
        const j = randSphere();
        const v = (0.85 + rnd() * 0.3);
        positions.push(p.x + j.x * rad, p.y + j.y * rad, p.z + j.z * rad);
        nightCols.push(woodNight.r * v, woodNight.g * v, woodNight.b * v);
        dayCols.push(woodDay.r * v, woodDay.g * v, woodDay.b * v);
        centers.push(0, 0, 0);
        sizes.push(1.3 + rnd() * 0.9);
        amps.push(0.02 + rnd() * 0.03);
        alphas.push(0.45 + rnd() * 0.35);
        phases.push(rnd() * TAU);
        leafIds.push(-2);
      }
    }

    // 枝叶簇粒子（每个新闻一片枝叶）；wood 数组顺序 = trunk(0) + 逐分类(主枝1 + 细枝n)
    this.leafNodes = [];
    this.leafIndex.clear();
    const lf = cfg.leaf;
    let skelCursor = 1; // 0 = trunk
    for (let ci = 0; ci < categories.length; ci++) {
      const cat = categories[ci];
      const branchSeg = skelSegs[skelCursor];
      skelCursor += 1;
      const twigCount = Math.min(cat.twigs.length, 3);
      const twigSegs = [];
      for (let ti = 0; ti < twigCount; ti++) {
        twigSegs.push(skelSegs[skelCursor]);
        skelCursor += 1;
      }
      const catColor = new THREE.Color(cat.color);
      for (let ti = 0; ti < twigSegs.length; ti++) {
        const twig = cat.twigs[ti];
        const curve = twigSegs[ti].curve;
        const leaves = twig.leaves || [];
        for (let li = 0; li < leaves.length; li++) {
          const news = leaves[li];
          const tt = Math.min(0.45 + li * 0.17, 0.99);
          const p = curve.getPoint(tt);
          const jj = randSphere();
          const pos = new THREE.Vector3(
            p.x + jj.x * 0.07,
            p.y + jj.y * 0.07 + 0.03,
            p.z + jj.z * 0.07
          );
          const imp = Math.max(0.15, Math.min(1, news.importance || 0.5));
          const rc = lf.baseRadius + imp * lf.impRadius;
          const count = lf.baseCount + Math.round(imp * lf.impCount);
          const s = lf.baseSize + imp * lf.impSize;
          const amp = lf.baseAmp + imp * lf.impAmp;
          const alpha = Math.min(1, lf.baseAlpha + imp * lf.impAlpha);
          const leafIdx = this.leafNodes.length;
          this.leafNodes.push({ leafId: news.leaf, pos: pos, importance: imp, news: news });
          this.leafIndex.set(news.leaf, leafIdx);

          const nightC = catColor.clone().multiplyScalar(0.5 + imp * 0.35);
          const dayC = catColor.clone().multiplyScalar(1.1 + imp * 0.5);
          dayC.lerp(new THREE.Color(1, 1, 1), 0.22);

          for (let pi = 0; pi < count; pi++) {
            const sp = randSphere();
            const rr = rc * Math.sqrt(rnd());
            const px = pos.x + sp.x * rr;
            const py = pos.y + sp.y * rr + (rnd() - 0.5) * rc * 0.4;
            const pz = pos.z + sp.z * rr;
            const v = 0.8 + rnd() * 0.4;
            positions.push(px, py, pz);
            nightCols.push(nightC.r * v, nightC.g * v, nightC.b * v);
            dayCols.push(dayC.r * v, dayC.g * v, dayC.b * v);
            centers.push(pos.x, pos.y, pos.z);
            sizes.push(s * (0.75 + rnd() * 0.5));
            amps.push(amp * (0.7 + rnd() * 0.6));
            alphas.push(alpha * (0.8 + rnd() * 0.35));
            phases.push(rnd() * TAU);
            leafIds.push(leafIdx);
          }

          // 拾取球
          const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(1, 8, 6),
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 })
          );
          sphere.visible = false;
          sphere.scale.setScalar(CONFIG.interaction.pickBase + imp * CONFIG.interaction.pickImp);
          sphere.position.copy(pos);
          sphere.userData.leafId = news.leaf;
          this.pickGroup.add(sphere);
        }
      }
    }

    // 几何体
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute("aBase", new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute("aNightColor", new THREE.Float32BufferAttribute(nightCols, 3));
    geom.setAttribute("aDayColor", new THREE.Float32BufferAttribute(dayCols, 3));
    geom.setAttribute("aCenter", new THREE.Float32BufferAttribute(centers, 3));
    geom.setAttribute("aSize", new THREE.Float32BufferAttribute(sizes, 1));
    geom.setAttribute("aAmp", new THREE.Float32BufferAttribute(amps, 1));
    geom.setAttribute("aAlpha", new THREE.Float32BufferAttribute(alphas, 1));
    geom.setAttribute("aPhase", new THREE.Float32BufferAttribute(phases, 1));
    geom.setAttribute("aLeafId", new THREE.Float32BufferAttribute(leafIds, 1));

    const uniforms = {
      uTime: { value: 0 },
      uNight: { value: this.night },
      uHoverLeaf: { value: -1 },
      uHoverColor: { value: this.hoverColor },
      uMouse: { value: this.mouse },
      uMouseStrength: { value: 0 }
    };
    this.uniforms = uniforms;

    const mat = new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const points = new THREE.Points(geom, mat);
    points.frustumCulled = false;
    this.points = points;
    this.group.add(points);

    // 骨架连线（柔和连接感）
    const lineVerts = [];
    const lineCols = [];
    for (let si = 0; si < skelSegs.length; si++) {
      const seg = skelSegs[si];
      const tint = new THREE.Color(seg.color);
      const steps = 16;
      for (let i = 0; i < steps; i++) {
        const a = seg.curve.getPoint(i / steps);
        const b = seg.curve.getPoint((i + 1) / steps);
        lineVerts.push(a.x, a.y, a.z, b.x, b.y, b.z);
        lineCols.push(tint.r, tint.g, tint.b, tint.r, tint.g, tint.b);
      }
    }
    const lGeom = new THREE.BufferGeometry();
    lGeom.setAttribute("position", new THREE.Float32BufferAttribute(lineVerts, 3));
    lGeom.setAttribute("color", new THREE.Float32BufferAttribute(lineCols, 3));
    const lMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.lineColor = new THREE.Color(1, 1, 1);
    this.lines = new THREE.LineSegments(lGeom, lMat);
    this.group.add(this.lines);

    // 悬停光晕
    const glowMat = new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      color: 0x7de8ff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0
    });
    this.glow = new THREE.Sprite(glowMat);
    this.glow.scale.setScalar(1.4);
    this.group.add(this.glow);

    this.particleCount = positions.length / 3;
    return this;
  }

  setHoverLeaf(leafId) {
    if (leafId == null) {
      this.hoverIndex = -1;
      return;
    }
    const idx = this.leafIndex.has(leafId) ? this.leafIndex.get(leafId) : -1;
    this.hoverIndex = idx;
    if (idx >= 0) {
      const node = this.leafNodes[idx];
      const c = new THREE.Color(node.news.color || "#7de8ff");
      c.lerp(new THREE.Color(1, 1, 1), 0.35);
      this.hoverColorTarget.copy(c);
    }
  }

  setNight(n) { this.night = n; }

  setMouseWorld(v, strength) {
    this.mouse.copy(v);
    this.mouseStrength = strength;
  }

  update(dt) {
    this.time += dt;
    if (this.uniforms) {
      this.uniforms.uTime.value = this.time;
      this.uniforms.uNight.value = this.night;
      this.uniforms.uHoverLeaf.value = this.hoverIndex;
      this.uniforms.uMouse.value = this.mouse;
      this.uniforms.uMouseStrength.value = this.mouseStrength;
      this.hoverColor.lerp(this.hoverColorTarget, 0.12);
    }
    // 光晕跟随悬停枝叶
    if (this.glow) {
      const g = this.glow;
      if (this.hoverIndex >= 0) {
        const node = this.leafNodes[this.hoverIndex];
        g.position.lerp(node.pos, 0.14);
        const pulse = 0.8 + 0.2 * Math.sin(this.time * 2.2);
        const scale = (1.2 + node.importance * 0.6) * pulse;
        g.scale.setScalar(scale);
        g.material.opacity += (0.5 * pulse - g.material.opacity) * 0.15;
        g.material.color.copy(this.hoverColor);
      } else {
        g.material.opacity *= 0.88;
        if (g.material.opacity < 0.01) g.material.opacity = 0;
      }
    }
    // 线条随昼夜微调
    if (this.lines) {
      const target = new THREE.Color(1, 1, 1).lerp(new THREE.Color("#3d6b5c"), this.night);
      this.lineColor.lerp(target, 0.08);
      this.lines.material.color.copy(this.lineColor);
    }
  }

  getLeafNode(leafId) {
    const idx = this.leafIndex.has(leafId) ? this.leafIndex.get(leafId) : -1;
    return idx >= 0 ? this.leafNodes[idx] : null;
  }

  // 枝叶 3D 位置 → 屏幕坐标
  projectLeaf(leafId, camera, w, h) {
    const node = this.getLeafNode(leafId);
    if (!node) return null;
    const v = node.pos.clone().project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * w,
      y: (-v.y * 0.5 + 0.5) * h,
      z: v.z
    };
  }
}
