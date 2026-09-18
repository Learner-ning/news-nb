// 新闻树应用入口：树/列表/热榜三视图 + 新闻源导航 + 分类筛选 + 详情 + 路由
//
// 路由（Stage 3.2）：
//   /             首页：新闻源树 / 新闻列表（按来源分区）/ 热榜
//   /source/:key  某个新闻源的独立新闻树（key = 来源名，不引入第二套命名）
//   /detail/:id   新闻详情（保持不变）
import {
  loadNews, getState, getTags, buildSourceModel, buildSourceTreeModel,
  buildListSections, resolveSource, sourceMeta, itemsOfSource,
  getUpdatedLabel, loadCache
} from "./news-store.js";
import { TreeView } from "./tree-view.js";
import { colorFor } from "./helpers.js";
import { parseRoute, sourceHref } from "./routes.js";
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
  boardPlats: $("#board-plats"),
  listTitle: $("#list-title"),
  listMeta: $("#list-meta"),
  detailContent: $("#detail-content"),
  backBtn: $("#back-btn"),
  brand: $("#brand"),
  refresh: $("#refresh"),
  topStatus: $("#top-status"),
  statSources: $("#stat-sources"),
  statStories: $("#stat-stories"),
  statUpdated: $("#stat-updated"),
  envBtns: document.querySelectorAll(".env-btn"),
  catBar: $("#cat-bar"),
  catScroll: $("#cat-scroll"),
  hoverCard: $("#hover-card"),
  peekCard: $("#peek-card"),
  treeHint: $("#tree-hint"),
  dock: document.querySelector(".left-dock"),
  dockCollapse: $("#dock-collapse"),
  dockReopen: $("#dock-reopen"),
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
  dimVal: $("#dim-val"),
  toast: $("#toast"),
  // 来源页导航条
  sourceBar: $("#source-bar"),
  sourceBack: $("#source-back"),
  sourceBarName: $("#source-bar-name"),
  sourceBarCount: $("#source-bar-count")
};

// ---------------- 路由（解析逻辑在 routes.js，纯函数可单测） ----------------

// ---------------- 轻量提示条 / 首屏骨架 ----------------
let toastTimer = null;
function toast(msg, kind = "ok") {
  if (!els.toast) return;
  els.toast.textContent = msg;
  els.toast.className = "toast show " + kind;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.className = "toast"; }, 2600);
}

/** 无本地缓存且服务端正在抓取时显示骨架 */
function setSkeleton(on) {
  document.body.classList.toggle("booting", Boolean(on));
}

function loadBg() {
  // 默认 = DAY（Stage 3.4：首页是「现代新闻编辑室 + 数字生态树」，默认清晨纸面环境）
  const d = { theme: "day", photo: null, dim: 0.35 };
  try {
    const o = JSON.parse(localStorage.getItem("nt.bg") || "null");
    if (o) {
      d.theme = ["day", "night", "dawn", "ocean"].includes(o.theme) ? o.theme : "day";
      d.photo = typeof o.photo === "string" && o.photo ? o.photo : null;
      d.dim = Number.isFinite(o.dim) ? Math.min(0.9, Math.max(0, o.dim)) : 0.35;
    }
  } catch {}
  // 允许用 URL 覆盖环境：?env=night / ?theme=day
  // 用途：人工审查时可以直接给出「两个环境各一张」的链接，截图/对比不用改本地设置。
  try {
    const q = new URLSearchParams(location.search);
    const t = q.get("env") || q.get("theme");
    if (t && ["day", "night", "dawn", "ocean"].includes(t)) d.theme = t;
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
  dockOpen: (() => {
    try { return localStorage.getItem("nt.dock") !== "off"; } catch { return true; }
  })(),
  plat: (() => {
    try { return localStorage.getItem("nt.plat") || "all"; } catch { return "all"; }
  })(),
  bg: loadBg(),
  source: null,    // 当前来源页的来源名（null = 首页）
  data: null,      // 新闻源树模型（首页一级节点 = 新闻源）
  items: []
};

const tree = new TreeView(els.treeSvg);

function save() {
  try {
    localStorage.setItem("nt.mode", state.mode);
    localStorage.setItem("nt.cat", state.cat);
    localStorage.setItem("nt.sort", state.sort);
    localStorage.setItem("nt.dock", state.dockOpen ? "on" : "off");
    localStorage.setItem("nt.plat", state.plat || "all");
  } catch {}
}
function saveBg() {
  try { localStorage.setItem("nt.bg", JSON.stringify(state.bg)); } catch {}
}

// ---------------- 背景与外观 ----------------
// Stage 3.5：DAY / NIGHT 是**全站颜色环境**，树/列表/热榜/详情只是布局模式。
// data-env  = 环境（只有 day / night 两个值）→ 所有语义变量与组件规则都挂在它上面
// data-theme = 具体预设（dawn / ocean 是 day / night 的变体，保留给设置面板）
const ENV_OF = { day: "day", night: "night", dawn: "day", ocean: "night" };

function applyBg() {
  const { theme, photo, dim } = state.bg;
  document.body.dataset.theme = theme;
  document.body.dataset.env = ENV_OF[theme] || "day";
  els.bgThemeBtns.forEach((b) => b.classList.toggle("active", b.dataset.theme === theme));
  // 底部 DAY/NIGHT 两段开关：dawn 归 DAY、ocean 归 NIGHT
  els.envBtns.forEach((b) => b.classList.toggle("active", b.dataset.env === document.body.dataset.env));
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
/** 顶部统计（§5：15 SOURCES / 209 STORIES / LAST UPDATED）—— 数字全部来自真实数据 */
function setStatus() {
  const st = getState();
  const srcCount = (state.data || []).length;
  if (els.statSources) els.statSources.textContent = String(srcCount);
  if (els.statStories) els.statStories.textContent = String(st.items.length);
  if (els.statUpdated) els.statUpdated.textContent = st.items.length ? getUpdatedLabel() : "—";

  // 细节（是否缓存 / 是否部分源不可用）收进 title，悬停可见，不占主视觉
  const parts = [];
  if (st.items.length) parts.push(`${st.items.length} 条`);
  else parts.push("暂无数据");
  if (st.warming && !st.items.length) parts.push("正在更新…");
  else parts.push(`${getUpdatedLabel()} 更新`);
  if (st.fromCache) parts.push("缓存数据");
  if (st.stale) parts.push("缓存");
  if (st.errors?.length) parts.push(`${st.errors.length} 个源不可用`);
  els.topStatus.title = parts.join(" · ");
}

/** 当前视图 scope 下的全部条目（来源页只看该来源） */
function flatFiltered() {
  if (state.source) return itemsOfSource(state.source, state.items);
  const all = state.data || [];
  const shown = state.cat === "all" ? all : all.filter((e) => e.tags.includes(state.cat));
  return shown.flatMap((e) => e.sources.flatMap((s) => s.items));
}

/** 首页树的一级节点（按分类筛选后的新闻源） */
function homeTreeModel() {
  const all = state.data || [];
  return state.cat === "all" ? all : all.filter((e) => e.tags.includes(state.cat));
}

// ---------------- 首页新闻源预览卡 ----------------
/** 某来源最新的 k 条真实新闻（按时间倒序，时间缺失时落到末尾，不编造顺序） */
function latestOfSource(key, k = 3) {
  const items = (state.data || []).filter((e) => e.key === key || e.name === key);
  const flat = items.flatMap((e) =>
    (e.sources || []).length
      ? e.sources.flatMap((s) => s.items || [])
      : (e.items || []));
  const t = (x) => Number(x.time || x.publishedAt || 0);
  return flat
    .slice()
    .sort((a, b) => t(b) - t(a) || String(a.id).localeCompare(String(b.id)))
    .slice(0, k);
}

function fillPeek(key, count, items) {
  views.fillPeekCard(els.peekCard, key, count, items);
}

function positionPeek(cardEl, el, evt) {
  views.positionPeekCard(cardEl, el, evt);
}

function hidePeek() {
  els.peekCard.classList.add("hidden");
}

// ---------------- 左侧面板折叠 ----------------
function setDockState() {
  const off = !state.dockOpen;
  document.body.classList.toggle("dock-off", off);
  // 展开状态显示面板；折叠状态显示左缘把手
  els.dockReopen.classList.toggle("hidden", !off);
}

// ---------------- 视图切换（树/列表/热榜/详情） ----------------
function showMainView() {
  els.detailView.classList.add("hidden");
  els.dock.classList.remove("hidden");
  document.body.classList.remove("detail-mode");
  // 分类筛选属于首页维度；来源页只展示该来源的数据，避免出现空 scope
  const showCat = !state.source;
  els.catBar.classList.toggle("hidden", !showCat);
  document.body.classList.toggle("no-cat", !showCat);
  setDockState();
  renderSourceBar();
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
  els.dockReopen.classList.add("hidden");
  // Stage 3.5：详情页保留底部控制条 —— 只收起「分类」（详情页没有分类筛选），
  // 但 DAY/NIGHT 环境切换必须始终可达（DAY/NIGHT 是全站环境，不是某个视图的属性）。
  els.catBar.classList.remove("hidden");
  els.sourceBar.classList.add("hidden");
  document.body.classList.add("no-cat");
  document.body.classList.add("detail-mode");
  document.body.classList.remove("source-mode");
}

/** 来源页顶部导航条：来源名 / 数量 / 分类 / 返回全部新闻源 */
function renderSourceBar() {
  const on = Boolean(state.source);
  els.sourceBar.classList.toggle("hidden", !on);
  document.body.classList.toggle("source-mode", on);
  if (!on) return;
  const meta = sourceMeta(state.source, state.items);
  els.sourceBarName.textContent = state.source;
  els.sourceBarName.style.setProperty("--c", meta?.color || "#2dd4bf");
  els.sourceBarCount.textContent = meta ? `${meta.count} 条 · ${meta.tag}` : "";
}

// ---------------- 三个视图的渲染 ----------------
function rebuildTree() {
  const model = state.source
    ? buildSourceTreeModel(state.items, state.source)
    : homeTreeModel();
  const warming = getState().warming && !state.items.length;
  els.treeHint.textContent = model.length
    ? (state.source
        ? "拖动移动 · 滚轮/捏合缩放 · 悬停叶片看新闻 · 点击叶片进详情"
        : "拖动移动 · 滚轮/捏合缩放 · 悬停新闻源预览最新 3 条 · 点击进入它的新闻树")
    : warming ? "正在更新新闻……" : "新闻源暂时不可用，请稍后刷新。";
  // 首页用「无叶片树冠」：只显示树干 + 主枝 + 新闻源节点。
  //   新闻（叶片）不再在首页出现 —— 必须先点进某个新闻源，才展开它的新闻树。
  //   这样首页的语义回到「有哪些新闻源」，而不是「一上来就是几百条标题」。
  // 来源页用「扇形模式」：单个来源在扇面内展开多条分枝（Stage 3.2 已验证，保持不变）
  tree.build(model, {
    showSourceLayer: Boolean(state.source),
    mode: state.source ? "fan" : "crown-bare"
  });
}

/** 按当前模式重绘当前视图 */
function renderCurrent() {
  if (state.mode === "tree") rebuildTree();
  else if (state.mode === "list") renderList();
  else renderBoard();
}

function renderList() {
  const items = [...flatFiltered()];
  const sections = buildListSections(items, state.sort);
  els.listTitle.textContent = state.source
    ? `${state.source} · 新闻列表`
    : state.cat === "all" ? "全部新闻" : `${state.cat} · 新闻列表`;
  views.setSourceSectionsMeta(els.listMeta, sections, items.length);
  views.renderSourceSections(els.newsList, sections);
  syncSortPills();
}

function renderBoard() {
  // 热榜视图：仅展示 kind=hot（平台热搜）数据，按平台分组 + 平台名次
  const hot = flatFiltered().filter((x) => x.kind === "hot" || x.type === "hot");
  const groups = views.groupHotByPlatform(hot);
  views.setBoardMeta(els.boardMeta, groups, hot.length);
  // 平台筛选 chips
  els.boardPlats.innerHTML = "";
  const mkChip = (key, label, active) => {
    const b = document.createElement("button");
    b.className = "plat-chip" + (active ? " active" : "");
    b.dataset.plat = key;
    b.textContent = label;
    b.setAttribute("aria-pressed", active ? "true" : "false");
    els.boardPlats.appendChild(b);
  };
  mkChip("all", "全部平台", !state.plat || state.plat === "all" || !groups.some((g) => g.platform === state.plat));
  groups.forEach((g) => mkChip(g.platform, g.platform, state.plat === g.platform));
  const active = groups.some((g) => g.platform === state.plat) ? state.plat : null;
  views.renderBoard(els.boardList, groups, { limit: 10, active });
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
  let item = state.items.find((x) => x.id === id) || null;
  // 列表接口不再返回正文：条目缺少 content 时按需请求详情接口
  if (!item || !item.content) {
    try {
      const r = await fetch("/api/news/" + encodeURIComponent(id), { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const full = await r.json();
      item = item ? { ...item, ...full } : full;
    } catch (e) {
      views.showDetailError(els.detailContent, () => goMain(true), e.message || "请求失败");
      document.title = "加载失败 — 新闻树";
      return;
    }
  }
  views.renderDetail(els.detailContent, item);
  document.title = `${item.title} — 新闻树`;
  if (push) history.pushState({ view: "detail", id }, "", `/detail/${id}`);
}

function goMain(reload = false) {
  state.source = null;
  history.pushState({ view: "main" }, "", "/");
  hidePeek();
  showMainView();
  document.title = "新闻树 · News Tree";
  if (reload || !state.items.length) initData({ force: reload });
  else renderCurrent();
}

// ---------------- 新闻源导航（Stage 3.2） ----------------
/**
 * 进入某个新闻源的独立新闻树。
 * 来源页固定以「树」为默认形态；点新闻源不会直接打开某条新闻详情。
 */
function goSource(key, { push = true } = {}) {
  const name = resolveSource(key, state.items);
  if (!name) {
    toast(`找不到新闻源「${key}」`, "warn");
    return false;
  }
  state.source = name;
  if (state.mode !== "tree") {
    state.mode = "tree";
    save();
    syncDock();
  }
  if (push) history.pushState({ view: "source", key: name }, "", sourceHref(name));
  hidePeek();
  showMainView();
  renderCurrent();
  document.title = `${name} · 独立新闻树 — 新闻树`;
  requestAnimationFrame(() => requestAnimationFrame(() => tree.fit(true)));
  return true;
}

function syncDock() {
  els.dock.querySelectorAll(".dock-btn").forEach((x) => {
    x.classList.toggle("active", x.dataset.mode === state.mode);
  });
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
  renderCurrent();
}

// ---------------- 数据加载 ----------------
const WARM_POLL_INTERVAL_MS = 3000;
const WARM_POLL_MAX = 20;   // 最多轮询 20 次（约 60 秒）
let warmTimer = null;

/** 服务端 warming 时轮询：抓取完成后自动替换内容 */
function startWarmPoll() {
  if (warmTimer) return;
  let tries = 0;
  const tick = async () => {
    warmTimer = null;
    tries++;
    if (tries > WARM_POLL_MAX || !getState().warming) return;
    await loadNews();
    const st = getState();
    if (st.items.length) {
      state.items = st.items;
      state.data = buildSourceModel(state.items);
      setStatus();
      renderCatBar();
      renderCurrent();
    } else {
      setStatus();
    }
    if (st.warming) warmTimer = setTimeout(tick, WARM_POLL_INTERVAL_MS);
  };
  warmTimer = setTimeout(tick, WARM_POLL_INTERVAL_MS);
}

async function initData({ force = false } = {}) {
  await loadNews({ force });
  state.items = getState().items;
  // 注意顺序：setStatus 读的是 state.data（来源数），必须在它算完之后再调，
  // 否则首屏会把「0 SOURCES」显示出来（实测截图确认过这个 bug）。
  state.data = buildSourceModel(state.items);
  setStatus();
  renderCatBar();
  renderCurrent();
  // 服务端缓存为空或正在后台更新 → 轮询等待最新数据
  if (getState().warming) startWarmPoll();
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
  // 点击新闻源节点 → 进入该来源的独立新闻树（不是打开某条新闻详情）
  tree.onOpenSource = (key) => goSource(key);
  // 首页无叶片模式：悬停新闻源 → 预览该来源的最新几条真实新闻
  // （key 为 null 表示已移出，隐藏预览卡）
  tree.onPeekSource = (key, el, count, e) => {
    if (!key) { hidePeek(); return; }
    const items = latestOfSource(key, 3);
    fillPeek(key, count, items);
    els.peekCard.classList.remove("hidden");
    positionPeek(els.peekCard, el, e);
  };
  tree.attach();
  els.hoverCard.querySelector("#hc-open").addEventListener("click", () => {
    const id = els.hoverCard.dataset.id;
    if (id) openDetail(id);
  });
  // 预览卡里的标题也可点进详情（都是真实新闻，命中 openDetail 的同一条路径）
  els.peekCard.querySelector("#pk-list").addEventListener("click", (e) => {
    const li = e.target.closest?.(".pk-item");
    const id = li?.dataset.id;
    if (id) { hidePeek(); openDetail(id); }
  });

  // 显示方式（新闻树 / 新闻列表 / 热榜）
  els.dock.querySelectorAll(".dock-btn").forEach((b) => {
    b.addEventListener("click", () => {
      const m = b.dataset.mode;
      if (m === state.mode) return;
      state.mode = m;
      save();
      syncDock();
      showMainView();
      renderCurrent();
      if (m === "tree") requestAnimationFrame(() => requestAnimationFrame(() => tree.fit(true)));
    });
  });

  // 左侧面板折叠 / 展开
  els.dockCollapse.addEventListener("click", () => {
    state.dockOpen = false;
    save();
    setDockState();
  });
  els.dockReopen.addEventListener("click", () => {
    state.dockOpen = true;
    save();
    setDockState();
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

  // 列表 / 热榜点击与键盘（列表=卡片 ncard，热榜=榜单行 board-row）
  const openFrom = (container, selector) => {
    container.addEventListener("click", (e) => {
      const c = e.target.closest(selector);
      if (c) openDetail(c.dataset.id);
    });
    container.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        const c = e.target.closest(selector);
        if (c) {
          e.preventDefault();
          openDetail(c.dataset.id);
        }
      }
    });
  };
  openFrom(els.newsList, ".ncard[data-id]");
  openFrom(els.boardList, ".row-item[data-id]");

  // 列表来源区域里的「进入新闻树」（与点卡片进详情语义不同）
  els.newsList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-enter-source]");
    if (btn) {
      e.stopPropagation();
      goSource(btn.dataset.enterSource);
    }
  });

  // 来源页「返回全部新闻源」
  els.sourceBack.addEventListener("click", () => {
    if (history.state?.view === "source") history.back();
    else goMain();
  });

  // 热榜平台筛选
  els.boardPlats.addEventListener("click", (e) => {
    const chip = e.target.closest(".plat-chip");
    if (!chip) return;
    state.plat = chip.dataset.plat;
    save();
    renderBoard();
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

  // 刷新（请求期间 disabled；服务端 60 秒内不重复全量抓取）
  els.refresh.addEventListener("click", async () => {
    if (els.refresh.disabled) return;
    els.refresh.disabled = true;
    els.refresh.classList.add("spinning");
    els.refresh.setAttribute("aria-busy", "true");
    try {
      if (!location.pathname.startsWith("/detail/")) {
        await initData({ force: true });
        const st = getState();
        if (st.errors?.length && !st.items.length) toast("更新失败：" + (st.errors[0]?.message || "未知错误"), "err");
        else if (st.throttled) toast("刚刷新过，60 秒内不重复抓取", "warn");
        else if (st.warming) toast("正在更新，稍后自动出现", "warn");
        else toast(`已更新 · ${st.items.length} 条`, "ok");
      } else {
        const id = location.pathname.split("/").pop();
        await initData({ force: true });
        await openDetail(id, { push: false });
        toast("已更新", "ok");
      }
    } finally {
      els.refresh.disabled = false;
      els.refresh.classList.remove("spinning");
      els.refresh.removeAttribute("aria-busy");
    }
  });

  // 浏览器前进 / 后退：三条路由都要能恢复
  window.addEventListener("popstate", () => {
    const r = parseRoute();
    if (r.view === "detail") {
      openDetail(r.id, { push: false });
      return;
    }
    if (r.view === "source") {
      const name = resolveSource(r.key, state.items);
      if (name) {
        state.source = name;
        if (state.mode !== "tree") { state.mode = "tree"; save(); }
        showMainView();
        syncDock();
        renderCurrent();
        document.title = `${name} · 独立新闻树 — 新闻树`;
        requestAnimationFrame(() => requestAnimationFrame(() => tree.fit(true)));
        return;
      }
      toast(`找不到新闻源「${r.key}」`, "warn");
    }
    // 首页
    state.source = null;
    showMainView();
    syncDock();
    renderCurrent();
    document.title = "新闻树 · News Tree";
    if (state.mode === "tree") requestAnimationFrame(() => requestAnimationFrame(() => tree.fit(true)));
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

  // DAY / NIGHT 环境切换（底部控制条）—— 与设置面板共用同一份 theme 状态
  els.envBtns.forEach((b) => {
    b.addEventListener("click", () => {
      if (state.bg.theme === b.dataset.env) return;
      state.bg.theme = b.dataset.env;
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

  // 允许用 URL 直接指定**布局模式**（与颜色环境正交）：?mode=tree|list|board
  // 用途：人工审查时给出「同一环境 × 三种布局」的直达链接（Stage 3.5 §10）。
  // 注意：**不写回 localStorage** —— URL 参数只对本次加载生效，
  // 否则审查完 ?mode=board 之后，下一次打开首页会莫名其妙停在热榜。
  try {
    const q = new URLSearchParams(location.search);
    const m = q.get("mode");
    if (m && ["tree", "list", "board"].includes(m)) state.mode = m;
  } catch {}

  const route = parseRoute();

  // ① 先用 localStorage 里的上一批数据立即渲染，消除白屏
  const cached = loadCache();
  if (cached) {
    state.items = getState().items;
    state.data = buildSourceModel(state.items);
    if (route.view === "source") state.source = resolveSource(route.key, state.items);
    renderCatBar();
    setStatus();
  }

  // ② 详情路由：沿用现有详情链路，不改动
  if (route.view === "detail") {
    showDetail();
    await initData();
    await openDetail(route.id, { push: false });
    return;
  }

  showMainView();
  syncDock();
  // 没有本地缓存 → 显示骨架；有缓存 → 直接显示内容
  setSkeleton(!cached);
  renderCurrent();
  if (cached && state.mode === "tree") requestAnimationFrame(() => tree.fit());

  // ③ 后台请求最新数据
  await initData();
  setSkeleton(false);

  // ④ 来源路由：数据就绪后解析来源名（直接访问 / 刷新都要能恢复）
  if (route.view === "source") {
    const name = resolveSource(route.key, state.items);
    if (name) {
      state.source = name;
      if (state.mode !== "tree") {
        state.mode = "tree";
        save();
      }
      showMainView();
      syncDock();
      renderCurrent();
      document.title = `${name} · 独立新闻树 — 新闻树`;
    } else {
      toast(`找不到新闻源「${route.key}」`, "warn");
    }
  }

  if (state.mode === "tree") requestAnimationFrame(() => requestAnimationFrame(() => tree.fit(true)));
})();

// 便于调试 / 自检
window.__newsTree = {
  state: () => ({
    mode: state.mode, cat: state.cat, sort: state.sort,
    source: state.source, items: state.items.length, sources: state.data?.length
  }),
  route: () => parseRoute(),
  goSource,
  goMain,
  tree
};
