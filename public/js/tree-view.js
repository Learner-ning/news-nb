// 新闻树视图：确定性布局（tree-layout.js）+ SVG 渲染 + 交互 + LOD
//
// 视觉层级（一棵真正的树，不是粒子网 / 星点网络）：
//   树根(底部) → 树干(纵向、底粗顶细) → 主枝(分类·角度扇区)
//   → 分枝(来源·扇区内的连续角带) → 新闻叶片(真实新闻卡片，按行挂在分枝上)
//
// 几何全部由 tree-layout.js 的纯函数给出（无随机、同数据同输出）。
// 平移/缩放只改 #world 的 transform；只有数据或分类变化才重新布局。
import { layoutTree, computeFit, truncateByWidth, lodLevel, LAYOUT_DEFAULTS } from "./tree-layout.js";
import { textWidth } from "./helpers.js";

const NS = "http://www.w3.org/2000/svg";

function svgEl(name, attrs = {}) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "text") n.textContent = v;
    else if (k === "cls") n.setAttribute("class", v);
    else n.setAttribute(k, v);
  }
  return n;
}

/** 主枝 / 分枝曲线：中点向树冠外侧微弯，读起来像自然分叉 */
function branchPath(p0, p1) {
  const dx = p1.x - p0.x;
  const bow = Math.min(70, Math.abs(dx) * 0.32) * (dx >= 0 ? 1 : -1);
  const mx = (p0.x + p1.x) / 2 + bow;
  const my = (p0.y + p1.y) / 2;
  return `M ${p0.x} ${p0.y} Q ${mx} ${my} ${p1.x} ${p1.y}`;
}

export class TreeView {
  constructor(svg) {
    this.svg = svg;
    this.world = svg.querySelector("#world");
    this.view = { tx: 0, ty: 0, s: 1 };
    this.leafElm = new Map();
    this.srcElm = new Map();     // 一级新闻源节点（source-mode）
    this.showSourceLayer = true;
    this._srcHover = null;
    this.hover = null;
    this.drag = null;
    this._downLeaf = null;
    this._downSource = null;
    this._suppressClick = false;
    this.pointers = new Map();
    this._pinch = 0;
    this.minScale = 0.06;
    this.maxScale = 6;
    this.onHover = null;
    this.onLeave = null;
    this.onOpen = null;
    this.onOpenSource = null;    // 点击新闻源节点 → 进入独立新闻树
    this._attached = false;
    this._lod = -1;
    this.geom = null;
    this._bbox = { minX: -1, maxX: 1, minY: -1, maxY: 0 };
  }

  // ================= 渲染 =================
  /**
   * @param {Array} entries 树模型（一级 = 主枝，二级 = 分枝）
   * @param {Object} opts
   *   showSourceLayer: true  → 两级渲染（分类 → 来源 → 叶片），用于来源页
   *                     false → 一级节点本身就是新闻源（首页新闻源树），
   *                             渲染时省略中间层，主枝直接连到叶片簇
   */
  build(entries, opts = {}) {
    const showSourceLayer = opts.showSourceLayer !== false;
    this.showSourceLayer = showSourceLayer;
    this.world.innerHTML = "";
    this.leafElm.clear();
    this.srcElm.clear();
    this.svg.classList.toggle("no-tree", !entries || !entries.length);
    this.svg.classList.toggle("source-mode", !showSourceLayer);
    if (!entries || !entries.length) {
      this.geom = null;
      return;
    }

    const g = layoutTree(entries, LAYOUT_DEFAULTS);
    this.geom = g;
    this._bbox = g.bbox;

    const passTrunk = svgEl("g", { cls: "trunk-group" });
    const passMain = svgEl("g", { cls: "mains" });
    const passSub = svgEl("g", { cls: "subs" });
    const passLeaves = svgEl("g", { cls: "leaves" });
    const passLabels = svgEl("g", { cls: "labels" });

    // —— 树根 + 树干（底粗顶细，纵向）——
    const t = g.trunk;
    const bw = t.baseW / 2, tw = t.topW / 2, h = t.h;
    passTrunk.appendChild(svgEl("ellipse", { cx: 0, cy: 6, rx: bw * 2.1, ry: 12, cls: "ground-shadow" }));
    passTrunk.appendChild(svgEl("path", {
      d: [
        `M ${-bw} 0`,
        `C ${-bw * 0.62} ${-h * 0.34}, ${-tw - 6} ${-h * 0.72}, ${-tw} ${-h}`,
        `L ${tw} ${-h}`,
        `C ${tw + 6} ${-h * 0.72}, ${bw * 0.62} ${-h * 0.34}, ${bw} 0`,
        "Z"
      ].join(" "),
      cls: "trunk", style: "--d:0ms"
    }));
    const bark = svgEl("g", { cls: "bark" });
    for (const b of t.bark) {
      bark.appendChild(svgEl("path", {
        d: `M ${b.offset} -8 C ${b.offset * 0.7} ${-h * 0.42}, ${b.offset * 0.24} ${-h * 0.74}, ${b.offset * 0.1} ${-h + 6}`,
        cls: "bark-line grow-path", pathLength: 1, style: "--d:30ms"
      }));
    }
    passTrunk.appendChild(bark);

    // —— 主枝（树干顶端 → 一级节点）——
    const apex = g.apex;
    g.categories.forEach((c, ci) => {
      const grp = svgEl("g", { cls: "bcat", "data-cat": c.key });
      grp.appendChild(svgEl("path", {
        d: branchPath(apex, c.node), fill: "none",
        cls: "branch-main grow-path", pathLength: 1,
        style: `--c:${c.color};--d:${100 + ci * 80}ms`
      }));
      passMain.appendChild(grp);
    });

    if (showSourceLayer) {
      // —— 两级：分类节点 → 来源节点 → 叶片簇 ——
      for (let ci = 0; ci < g.categories.length; ci++) {
        const c = g.categories[ci];
        for (let si = 0; si < c.sources.length; si++) {
          const s = c.sources[si];
          const grp = svgEl("g", { cls: "bsrc", "data-cat": c.key, "data-src": si });
          grp.appendChild(svgEl("path", {
            d: branchPath(c.node, s.node), fill: "none",
            cls: "branch-sub grow-path", pathLength: 1,
            style: `--c:${c.color};--d:${260 + ci * 80 + si * 50}ms`
          }));
          passSub.appendChild(grp);
          passSub.appendChild(svgEl("path", {
            d: `M ${s.spine.x1} ${s.spine.y1} L ${s.spine.x2} ${s.spine.y2}`, fill: "none",
            cls: "spine", "data-cat": c.key, "data-src": si,
            style: `--c:${c.color};--d:${300 + ci * 80 + si * 50}ms`
          }));
        }
      }
    } else {
      // —— 一级即新闻源：主枝末端直接连到叶片簇（省掉中间层）——
      g.categories.forEach((c, ci) => {
        for (const s of c.sources) {
          passSub.appendChild(svgEl("path", {
            d: `M ${c.node.x} ${c.node.y} L ${s.spine.x2} ${s.spine.y2}`, fill: "none",
            cls: "spine spine-source", "data-cat": c.key,
            style: `--c:${c.color};--d:${240 + ci * 60}ms`
          }));
        }
      });
    }

    // —— 新闻叶片 ——
    for (const leaf of g.leaves) {
      const c = g.categories[leaf.ci];
      const heat = Number(leaf.item.heatScore) || 0.5;
      const cls = "leaf" + (heat >= 0.6 ? " hot" : heat <= 0.36 ? " cool" : "");
      const grp = svgEl("g", {
        cls, "data-leaf": leaf.id, "data-cat": c.key, "data-src": leaf.si,
        style: `--c:${c.color};--d:${380 + leaf.ci * 80 + leaf.si * 50}ms`
      });
      grp.appendChild(svgEl("rect", {
        x: leaf.x - leaf.w / 2, y: leaf.y - leaf.h / 2,
        width: leaf.w, height: leaf.h, rx: 6, cls: "leaf-pill"
      }));
      grp.appendChild(svgEl("text", {
        x: leaf.x, y: leaf.y + 4.5, "text-anchor": "middle",
        cls: "leaf-title", text: truncateByWidth(leaf.item.title, leaf.w)
      }));
      passLeaves.appendChild(grp);
      this.leafElm.set(leaf.id, { g: grp, item: leaf.item });
    }

    // —— 标签 ——
    if (showSourceLayer) {
      // 分类标签（小） + 来源节点（点 + 名称）
      g.categories.forEach((c, ci) => {
        const name = `${c.name} ${c.count}`;
        const wl = Math.min(150, name.length * 14 + 26);
        const lbl = svgEl("g", { cls: "cat-label", style: `--d:${170 + ci * 80}ms` });
        lbl.appendChild(svgEl("rect", {
          x: c.node.x - wl / 2, y: c.node.y - 13, width: wl, height: 26, rx: 13,
          cls: "cat-label-bg", style: `--c:${c.color}`
        }));
        lbl.appendChild(svgEl("text", {
          x: c.node.x, y: c.node.y + 4.5, "text-anchor": "middle", cls: "cat-label-text", text: name
        }));
        passLabels.appendChild(lbl);

        for (const s of c.sources) {
          passLabels.appendChild(svgEl("circle", {
            cx: s.node.x, cy: s.node.y, r: 4.2, cls: "src-dot",
            style: `--c:${c.color};--d:${300 + ci * 80 + s.si * 50}ms`
          }));
          if (s.name) {
            passLabels.appendChild(svgEl("text", {
              x: s.node.x + 9, y: s.node.y + 4.5, cls: "src-name",
              text: `${s.name} · ${s.count}`, style: `--d:${310 + ci * 80 + s.si * 50}ms`
            }));
          }
        }
      });
    } else {
      // 新闻源节点：更大、更高视觉权重、可点击、有 focus 状态
      g.categories.forEach((c, ci) => {
        const name = String(c.name || "");
        const wl = Math.min(240, Math.max(104, textWidth(name) + 40));
        const grp = svgEl("g", {
          cls: "src-node", "data-srcnode": c.key,
          role: "button", tabindex: "0",
          "aria-label": `${name}，${c.count} 条新闻，进入独立新闻树`,
          style: `--c:${c.color};--d:${170 + ci * 70}ms`
        });
        grp.appendChild(svgEl("rect", {
          x: c.node.x - wl / 2, y: c.node.y - 17, width: wl, height: 34, rx: 17, cls: "sn-bg"
        }));
        grp.appendChild(svgEl("text", {
          x: c.node.x, y: c.node.y + 5, "text-anchor": "middle", cls: "sn-name", text: name
        }));
        grp.appendChild(svgEl("text", {
          x: c.node.x, y: c.node.y + 32, "text-anchor": "middle", cls: "sn-count", text: `${c.count} 条`
        }));
        passLabels.appendChild(grp);
        this.srcElm.set(c.key, { g: grp, count: c.count });
      });
    }

    for (const p of [passTrunk, passMain, passSub, passLeaves, passLabels]) this.world.appendChild(p);

    this._lod = -1;
    this._animate();
    this.fit(false);
  }

  _animate() {
    this.world.classList.remove("grow-on");
    void this.world.getBoundingClientRect();
    this.world.classList.add("grow-on");
  }

  // ================= 视口 =================
  bbox() {
    return this._bbox;
  }

  setTransform(tx, ty, s, animate = false) {
    this.view.tx = tx; this.view.ty = ty; this.view.s = s;
    if (animate) this.world.classList.add("smooth");
    this.world.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    if (animate) window.setTimeout(() => this.world.classList.remove("smooth"), 400);
    this.applyLod(s);
  }

  /** 语义缩放：缩小时先隐藏叶片文字，再聚合到来源节点 */
  applyLod(s) {
    const lv = lodLevel(s);
    if (lv === this._lod) return;
    this._lod = lv;
    for (const c of ["lod-0", "lod-1", "lod-2"]) this.world.classList.toggle(c, lv === Number(c.slice(4)));
  }

  fit(animate = false) {
    const r = this.svg.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const f = computeFit(this.bbox(), r.width, r.height, LAYOUT_DEFAULTS);
    this.setTransform(f.tx, f.ty, f.s, animate);
    return f;
  }

  zoomBy(factor, px, py, animate = false) {
    const { tx, ty, s } = this.view;
    const ns = Math.min(this.maxScale, Math.max(this.minScale, s * factor));
    if (ns === s) return;
    const wx = (px - tx) / s, wy = (py - ty) / s;
    this.setTransform(px - wx * ns, py - wy * ns, ns, animate);
  }

  getLeaf(id) {
    return this.leafElm.get(id);
  }

  // ================= 交互 =================
  attach() {
    if (this._attached) return;
    this._attached = true;
    const svg = this.svg;
    const local = (e) => {
      const r = svg.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const p = local(e);
      this.zoomBy(Math.exp(-e.deltaY * 0.0016), p.x, p.y);
    }, { passive: false });

    svg.addEventListener("pointerdown", (e) => {
      // 记录按下位置对应的叶片 / 新闻源节点（pointer capture 会让 click 目标变成 svg 本身）
      this._downLeaf = e.target.closest?.("[data-leaf]")?.getAttribute("data-leaf") || null;
      this._downSource = e.target.closest?.("[data-srcnode]")?.getAttribute("data-srcnode") || null;
      this._suppressClick = false;
      try { svg.setPointerCapture(e.pointerId); } catch {}
      this.pointers.set(e.pointerId, local(e));
      if (this.pointers.size === 1) {
        this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: this.view.tx, sy: this.view.ty, moved: false };
      } else {
        this.drag = null;   // 进入双指手势后不再拖动，避免缩放结束后跳变
      }
    });

    svg.addEventListener("pointermove", (e) => {
      const p = local(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);

      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (this._pinch > 0 && dist > 0) {
          this.zoomBy(dist / this._pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
        }
        this._pinch = dist;
        return;
      }
      this._pinch = 0;

      if (this.drag && this.drag.id === e.pointerId) {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) {
          this.drag.moved = true;
          this._suppressClick = true;
        }
        if (this.drag.moved) {
          this.setTransform(this.drag.sx + dx, this.drag.sy + dy, this.view.s);
          svg.classList.add("dragging");
        }
      }
    });

    const end = (e) => {
      this.pointers.delete(e.pointerId);
      this._pinch = 0;
      if (this.drag && this.drag.id === e.pointerId) {
        this.drag = null;
        svg.classList.remove("dragging");
      }
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);

    // 悬停（委托）：叶片显示信息卡；新闻源节点只做高亮
    svg.addEventListener("pointerover", (e) => {
      const elm = e.target.closest?.("[data-leaf]");
      if (elm) { this.setHover(elm.getAttribute("data-leaf"), e); return; }
      const sn = e.target.closest?.("[data-srcnode]");
      if (sn) this.setSourceHover(sn.getAttribute("data-srcnode"));
    });
    svg.addEventListener("pointerout", (e) => {
      const from = e.target.closest?.("[data-leaf]");
      const to = e.relatedTarget?.closest?.("[data-leaf]");
      if (from && !to) this.clearHover();
      const fs = e.target.closest?.("[data-srcnode]");
      const ts = e.relatedTarget?.closest?.("[data-srcnode]");
      if (fs && !ts) this.clearSourceHover();
    });

    // 点击叶片 → 进入详情；点击新闻源节点 → 进入独立新闻树（拖拽后不触发）
    svg.addEventListener("click", () => {
      if (this._suppressClick) {
        this._suppressClick = false;
        this._downLeaf = null;
        this._downSource = null;
        return;
      }
      const id = this._downLeaf;
      const src = this._downSource;
      this._downLeaf = null;
      this._downSource = null;
      if (id) {
        const rec = this.leafElm.get(id);
        if (rec && this.onOpen) this.onOpen(rec.item);
      } else if (src && this.onOpenSource) {
        this.onOpenSource(src);
      }
    });

    // 键盘：焦点在新闻源节点上时 Enter/Space 进入；焦点在画布上时方向键平移、+/- 缩放、0 适应
    svg.addEventListener("keydown", (e) => {
      const sn = e.target.closest?.("[data-srcnode]");
      if (sn && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        if (this.onOpenSource) this.onOpenSource(sn.getAttribute("data-srcnode"));
        return;
      }
      const leaf = e.target.closest?.("[data-leaf]");
      if (leaf && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        const rec = this.leafElm.get(leaf.getAttribute("data-leaf"));
        if (rec && this.onOpen) this.onOpen(rec.item);
        return;
      }
      if (e.target !== svg) return;
      const step = e.shiftKey ? 160 : 60;
      const keys = {
        ArrowLeft: [-step, 0], ArrowRight: [step, 0],
        ArrowUp: [0, -step], ArrowDown: [0, step]
      };
      if (keys[e.key]) {
        e.preventDefault();
        const [dx, dy] = keys[e.key];
        this.setTransform(this.view.tx + dx, this.view.ty + dy, this.view.s);
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        const r = svg.getBoundingClientRect();
        this.zoomBy(1.32, r.width / 2, r.height / 2, true);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        const r = svg.getBoundingClientRect();
        this.zoomBy(1 / 1.32, r.width / 2, r.height / 2, true);
      } else if (e.key === "0") {
        e.preventDefault();
        this.fit(true);
      }
    });
  }

  /** 新闻源节点 hover 高亮 */
  setSourceHover(key) {
    if (this._srcHover === key) return;
    this.clearSourceHover();
    this._srcHover = key;
    const rec = this.srcElm.get(key);
    if (rec) rec.g.classList.add("active");
    const esc2 = (v) => CSS.escape(String(v));
    this.world.querySelectorAll(`.bcat[data-cat="${esc2(key)}"]`).forEach((n) => n.classList.add("on"));
  }

  clearSourceHover() {
    if (!this._srcHover) return;
    const rec = this.srcElm.get(this._srcHover);
    if (rec) rec.g.classList.remove("active");
    this._srcHover = null;
    this.world.querySelectorAll(".bcat.on").forEach((n) => n.classList.remove("on"));
  }

  setHover(id, e) {
    this.clearSourceHover();
    if (this.hover !== id) {
      this.clearHover();
      this.hover = id;
      const rec = this.leafElm.get(id);
      if (!rec) return;
      rec.g.classList.add("active");
      const cat = rec.g.getAttribute("data-cat");
      const src = rec.g.getAttribute("data-src");
      const esc = (v) => CSS.escape(String(v));
      const q = src == null
        ? `.bcat[data-cat="${esc(cat)}"]`
        : `.bcat[data-cat="${esc(cat)}"], .bsrc[data-cat="${esc(cat)}"][data-src="${esc(src)}"], .spine[data-cat="${esc(cat)}"][data-src="${esc(src)}"]`;
      this.world.querySelectorAll(q).forEach((n) => n.classList.add("on"));
    }
    const rec2 = this.leafElm.get(id);
    if (rec2 && this.onHover) this.onHover(rec2.item, e);
  }

  clearHover() {
    if (!this.hover) return;
    const old = this.hover;
    this.hover = null;
    const rec = this.leafElm.get(old);
    if (rec) rec.g.classList.remove("active");
    this.world.querySelectorAll(".on").forEach((n) => n.classList.remove("on"));
    if (this.onLeave) this.onLeave();
  }
}
