// 新闻树应用入口：树/列表/热榜三视图 + 分类 + 热度排序 + 详情 + 背景外观 + 路由
import { loadNews, getState, getTags, buildTreeModel, getUpdatedLabel } from "./news-store.js";
import { TreeView } from "./tree-view.js";
import { colorFor } from "./helpers.js";
import * as views from "./views.js";

const $ = (s) => document.querySelector(s);

const els = {
  treeView: $("#view-tree"),
  listView: $("#view-list"),
  boardView: $("#view-board"),
  detailView: $("#view-detail"),
  treeSvg: $("#tree-svg"),
  newsList: $("#news-list"),
  boardList: $("#board-list"),
  boardMeta: $("#board-meta"),
  listTitle: $("#list-title"),
  listMeta: $("#list-meta"),
  detailContent: $("#detail-content"),
  backBtn: $("#back-btn"),
  brand: $("#brand"),
  refresh: $("#refresh"),
  topStatus: $("#top-status"),
  catBar: $("#cat-bar"),
  catScroll: $("#cat-scroll"),
  hoverCard: $("#hover-card"),
  treeHint: $("#tree-hint"),
  dock: document.querySelector(".left-dock"),
  // 背景与外观
  bg: $("#bg"),
  bgPhoto: $("#bg-photo"),
  bgSettings: $("#bg-settings"),
  bgSettingsClose: $("#bg-settings-close"),
  bgBtn: $("#bg-btn"),
  bgThemeBtns: document.querySelectorAll(".bs-theme"),
  bgUploadBtn: $("#bg-upload-btn"),
  bgFile: $("#bg-file"),
  bgUrlInput: $("#bg-url-input"),
  bgUrlApply: $("#bg-url-apply"),
  bgPhotoRemove: $("#bg-photo-remove"),
  bgPhotoState: $("#bg-photo-state"),
  bgDim: $("#bg-dim"),
  dimVal: $("#dim-val")
};

function loadBg() {
  const d = { theme: "night", photo: null, dim: 0.35 };
  try {
    const o = JSON.parse(localStorage.getItem("nt.bg") || "null");
    if (o) {
      d.theme = ["night", "dawn", "ocean"].includes(o.theme) ? o.theme : "night";
      d.photo = typeof o.photo === "string" && o.photo ? o.photo : null;
      d.dim = Number.isFinite(o.dim) ? Math.min(0.9, Math.max(0, o.dim)) : 0.35;
    }
  } catch {}
  return d;
}

const state = {
  mode: (() => {
    try { return ["tree", "list", "board"].includes(localStorage.getItem("nt.mode")) ? localStorage.getItem("nt.mode") : "tree"; } catch { return "tree"; }
  })(),
  cat: (() => {
    try { return localStorage.getItem("nt.cat") || "all"; } catch { return "all"; }
  })(),
  sort: (() => {
    try { return localStorage.getItem("nt.sort") === "time" ? "time" : "heat"; } catch { return "heat"; }
  })(),
  bg: loadBg(),
  data: null,  // 完整树模型（未筛选）
  items: []
};

const tree = new TreeView(els.treeSvg);

function save() {
  try {
    localStorage.setItem("nt.mode", state.mode);
    localStorage.setItem("nt.cat", state.cat);
    localStorage.setItem("nt.sort", state.sort);
  } catch {}
}
function saveBg() {
  try { localStorage.setItem("nt.bg", JSON.stringify(state.bg)); } catch {}
}

// ---------------- 背景与外观 ----------------
function applyBg() {
  const { theme, photo, dim } = state.bg;
  document.body.dataset.theme = theme;
  els.bgThemeBtns.forEach((b) => b.classList.toggle("active", b.dataset.theme === theme));
  els.bg.style.setProperty("--dim", String(dim));
  els.bgDim.value = String(Math.round(dim * 100));
  els.dimVal.textContent = Math.round(dim * 100) + "%";
  if (photo) {
    document.body.dataset.photo = "1";
    els.bgPhoto.style.backgroundImage = `url("${photo}")`;
    els.bgPhotoState.classList.remove("hidden");
  } else {
    document.body.dataset.photo = "0";
    els.bgPhoto.style.backgroundImage = "";
    els.bgPhotoState.classList.add("hidden");
  }
}

function markPhotoReady() {
  if (state.bg.photo) document.body.dataset.photoReady = "1";
}

function setBgPhoto(src) {
  state.bg.photo = src;
  saveBg();
  const probe = new Image();
  probe.onload = () => { applyBg(); markPhotoReady(); };
  probe.onerror = () => { applyBg(); };
  probe.src = src;
  applyBg();
}

// ---------------- 状态与数据 ----------------
function setStatus() {
  const st = getState();
  const label = getUpdatedLabel();
  els.topStatus.textContent = `${st.items.length} 条 · ${label} 更新${st.stale ? " · 缓存" : ""}${st.errors?.length ? " · 部分源不可用" : ""}`;
}

function flatFiltered() {
  const all = state.data || [];
  const cats = state.cat === "all" ? all : all.filter((c) => c.key === state.cat);
  return cats.flatMap((c) => c.sources.flatMap((s) => s.items));
}

// ---------------- 视图切换（树/列表/热榜/详情） ----------------
function showMainView() {
  els.detailView.classList.add("hidden");
  els.dock.classList.remove("hidden");
  els.catBar.classList.remove("hidden");
  document.body.classList.remove("no-cat");
  els.treeView.classList.toggle("hidden", state.mode !== "tree");
  els.listView.classList.toggle("hidden", state.mode !== "list");
  els.boardView.classList.toggle("hidden", state.mode !== "board");
}

function showDetail() {
  els.treeView.classList.add("hidden");
  els.listView.classList.add("hidden");
  els.boardView.classList.add("hidden");
  els.detailView.classList.remove("hidden");
  els.dock.classList.add("hidden");
  els.catBar.classList.add("hidden");
  document.body.classList.add("no-cat");
}

// ---------------- 三个视图的渲染 ----------------
function rebuildTree() {
  const cats = state.data || [];
  const shown = state.cat === "all" ? cats : cats.filter((c) => c.key === state.cat);
  els.treeHint.textContent =
    shown.length ? "拖动移动 · 滚轮/捏合缩放 · 悬停叶片看新闻 · 点击进详情"
      : "新闻源暂时不可用，请稍后刷新。";
  tree.build(shown);
}

function renderList() {
  const items = [...flatFiltered()];
  if (state.sort === "time") {
    items.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
  } else {
    // 默认：热度 + 时间衰减（heatScore 已含时间衰减）
    items.sort((a, b) => (b.heatScore || 0) - (a.heatScore || 0));
  }
  els.listTitle.textContent = state.cat === "all" ? "全部新闻" : `${state.cat} · 新闻列表`;
  views.renderListMeta(els.listMeta, items);
  views.renderList(els.newsList, items);
  syncSortPills();
}

function renderBoard() {
  const items = [...flatFiltered()];
  items.sort((a, b) => (b.heatScore || 0) - (a.heatScore || 0));
  views.setBoardMeta(els.boardMeta, items);
  views.renderBoard(els.boardList, items.slice(0, 20));
}

function syncSortPills() {
  document.querySelectorAll(".sort-pill").forEach((p) => {
    p.classList.toggle("active", p.dataset.sort === state.sort);
  });
}

// ---------------- 详情（沿用现有跳转逻辑） ----------------
async function openDetail(id, { push = true } = {}) {
  if (!id) return;
  showDetail();
  views.showDetailSkeleton(els.detailContent);
  document.title = "加载中 — 新闻树";
  let item = state.items.find((x) => x.id === id);
  if (!item) {
    try {
      const r = await fetch("/api/news/" + encodeURIComponent(id));
      if (!r.ok) throw new Error("not found");
      item = await r.json();
    } catch {
      views.showDetailError(els.detailContent, () => goMain(true));
      return;
    }
  }
  views.renderDetail(els.detailContent, item);
  document.title = `${item.title} — 新闻树`;
  if (push) history.pushState({ view: "detail", id }, "", `/detail/${id}`);
}

function goMain(reload = false) {
  history.pushState(null, "", "/");
  showMainView();
  if (reload || !state.items.length) initData({ force: reload });
}

// ---------------- 分类导航（来自真实数据） ----------------
function renderCatBar() {
  els.catScroll.innerHTML = "";
  const tags = getTags();
  const mk = (key, label, active, color) => {
    const b = document.createElement("button");
    b.className = "cat-btn" + (active ? " active" : "");
    b.dataset.cat = key;
    b.textContent = label;
    if (color) b.style.setProperty("--c", color);
    b.setAttribute("aria-pressed", active ? "true" : "false");
    els.catScroll.appendChild(b);
  };
  mk("all", "全部", state.cat === "all");
  tags.forEach((t) => mk(t, t, state.cat === t, colorFor(t)));
}

function pickCat(key) {
  state.cat = key;
  save();
  document.querySelectorAll(".cat-btn").forEach((b) => {
    const on = b.dataset.cat === key;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  if (state.mode === "tree") rebuildTree();
  else if (state.mode === "list") renderList();
  else renderBoard();
}

// ---------------- 数据加载 ----------------
async function initData({ force = false } = {}) {
  await loadNews({ force });
  setStatus();
  state.items = getState().items;
  state.data = buildTreeModel(state.items);
  renderCatBar();
  if (state.mode === "tree") rebuildTree();
  else if (state.mode === "list") renderList();
  else renderBoard();
}

// ---------------- 图片压缩（避免 localStorage 超限） ----------------
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 1600;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------------- 事件 ----------------
function wire() {
  // —— 悬停信息卡 ——
  tree.onHover = (item, e) => {
    els.hoverCard.dataset.id = item.id;
    views.fillHoverCard(els.hoverCard, item);
    els.hoverCard.classList.remove("hidden");
    views.positionHoverCard(els.hoverCard, e);
  };
  tree.onLeave = () => els.hoverCard.classList.add("hidden");
  tree.onOpen = (item) => openDetail(item.id);
  tree.attach();
  els.hoverCard.querySelector("#hc-open").addEventListener("click", () => {
    const id = els.hoverCard.dataset.id;
    if (id) openDetail(id);
  });

  // 显示方式（新闻树 / 新闻列表 / 热榜）
  els.dock.querySelectorAll(".dock-btn").forEach((b) => {
    b.addEventListener("click", () => {
      const m = b.dataset.mode;
      if (m === state.mode) return;
      state.mode = m;
      save();
      els.dock.querySelectorAll(".dock-btn").forEach((x) => x.classList.toggle("active", x.dataset.mode === m));
      showMainView();
      if (m === "tree") rebuildTree();
      else if (m === "list") renderList();
      else renderBoard();
    });
  });

  // 列表排序
  document.querySelectorAll(".sort-pill").forEach((p) => {
    p.addEventListener("click", () => {
      state.sort = p.dataset.sort;
      save();
      renderList();
    });
  });

  // 缩放控制
  $("#zoom-in").addEventListener("click", () => {
    const r = els.treeSvg.getBoundingClientRect();
    tree.zoomBy(1.32, r.width / 2, r.height / 2, true);
  });
  $("#zoom-out").addEventListener("click", () => {
    const r = els.treeSvg.getBoundingClientRect();
    tree.zoomBy(1 / 1.32, r.width / 2, r.height / 2, true);
  });
  $("#zoom-fit").addEventListener("click", () => tree.fit(true));
  $("#zoom-reset").addEventListener("click", () => tree.fit(true));

  // 分类
  els.catScroll.addEventListener("click", (e) => {
    const btn = e.target.closest(".cat-btn");
    if (btn) pickCat(btn.dataset.cat);
  });

  // 列表 / 热榜点击与键盘
  const openFrom = (container) => {
    container.addEventListener("click", (e) => {
      const c = e.target.closest(".row-item[data-id]");
      if (c) openDetail(c.dataset.id);
    });
    container.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        const c = e.target.closest(".row-item[data-id]");
        if (c) {
          e.preventDefault();
          openDetail(c.dataset.id);
        }
      }
    });
  };
  openFrom(els.newsList);
  openFrom(els.boardList);

  // 详情返回 / 品牌回首页
  els.backBtn.addEventListener("click", () => {
    if (history.state?.view === "detail") history.back();
    else goMain();
  });
  els.brand.addEventListener("click", () => {
    if (location.pathname !== "/") history.pushState(null, "", "/");
    goMain(true);
  });

  // 刷新
  els.refresh.addEventListener("click", async () => {
    els.refresh.classList.add("spinning");
    try {
      if (!location.pathname.startsWith("/detail/")) {
        await initData({ force: true });
      } else {
        const id = location.pathname.split("/").pop();
        await initData({ force: true });
        await openDetail(id, { push: false });
      }
    } finally {
      els.refresh.classList.remove("spinning");
    }
  });

  // 浏览器前进 / 后退
  window.addEventListener("popstate", () => {
    const m = location.pathname.match(/^\/detail\/([0-9a-z]+)$/i);
    if (m) openDetail(m[1], { push: false });
    else {
      showMainView();
      if (state.mode === "tree") requestAnimationFrame(() => tree.fit(true));
    }
  });

  window.addEventListener("resize", () => {
    if (state.mode === "tree" && !els.treeView.classList.contains("hidden")) tree.fit();
  });

  // —— 背景与外观 ——
  els.bgBtn.addEventListener("click", () => els.bgSettings.classList.toggle("hidden"));
  els.bgSettingsClose.addEventListener("click", () => els.bgSettings.classList.add("hidden"));
  document.addEventListener("pointerdown", (e) => {
    if (els.bgSettings.classList.contains("hidden")) return;
    if (els.bgSettings.contains(e.target) || els.bgBtn.contains(e.target)) return;
    els.bgSettings.classList.add("hidden");
  });

  els.bgThemeBtns.forEach((b) => {
    b.addEventListener("click", () => {
      state.bg.theme = b.dataset.theme;
      saveBg();
      applyBg();
    });
  });

  els.bgDim.addEventListener("input", () => {
    state.bg.dim = Number(els.bgDim.value) / 100;
    saveBg();
    applyBg();
  });

  els.bgUploadBtn.addEventListener("click", () => els.bgFile.click());
  els.bgFile.addEventListener("change", async () => {
    const file = els.bgFile.files && els.bgFile.files[0];
    els.bgFile.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 12 * 1024 * 1024) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      setBgPhoto(dataUrl);
    } catch {}
  });

  els.bgUrlApply.addEventListener("click", () => {
    const url = els.bgUrlInput.value.trim();
    if (!url) return;
    els.bgUrlInput.value = "";
    setBgPhoto(url);
  });

  els.bgPhotoRemove.addEventListener("click", () => {
    state.bg.photo = null;
    saveBg();
    applyBg();
  });
}

// ---------------- 启动 ----------------
(async function boot() {
  wire();
  applyBg();
  if (state.bg.photo) markPhotoReady();
  syncSortPills();
  const match = location.pathname.match(/^\/detail\/([0-9a-z]+)$/i);
  if (match) {
    showDetail();
    await initData();
    await openDetail(match[1], { push: false });
  } else {
    showMainView();
    await initData();
    if (state.mode === "tree") requestAnimationFrame(() => requestAnimationFrame(() => tree.fit()));
  }
})();

// 便于调试 / 自检
window.__newsTree = {
  state: () => ({ mode: state.mode, cat: state.cat, sort: state.sort, items: state.items.length, cats: state.data?.length }),
  tree
};
