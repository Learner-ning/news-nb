// 新闻交互模块：指针/触摸拾取、悬停检测、跟随/固定模式、点击与双击
import * as THREE from "/vendor/three/three.module.js";

export class Interaction {
  constructor(opts) {
    this.canvas = opts.canvas;
    this.camera = opts.camera;
    this.tree = opts.tree;
    this.ui = opts.ui;
    this.getSize = opts.getSize;
    this.onOpenDetail = opts.onOpenDetail || null;

    this.mode = "pin";
    try { this.mode = localStorage.getItem("ntree.mode") || "pin"; } catch (e) {}

    this.pointer = { x: 0, y: 0, active: false, type: "mouse" };
    this.current = null;  // 当前悬停/选中的 leafId
    this.pinned = false;  // 点击固定
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.lastClick = 0;
  }

  attach() {
    const c = this.canvas;
    c.addEventListener("pointermove", (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.pointer.active = true;
      this.pointer.type = e.pointerType || "mouse";
    });
    c.addEventListener("pointerdown", (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.pointer.active = true;
      // 触摸：点枝叶即显示并固定新闻
      if (e.pointerType === "touch") {
        const leaf = this.pickAt(e.clientX, e.clientY);
        if (leaf) {
          this.select(leaf);
          this.pinned = true;
        }
      }
    });
    c.addEventListener("pointerleave", () => {
      this.pointer.active = false;
      if (this.mode === "follow" && !this.pinned) {
        this.setCurrent(null);
        this.tree.setHoverLeaf(null);
        this.ui.hideCard();
      }
    });
    c.addEventListener("click", (e) => {
      const leaf = this.pickAt(e.clientX, e.clientY);
      if (leaf) {
        this.select(leaf);
        this.pinned = true;
        const now = Date.now();
        if (now - this.lastClick < 350 && this.current === leaf) {
          this.lastClick = 0;
          if (this.onOpenDetail) this.onOpenDetail(leaf);
        } else {
          this.lastClick = now;
        }
      } else {
        // 点击空白：取消固定并收起
        this.pinned = false;
        this.setCurrent(null);
        this.tree.setHoverLeaf(null);
        this.ui.hideCard();
      }
    });
    window.addEventListener("blur", () => { this.pointer.active = false; });
  }

  pickAt(x, y) {
    const size = this.getSize();
    this.ndc.set((x / size.w) * 2 - 1, -(y / size.h) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.tree.pickGroup.children, false);
    return hits.length ? hits[0].object.userData.leafId : null;
  }

  select(leafId) {
    this.setCurrent(leafId);
    this.tree.setHoverLeaf(leafId);
    const size = this.getSize();
    const sp = this.tree.projectLeaf(leafId, this.camera, size.w, size.h);
    if (sp) this.ui.showCard(leafId, sp);
  }

  setCurrent(leafId) {
    if (this.current === leafId) return;
    this.current = leafId;
  }

  setMode(m) {
    this.mode = m;
    try { localStorage.setItem("ntree.mode", m); } catch (e) {}
    if (m === "follow" && !this.pinned) {
      this.setCurrent(null);
      this.tree.setHoverLeaf(null);
      this.ui.hideCard();
    }
  }

  unpin() {
    this.pinned = false;
    this.setCurrent(null);
    this.tree.setHoverLeaf(null);
    this.ui.hideCard();
  }

  update(dt) {
    if (!this.pointer.active && !this.pinned) return;
    const size = this.getSize();
    const leaf = this.pickAt(this.pointer.x, this.pointer.y);
    if (leaf && leaf !== this.current) {
      this.select(leaf);
      return;
    }
    if (!leaf && this.current && !this.pinned && this.mode === "follow") {
      this.setCurrent(null);
      this.tree.setHoverLeaf(null);
      this.ui.hideCard();
      return;
    }
    if (leaf && this.ui) {
      const sp = this.tree.projectLeaf(leaf, this.camera, size.w, size.h);
      if (sp) this.ui.moveCardTo(sp);
    }
  }
}
