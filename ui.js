// UI 控制模块：新闻卡片、详情覆盖层、显示模式、昼夜按钮、背景设置、提示
import { getNews } from "./news-data.js";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
  });
}

function byId(id) { return document.getElementById(id); }

function timeAgo(iso) {
  if (!iso) return "";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return m + " 分钟前";
  if (m < 1440) return Math.floor(m / 60) + " 小时前";
  return Math.floor(m / 1440) + " 天前";
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

const CARD_W = 320;

export class UI {
  constructor(opts) {
    this.opts = opts;
    this.card = byId("news-card");
    this.cardPos = { x: 0, y: 0 };
    this.cardTarget = null;
    this.cardVisible = false;
    this.currentLeaf = null;

    this.bindControls();
    this.hint = byId("hint");
    setTimeout(function (self) { return function () { self.hint.classList.add("fade"); }; }(this), 14000);
  }

  bindControls() {
    // 显示模式
    const btns = document.querySelectorAll(".mode-opt");
    for (let i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", () => {
        this.opts.onMode(btns[i].dataset.mode);
      });
    }
    this.syncMode();

    // 昼夜
    byId("daynight-btn").addEventListener("click", () => { this.opts.onToggleDayNight(); });

    // 背景设置
    const gear = byId("settings-btn");
    const panel = byId("settings-panel");
    gear.addEventListener("click", (e) => {
      e.stopPropagation();
      panel.classList.toggle("hidden");
    });
    document.addEventListener("click", (e) => {
      if (!panel.classList.contains("hidden") && !panel.contains(e.target) && e.target !== gear) {
        panel.classList.add("hidden");
      }
    });
    const apply = (mode, extra) => {
      this.opts.onBgApply(Object.assign({ mode: mode }, extra || {}));
      panel.classList.add("hidden");
    };
    const q = (sel) => document.querySelector(sel);
    q('[data-bg="scene-night"]').addEventListener("click", () => apply("scene", { night: 1 }));
    q('[data-bg="scene-day"]').addEventListener("click", () => apply("scene", { night: 0 }));
    q("#bg-image-apply").addEventListener("click", () => apply("image", { url: byId("bg-image-input").value }));
    q("#bg-color-apply").addEventListener("click", () => apply("color", { color: byId("bg-color-input").value }));
    q("#bg-video-apply").addEventListener("click", () => apply("video", { url: byId("bg-video-input").value }));

    // 卡片按钮
    byId("nc-detail").addEventListener("click", () => {
      if (this.currentLeaf) this.opts.onOpenDetail(this.currentLeaf);
    });
    byId("nc-close").addEventListener("click", () => {
      this.opts.onUnpin();
    });

    // 详情覆盖层
    byId("detail-close").addEventListener("click", () => this.closeDetail());
    byId("detail-overlay").addEventListener("click", (e) => {
      if (e.target === byId("detail-overlay")) this.closeDetail();
    });
  }

  syncMode() {
    const btns = document.querySelectorAll(".mode-opt");
    for (let i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("active", btns[i].dataset.mode === this.opts.mode);
    }
  }

  setNightLabel(night) {
    const icon = byId("dn-icon");
    const label = byId("dn-label");
    if (night > 0.5) { icon.textContent = "🌙"; label.textContent = "夜晚"; }
    else { icon.textContent = "☀️"; label.textContent = "白天"; }
  }

  // ---------- 新闻卡片 ----------
  showCard(leafId, sp) {
    const news = getNews(leafId);
    if (!news) return;
    this.currentLeaf = leafId;
    byId("nc-chip").textContent = news.categoryName || "";
    byId("nc-chip").style.color = news.color || "#7de8ff";
    byId("nc-title").textContent = news.title || "";
    byId("nc-meta").textContent = (news.source || "") + " · " + timeAgo(news.time);
    byId("nc-summary").textContent = news.summary || "";
    byId("nc-link").href = news.url || "#";
    const dots = byId("nc-imp");
    const n = Math.max(1, Math.round((news.importance || 0.5) * 5));
    let d = "";
    for (let i = 0; i < 5; i++) d += '<i class="imp-dot' + (i < n ? " on" : "") + '"></i>';
    dots.innerHTML = d;
    this.cardVisible = true;
    this.card.classList.add("show");
    this.placeCard(sp);
  }

  placeCard(sp) {
    const w = innerWidth;
    const h = innerHeight;
    const cw = Math.min(CARD_W, w - 24);
    const ch = this.card.offsetHeight || 210;
    const right = sp.x < w / 2;
    const ox = CARD_W / 2 + 20;
    let x = right ? sp.x + ox : sp.x - ox - cw;
    let y = sp.y - ch / 2;
    x = clamp(x, 10, w - cw - 10);
    y = clamp(y, 72, h - ch - 12);
    this.card.classList.toggle("side-r", right);
    this.card.classList.toggle("side-l", !right);
    this.cardTarget = { x: x, y: y };
    this.cardPos.x = x;
    this.cardPos.y = y;
    this.applyCardPos();
  }

  moveCardTo(sp) {
    if (!this.cardVisible) return;
    const w = innerWidth;
    const cw = Math.min(CARD_W, w - 24);
    const ch = this.card.offsetHeight || 210;
    const right = sp.x < w / 2;
    const ox = CARD_W / 2 + 20;
    let x = right ? sp.x + ox : sp.x - ox - cw;
    let y = sp.y - ch / 2;
    x = clamp(x, 10, w - cw - 10);
    y = clamp(y, 72, innerHeight - ch - 12);
    this.cardTarget = { x: x, y: y };
  }

  hideCard() {
    this.cardVisible = false;
    this.currentLeaf = null;
    this.card.classList.remove("show");
  }

  update(dt) {
    if (this.cardVisible && this.cardTarget) {
      this.cardPos.x += (this.cardTarget.x - this.cardPos.x) * 0.22;
      this.cardPos.y += (this.cardTarget.y - this.cardPos.y) * 0.22;
      this.applyCardPos();
    }
  }

  applyCardPos() {
    this.card.style.transform =
      "translate3d(" + Math.round(this.cardPos.x) + "px," + Math.round(this.cardPos.y) + "px,0)";
  }

  // ---------- 详情覆盖层 ----------
  openDetail(leafId) {
    const news = getNews(leafId);
    if (!news) return;
    byId("detail-chip").textContent = news.categoryName || "";
    byId("detail-chip").style.color = news.color || "#7de8ff";
    byId("detail-title").textContent = news.title || "";
    byId("detail-meta").textContent =
      (news.source || "") + " · " + timeAgo(news.time) + " · 枝 " + (news.branch || "") + " · 叶 " + (news.leaf || "");
    byId("detail-summary").textContent = news.summary || "";
    byId("detail-link").href = news.url || "#";
    byId("detail-overlay").classList.remove("hidden");
  }

  closeDetail() {
    byId("detail-overlay").classList.add("hidden");
  }
}
