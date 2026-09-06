// 新闻树应用入口：装配视图模式（树/列表）、真实分类、详情、刷新与路由
import { loadNews, getState, getTags, buildTreeModel, getUpdatedLabel } from "./news-store.js";
import { TreeView } from "./tree-view.js";
import { colorFor } from "./helpers.js";
import * as views from "./views.js";

const $ = (s) => document.querySelector(s);

const els = {
  treeView: $("#view-tree"),
  listView: $("#view-list"),
  detailView: $("#view-detail"),
  treeSvg: $("#tree-svg"),
  newsList: $("#news-list"),
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
  treeHint: $("#tree-hint")
};

const state = {
  mode: (() => {
    try { return localStorage.getItem("nt.mode") === "list" ? "list" : "tree"; } catch { return "tree"; }
  })(),
  cat: (() => {
    try { return localStorage.getItem("nt.cat") || "all"; } catch { return "all"; }
  })(),
  data: null,  // 完整树模型（未筛选）
  items: []
};

const tree = new TreeView(els.treeSvg);

function save() {
  try {
    localStorage.setItem("nt.mode", state.mode);
    localStorage.setItem("nt.cat", state.cat);
  } catch {}
}

// ---------------- 状态与数据 ----------------
function setStatus() {
  const st = getState();
  const label = getUpdatedLabel();
  els.topStatus.textContent = `${st.items.length} 条 · ${label} 更新${st.stale ? " · 缓存" : ""}${st.errors?.length ? " · 部分源不可用" : ""}`;
}

function filteredCats() {
  const all = state.data || [];
  if (state.cat === "all") return all;
  return all.filter((c) => c.key === state.cat);
}

// ---------------- 视图切换 ----------------
function showMainView() {
  els.detailView.classList.add("hidden");
  els.catBar.classList.remove("hidden");
  document.body.classList.remove("no-cat");
  if (state.mode === "tree") {
    els.listView.classList.add("hidden");
    els.treeView.classList.remove("hidden");
    document.body.classList.add("stage-tree");
    document.body.classList.remove("stage-list");
  } else {
    els.treeView.classList.add("hidden");
    els.listView.classList.remove("hidden");
    document.body.classList.remove("stage-tree");
    document.body.classList.add("stage-list");
  }
}

function showDetail() {
  els.treeView.classList.add("hidden");
  els.listView.classList.add("hidden");
  els.detailView.classList.remove("hidden");
  els.catBar.classList.add("hidden");
  document.body.classList.add("no-cat");
  document.body.classList.remove("stage-tree", "stage-list");
}

// ---------------- 树模式 ----------------
function rebuildTree() {
  const cats = filteredCats();
  els.treeHint.textContent =
    cats.length ? "拖动移动 · 滚轮/捏合缩放 · 悬停叶片看新闻 · 点击进详情"
      : "新闻源暂时不可用，请稍后刷新。";
  tree.build(cats);
}

// ---------------- 列表模式 ----------------
function renderList() {
  const cats = filteredCats();
  const items = cats.flatMap((c) => c.sources.flatMap((s) => s.items));
  els.listTitle.textContent = state.cat === "all" ? "全部新闻" : `${state.cat} · 新闻列表`;
  views.renderListMeta(els.listMeta, items);
  views.renderList(els.newsList, items);
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
  else renderList();
}

// ---------------- 数据加载 ----------------
async function initData({ force = false } = {}) {
  await loadNews({ force });
  setStatus();
  state.items = getState().items;
  state.data = buildTreeModel(state.items);
  renderCatBar();
  if (state.mode === "tree") rebuildTree();
  else renderList();
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

  // 显示方式（新闻树 / 新闻列表）
  document.querySelectorAll(".dock-btn").forEach((b) => {
    b.addEventListener("click", () => {
      const m = b.dataset.mode;
      if (m === state.mode) return;
      state.mode = m;
      save();
      document.querySelectorAll(".dock-btn").forEach((x) => x.classList.toggle("active", x.dataset.mode === m));
      showMainView();
      if (m === "list") renderList();
      else requestAnimationFrame(() => tree.fit(true));
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

  // 列表点击 / 键盘
  els.newsList.addEventListener("click", (e) => {
    const c = e.target.closest(".card[data-id]");
    if (c) openDetail(c.dataset.id);
  });
  els.newsList.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      const c = e.target.closest(".card[data-id]");
      if (c) {
        e.preventDefault();
        openDetail(c.dataset.id);
      }
    }
  });

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
}

// ---------------- 启动 ----------------
(async function boot() {
  wire();
  const match = location.pathname.match(/^\/detail\/([0-9a-z]+)$/i);
  if (match) {
    showDetail();
    await initData();
    await openDetail(match[1], { push: false });
  } else {
    showMainView();
    await initData();
    requestAnimationFrame(() => requestAnimationFrame(() => tree.fit()));
  }
})();

// 便于调试 / 自检
window.__newsTree = {
  state: () => ({ mode: state.mode, cat: state.cat, items: state.items.length, cats: state.data?.length }),
  tree
};
