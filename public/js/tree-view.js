// 新闻树视图：确定性布局 + SVG 渲染 + 交互（悬停/点击/拖拽/缩放/生长动画）
//
// 视觉层级（一棵真正的树，不是粒子网 / 星点网络）：
//   树根(底部) → 树干(明显宽度+树皮) → 主枝(分类·曲线) → 分枝(来源)
//   → 枝头(排/簇) → 新闻叶片(真实新闻卡片，挂于枝头)
//
// 布局由数据驱动、结果稳定：同一批新闻生成基本相同的树，无随机散点。
// 平移/缩放只改 #world 的 transform；只有数据或分类变化才重新布局。
import { textWidth } from "./helpers.js";

const NS = "http://www.w3.org/2000/svg";

// —— 逻辑几何参数（y 向下：树向上长，故叶片在最上方）——
const PILL_H = 44;        // 叶片卡片高度（纯标题）
const ROW_TOP = 84;       // 最顶一排叶片卡片底部 y
const ROW_STEP = 96;      // 相邻两排枝头（一列叶片排）间距
const ROW_GAP = 12;       // 同一排相邻叶片间隙
const CLUSTER_GAP = 62;   // 分类内不同来源(分枝)间距
const CAT_GAP = 150;      // 主枝(分类)间距
const X_MARGIN = 120;

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

/** 竖向往上并带自然侧弯的曲线：模拟枝干生长（同一父点分叉时弯向各自方向） */
function branchCurve(x0, y0, x1, y1) {
  const dy = y1 - y0;
  const dir = x1 >= x0 ? 1 : -1;
  const bow = Math.min(56, Math.abs(x1 - x0) * 0.16 + 26) * dir;
  return `M ${x0} ${y0} C ${x0 + bow} ${y0 + dy * 0.42}, ${x1 + bow} ${y1 - dy * 0.74}, ${x1} ${y1}`;
}

/** 叶柄曲线：从来源分枝轻微弧形上挑到叶片底部 */
function stemCurve(x0, y0, x1, y1) {
  const midY = (y0 + y1) / 2;
  const bow = (x1 - x0) * 0.22;
  return `M ${x0} ${y0} C ${x0 + bow} ${y0 - (y0 - y1) * 0.15}, ${x1 - bow} ${midY + (y0 - y1) * 0.2}, ${x1} ${y1}`;
}

/** 估算宽度截断标题（CJK 为主） */
function truncateByWidth(s, w, fontSize) {
  const avail = w - 24;
  if (avail <= 4) return "…";
  const sc = fontSize / 13;
  let out = "";
  for (const ch of String(s ?? "")) {
    if (textWidth(out + ch) * sc > avail) return (out || "…") + "…";
    out += ch;
  }
  return out;
}

export class TreeView {
  constructor(svg) {
    this.svg = svg;
    this.world = svg.querySelector("#world");
    this.view = { tx: 0, ty: 0, s: 1 };
    this.leafElm = new Map();
    this.hover = null;
    this.drag = null;
    this._downLeaf = null;
    this._suppressClick = false;
    this.pointers = new Map();
    this._pinch = 0;
    this.minScale = 0.08;
    this.maxScale = 6;
    this.onHover = null;
    this.onLeave = null;
    this.onOpen = null;
    this._attached = false;
    this._leafW = new Map();
    this._bbox = { minX: 0, maxX: 200, minY: 0, maxY: 200 };
  }

  leafW(item) {
    if (!this._leafW.has(item.id)) {
      const len = String(item.title || "").length;
      let w = Math.max(96, Math.min(190, 88 + len * 2.8));
      // 热度影响叶片宽度（视觉权重）
      const heat = Number(item.heatScore);
      if (Number.isFinite(heat) && heat > 0) w = w * (0.86 + heat * 0.55);
      this._leafW.set(item.id, Math.max(94, Math.min(232, Math.round(w))));
    }
    return this._leafW.get(item.id);
  }

  // ================= 确定性布局 =================
  layout(cats) {
    let cursorX = X_MARGIN;
    let catMaxY = 0;
    const placed = [];

    for (const cat of cats) {
      const catLeft = cursorX;
      let x = catLeft;
      const sources = [];
      let srcMaxY = 0;

      for (const src of cat.sources) {
        // 1) 分排：每排横宽不超过上限 → 排=从来源长出的一支细枝。
        //    只看单个分类时用更宽的排（字更大更好读）；全树时用窄排控制整树宽度。
        const rowCap = cats.length <= 1 ? 1020 : 560;
        const rows = [];
        let row = [], rowW = 0;
        for (const item of src.items) {
          const w = this.leafW(item);
          if (row.length && rowW + ROW_GAP + w > rowCap) {
            rows.push(row);
            row = []; rowW = 0;
          }
          row.push(item);
          rowW += w + (row.length > 1 ? ROW_GAP : 0);
        }
        if (row.length) rows.push(row);

        const widths = rows.map((r) => r.reduce((s, it) => s + this.leafW(it), 0) + Math.max(0, r.length - 1) * ROW_GAP);
        const clusterW = Math.max(0, ...widths);
        const cx = x + clusterW / 2;   // 这一丛枝叶的中心 = 来源分枝终点

        const leaves = [];
        for (let ri = 0; ri < rows.length; ri++) {
          const topY = ROW_TOP + ri * ROW_STEP;
          let lx = cx - widths[ri] / 2;
          for (const item of rows[ri]) {
            const w = this.leafW(item);
            leaves.push({ id: item.id, item, w, x: lx + w / 2, topY });
            lx += w + ROW_GAP;
          }
        }
        const srcY = ROW_TOP + (rows.length - 1) * ROW_STEP + PILL_H + 44;
        sources.push({ name: src.name, items: src.items.length, x: cx, y: srcY, leaves });
        srcMaxY = Math.max(srcMaxY, srcY);
        x += clusterW + CLUSTER_GAP;
      }

      const catX = sources.reduce((s, so) => s + so.x, 0) / Math.max(1, sources.length);
      const catY = srcMaxY + 104;
      placed.push({
        key: cat.key, name: cat.name, color: cat.color, count: cat.count,
        x: catX, y: catY, sources
      });
      catMaxY = Math.max(catMaxY, catY);
      cursorX = catLeft + (x - CLUSTER_GAP - catLeft) + CAT_GAP;
    }

    const crownY = catMaxY + 128;
    const baseY = crownY + 216;
    const total = placed.reduce((s, c) => s + (c.count || 0), 0);
    const crownX = total
      ? placed.reduce((s, c) => s + c.x * c.count, 0) / total
      : X_MARGIN;

    let minX = Infinity, maxX = -Infinity;
    for (const c of placed) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      for (const s of c.sources) {
        minX = Math.min(minX, s.x);
        maxX = Math.max(maxX, s.x);
        for (const l of s.leaves) {
          minX = Math.min(minX, l.x - l.w / 2);
          maxX = Math.max(maxX, l.x + l.w / 2);
        }
      }
    }
    minX = Math.min(minX, crownX);
    maxX = Math.max(maxX, crownX);

    return {
      cats: placed, crownX, crownY, baseY,
      minX: Math.max(0, minX - 74), maxX: maxX + 74,
      minY: 0, maxY: baseY + 50
    };
  }

  // ================= 渲染（按 z 顺序分批） =================
  build(cats) {
    this.world.innerHTML = "";
    this.leafElm.clear();
    this.svg.classList.toggle("no-tree", !cats || !cats.length);
    if (!cats || !cats.length) return;

    const L = this.layout(cats);
    this._bbox = L;
    const { cats: cs, crownX, crownY, baseY } = L;

    const passRoot = svgEl("g", { cls: "roots" });        // 树根地面 + 树干
    const passMain = svgEl("g", { cls: "mains" });        // 主枝
    const passSub = svgEl("g", { cls: "subs" });          // 分枝
    const passStems = svgEl("g", { cls: "stems" });       // 叶柄
    const passLeaves = svgEl("g", { cls: "leaves" });     // 新闻叶片
    const passLabels = svgEl("g", { cls: "labels" });     // 分类/来源标签

    // —— 根部阴影 + 树干 ——
    passRoot.appendChild(svgEl("ellipse", { cx: crownX, cy: baseY + 18, rx: 66, ry: 16, cls: "ground-shadow" }));
    const hb = 30, th = 5;
    const trunkD = [
      `M ${crownX - hb} ${baseY}`,
      `C ${crownX - hb * 0.6} ${baseY - (baseY - crownY) * 0.32}, ${crownX - th - 13} ${crownY + (baseY - crownY) * 0.13}, ${crownX - th} ${crownY}`,
      `L ${crownX + th} ${crownY}`,
      `C ${crownX + th + 13} ${crownY + (baseY - crownY) * 0.13}, ${crownX + hb * 0.6} ${baseY - (baseY - crownY) * 0.32}, ${crownX + hb} ${baseY}`,
      "Z"
    ].join(" ");
    passRoot.appendChild(svgEl("path", { d: trunkD, cls: "trunk", style: "--d:0ms" }));
    const bark = svgEl("g", { cls: "bark" });
    for (const off of [-12, -5, 5, 12]) {
      bark.appendChild(svgEl("path", {
        d: `M ${crownX + off} ${baseY - 10} C ${crownX + off * 0.62} ${baseY - (baseY - crownY) * 0.42}, ${crownX + off * 0.18} ${crownY + (baseY - crownY) * 0.18}, ${crownX + off * 0.08} ${crownY + 6}`,
        cls: "bark-line grow-path", pathLength: 1, style: "--d:30ms"
      }));
    }
    passRoot.appendChild(bark);

    // —— 主枝(分类) / 分枝(来源) ——
    for (let ci = 0; ci < cs.length; ci++) {
      const c = cs[ci];
      const catG = svgEl("g", { cls: "bcat", "data-cat": c.key });
      catG.appendChild(svgEl("path", {
        d: branchCurve(crownX, crownY, c.x, c.y), fill: "none",
        cls: "branch-main grow-path", pathLength: 1,
        style: `--c:${c.color};--d:${100 + ci * 80}ms`
      }));
      passMain.appendChild(catG);

      for (let si = 0; si < c.sources.length; si++) {
        const s = c.sources[si];
        const srcG = svgEl("g", { cls: "bsrc", "data-cat": c.key, "data-src": si });
        srcG.appendChild(svgEl("path", {
          d: branchCurve(c.x, c.y, s.x, s.y), fill: "none",
          cls: "branch-sub grow-path", pathLength: 1,
          style: `--c:${c.color};--d:${280 + ci * 80 + si * 56}ms`
        }));
        passSub.appendChild(srcG);
      }
    }

    // —— 叶柄（先画，藏在叶片下面） ——
    for (let ci = 0; ci < cs.length; ci++) {
      const c = cs[ci];
      for (let si = 0; si < c.sources.length; si++) {
        const s = c.sources[si];
        for (const leaf of s.leaves) {
          passStems.appendChild(svgEl("path", {
            d: stemCurve(s.x, s.y, leaf.x, leaf.topY), fill: "none",
            cls: "stem grow-path", pathLength: 1,
            "data-cat": c.key, "data-src": si,
            style: `--c:${c.color};--d:${380 + ci * 80 + si * 56}ms`
          }));
        }
      }
    }

    // —— 新闻叶片 ——
    for (let ci = 0; ci < cs.length; ci++) {
      const c = cs[ci];
      for (let si = 0; si < c.sources.length; si++) {
        const s = c.sources[si];
        for (const leaf of s.leaves) {
          const heat = Number(leaf.item.heatScore) || 0.5;
          const cls = "leaf" + (heat >= 0.6 ? " hot" : heat <= 0.36 ? " cool" : "");
          const g = svgEl("g", {
            cls, "data-leaf": leaf.id, "data-cat": c.key, "data-src": si,
            style: `--c:${c.color};--d:${430 + ci * 80 + si * 56}ms`
          });
          g.appendChild(svgEl("rect", {
            x: leaf.x - leaf.w / 2, y: leaf.topY - PILL_H, width: leaf.w, height: PILL_H, rx: 10, cls: "leaf-pill"
          }));
          // 纯标题叶片：只显示新闻标题
          g.appendChild(svgEl("text", {
            x: leaf.x, y: leaf.topY - Math.round(PILL_H / 2) + 4.5, "text-anchor": "middle",
            cls: "leaf-title", text: truncateByWidth(leaf.item.title, leaf.w, 13)
          }));
          passLeaves.appendChild(g);
          this.leafElm.set(leaf.id, { g, item: leaf.item });
        }
      }
    }

    // —— 分类标签 + 来源名（置于最上层，不被枝条压住） ——
    for (let ci = 0; ci < cs.length; ci++) {
      const c = cs[ci];
      const name = `${c.name} ${c.count ?? ""}`.trim();
      const wl = textWidth(name) * (15 / 13) + 30;
      const lbl = svgEl("g", { cls: "cat-label", style: `--d:${170 + ci * 80}ms` });
      lbl.appendChild(svgEl("rect", {
        x: c.x - wl / 2, y: c.y - 48, width: wl, height: 28, rx: 14,
        cls: "cat-label-bg", style: `--c:${c.color}`
      }));
      lbl.appendChild(svgEl("text", {
        x: c.x, y: c.y - 28.5, "text-anchor": "middle", cls: "cat-label-text", text: name
      }));
      passLabels.appendChild(lbl);

      for (let si = 0; si < c.sources.length; si++) {
        const s = c.sources[si];
        passLabels.appendChild(svgEl("circle", {
          cx: s.x, cy: s.y, r: 4.2, cls: "src-dot", style: `--c:${c.color};--d:${320 + ci * 80 + si * 56}ms`
        }));
        passLabels.appendChild(svgEl("text", {
          x: s.x + 10, y: s.y + 4.5, cls: "src-name",
          text: `${s.name} · ${s.items}`, style: `--d:${330 + ci * 80 + si * 56}ms`
        }));
      }
    }

    for (const p of [passRoot, passMain, passSub, passStems, passLeaves, passLabels]) this.world.appendChild(p);

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
  }

  fit(animate = false) {
    const r = this.svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const b = this.bbox();
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxY - b.minY);
    const padT = 30, padB = 40;
    const s = Math.min((r.width - 44) / bw, (r.height - padT - padB) / bh, 1.7);
    // 水平居中；垂直方向让树“立”在舞台偏下（树根贴近底部，而不是悬在正中）
    this.setTransform(
      r.width / 2 - (b.minX + b.maxX) / 2 * s,
      (r.height - padB) - b.maxY * s,
      s, animate
    );
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
      // 记录按下位置对应的叶片（pointer capture 会让 click 目标变成 svg 本身）
      this._downLeaf = e.target.closest?.("[data-leaf]")?.getAttribute("data-leaf") || null;
      this._suppressClick = false;
      try { svg.setPointerCapture(e.pointerId); } catch {}
      this.pointers.set(e.pointerId, local(e));
      if (this.pointers.size === 1) {
        this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: this.view.tx, sy: this.view.ty, moved: false };
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

    // 悬停（委托）
    svg.addEventListener("pointerover", (e) => {
      const elm = e.target.closest?.("[data-leaf]");
      if (elm) this.setHover(elm.getAttribute("data-leaf"), e);
    });
    svg.addEventListener("pointerout", (e) => {
      const from = e.target.closest?.("[data-leaf]");
      const to = e.relatedTarget?.closest?.("[data-leaf]");
      if (from && !to) this.clearHover();
    });

    // 点击叶片 → 进入详情（沿用现有跳转逻辑；拖拽后不触发）
    svg.addEventListener("click", () => {
      if (this._suppressClick) {
        this._suppressClick = false;
        return;
      }
      const id = this._downLeaf;
      this._downLeaf = null;
      if (id) {
        const rec = this.leafElm.get(id);
        if (rec && this.onOpen) this.onOpen(rec.item);
      }
    });
  }

  setHover(id, e) {
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
        : `.bcat[data-cat="${esc(cat)}"], .bsrc[data-cat="${esc(cat)}"][data-src="${esc(src)}"], .stem[data-cat="${esc(cat)}"][data-src="${esc(src)}"]`;
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
