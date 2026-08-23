const newsEl = document.querySelector("#news");
const meta = document.querySelector("#meta");
const viewList = document.querySelector("#view-list");
const viewTree = document.querySelector("#view-tree");
const viewDetail = document.querySelector("#view-detail");
const detailContent = document.querySelector("#detail-content");
const backBtn = document.querySelector("#back-btn");
const brand = document.querySelector("#brand");
const refreshBtn = document.querySelector("#refresh");
const treeEl = document.querySelector("#tree");
const treeMeta = document.querySelector("#tree-meta");
const viewHead = document.querySelector("#view-head");
const liveStatus = document.querySelector("#live-status");
const app = document.querySelector("#app");
const viewSwitch = document.querySelector("#view-switch");
const treeStage = document.querySelector("#tree-stage");
const treeSvg = document.querySelector("#tree-svg");
const newsPanel = document.querySelector("#news-panel");
const panelTitle = document.querySelector("#panel-title");
const panelBody = document.querySelector("#panel-body");
const panelClose = document.querySelector("#panel-close");

// 当前聚焦点：整棵树 / 一个分类枝干 / 一个厂家枝叶
let mode = { type: "all" };
let treeData = [];
let cache = [];

// 视图与显示方式状态
let currentView = "tree"; // "tree" | "list"
let displayMode = "pin"; // "pin" 固定显示 | "hover" 悬停显示
let pinnedKey = null; // "s:<sourceId>" | "c:<catId>"，点击固定的目标
let hoverKey = null; // 当前鼠标悬停的枝叶
let panelTimer = null;
const panelCache = {}; // key -> 新闻数组

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}

function timeAgo(t) {
  if (!t) return "";
  const d = Date.now() - new Date(t).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return m + " 分钟前";
  if (m < 1440) return Math.floor(m / 60) + " 小时前";
  return Math.floor(m / 1440) + " 天前";
}

function formatFullTime(t) {
  if (!t) return "";
  try {
    return new Date(t).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "";
  }
}

/* ---------- 视图切换 ---------- */

function setViewButtons() {
  viewSwitch.querySelectorAll(".vs-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === currentView);
  });
}

function switchView(v) {
  currentView = v;
  viewTree.classList.toggle("hidden", v !== "tree");
  viewList.classList.toggle("hidden", v !== "list");
  app.classList.toggle("tree-mode", v === "tree");
  setViewButtons();
  document.title = "新闻知识树 — 多厂家新闻聚合";
  if (v === "tree") {
    if (treeData.length && !treeSvg.querySelector(".leaf-node")) buildTreeSvg(treeData);
  } else if (v === "list") {
    if (!newsEl.children.length) load();
  }
  try { localStorage.setItem("newsView", v); } catch {}
}

function showCurrentView() {
  viewDetail.classList.add("hidden");
  switchView(currentView);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showDetail() {
  viewTree.classList.add("hidden");
  viewList.classList.add("hidden");
  viewDetail.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function findCategory(id) {
  return (treeData || []).find((c) => c.id === id) || null;
}

function findSource(id) {
  for (const c of treeData || []) {
    const s = c.sources.find((x) => x.id === id);
    if (s) return s;
  }
  return null;
}

/* ---------- 侧栏树渲染（列表视图） ---------- */

function renderTree() {
  const parts = [];
  const rootActive = mode.type === "all";

  parts.push(
    '<button class="tree-node tree-root' +
      (rootActive ? " active" : "") +
      '" data-mode="root">🌳 全部新闻</button>'
  );

  for (const cat of treeData) {
    const catActive = mode.type === "category" && mode.id === cat.id;
    const srcActive = mode.type === "source" && cat.sources.some((s) => s.id === mode.id);
    const open = mode.type === "all" || catActive || srcActive;

    parts.push('<div class="tree-branch' + (open ? " open" : "") + '">');
    parts.push('<div class="tree-cat-row">');
    parts.push(
      '<button class="tree-caret" data-caret="' +
        esc(cat.id) +
        '" aria-label="展开或收起">▸</button>'
    );
    parts.push(
      '<button class="tree-cat' +
        (catActive ? " active" : "") +
        '" data-category="' +
        esc(cat.id) +
        '"><span class="tree-icon">' +
        esc(cat.icon) +
        "</span>" +
        esc(cat.name) +
        "<small>" +
        cat.sources.length +
        "</small></button>"
    );
    parts.push('</div><div class="tree-leaves">');

    for (const s of cat.sources) {
      const dot = s.ok ? "ok" : s.stale ? "stale" : "bad";
      parts.push(
        '<button class="tree-leaf' +
          (mode.type === "source" && mode.id === s.id ? " active" : "") +
          '" data-source="' +
          esc(s.id) +
          '"><i class="dot ' +
          dot +
          '"></i>' +
          esc(s.name) +
          "<small>" +
          s.count +
          "</small></button>"
      );
    }
    parts.push("</div></div>");
  }

  treeEl.innerHTML = parts.join("");
}

async function loadTree() {
  try {
    const r = await fetch("/api/sources");
    const d = await r.json();
    treeData = d.tree || [];
    const totalSources = treeData.reduce((n, c) => n + c.sources.length, 0);
    treeMeta.textContent =
      treeData.length + " 个枝干（分类） · " + totalSources + " 个枝叶（厂家）";
    renderTree();
    buildTreeSvg(treeData);
  } catch {
    treeMeta.textContent = "树枝加载失败，请稍后刷新。";
  }
}

/* ---------- 中央大树（SVG） ---------- */

const TREE_TOP = { x: 520, y: 470 };
const BRANCH_COLORS = ["#3e7d4a", "#3568a8", "#b07a2c", "#a0553f"];

function bezierPoint(p0, c, p1, t) {
  const a = (1 - t) * (1 - t);
  const b = 2 * (1 - t) * t;
  const d = t * t;
  return {
    x: a * p0.x + b * c.x + d * p1.x,
    y: a * p0.y + b * c.y + d * p1.y
  };
}

function bezierTangent(p0, c, p1, t) {
  return {
    x: 2 * (1 - t) * (c.x - p0.x) + 2 * t * (p1.x - c.x),
    y: 2 * (1 - t) * (c.y - p0.y) + 2 * t * (p1.y - c.y)
  };
}

function buildTreeSvg(cats) {
  if (!cats || !cats.length) {
    treeSvg.innerHTML =
      '<text x="520" y="320" text-anchor="middle" class="svg-loading">树枝加载失败，请刷新重试</text>';
    return;
  }
  const parts = [];

  // 树干 + 地面
  parts.push('<ellipse class="ground" cx="520" cy="643" rx="135" ry="11"></ellipse>');
  parts.push(
    '<path class="trunk" d="M 492 643 C 496 560 502 505 511 470 L 529 470 C 538 505 544 560 548 643 Z"></path>'
  );

  const n = cats.length;
  cats.forEach((cat, ci) => {
    const count = cat.sources.length;
    const L = 215 + count * 22;
    const deg = -60 + (ci * 120) / Math.max(n - 1, 1);
    const rad = (deg * Math.PI) / 180;
    const dir = { x: Math.sin(rad), y: -Math.cos(rad) };
    const tip = { x: TREE_TOP.x + dir.x * L, y: TREE_TOP.y + dir.y * L };
    const ctrl = { x: TREE_TOP.x + dir.x * L * 0.55, y: TREE_TOP.y + dir.y * L * 0.68 - 18 };
    const color = cat.color || BRANCH_COLORS[ci % BRANCH_COLORS.length];
    const d =
      "M " + TREE_TOP.x + " " + TREE_TOP.y +
      " C " + ctrl.x + " " + ctrl.y + " " + tip.x + " " + tip.y + " " + tip.x + " " + tip.y;

    parts.push('<g class="branch" data-cat="' + esc(cat.id) + '" role="button" tabindex="0" aria-label="' + esc(cat.name) + '分类新闻">');
    parts.push('<path class="branch-line halo" d="' + d + '"></path>');
    parts.push('<path class="branch-line" d="' + d + '" stroke="' + color + '"></path>');
    parts.push('<circle class="bud" cx="' + tip.x + '" cy="' + tip.y + '" r="8" fill="' + color + '"></circle>');
    parts.push(
      '<text class="branch-label" x="' +
        Math.round(tip.x + dir.x * 34) +
        '" y="' +
        Math.round(tip.y + dir.y * 34 + 5) +
        '" text-anchor="middle">' +
        esc(cat.name) +
        "</text>"
    );

    cat.sources.forEach((s, k) => {
      const t = Math.min(0.32 + k * 0.16, 0.9);
      const P = bezierPoint(TREE_TOP, ctrl, tip, t);
      const Tn = bezierTangent(TREE_TOP, ctrl, tip, t);
      const tl = Math.hypot(Tn.x, Tn.y) || 1;
      const ux = Tn.x / tl;
      const uy = Tn.y / tl;
      const side = k % 2 === 0 ? 1 : -1;
      const off = 30 + Math.floor(k / 2) * 24;
      const px = P.x + -uy * side * off;
      const py = P.y + ux * side * off;
      let ang = Math.round((Math.atan2(uy, ux) * 180) / Math.PI);
      if (ang > 40) ang = 40;
      if (ang < -40) ang = -40;
      const dot = s.ok ? "ok" : s.stale ? "stale" : "bad";
      parts.push(
        '<g class="leaf-wrap" transform="translate(' +
          Math.round(px) +
          " " +
          Math.round(py) +
          ") rotate(" +
          ang +
          ')">'
      );
      parts.push(
        '<g class="leaf-node" data-src="' +
          esc(s.id) +
          '" tabindex="0" role="button" aria-label="' +
          esc(s.name) +
          '新闻" style="animation-delay:' +
          (ci * 0.12 + k * 0.06).toFixed(2) +
          's">'
      );
      parts.push('<circle class="leaf-hit" r="38"></circle>');
      parts.push(
        '<rect class="leaf-chip" x="-40" y="-15" width="80" height="30" rx="15" fill="' +
          esc(s.color || color) +
          '"></rect>'
      );
      parts.push('<text class="leaf-label" x="0" y="4.5" text-anchor="middle">' + esc(s.name) + "</text>");
      parts.push('<circle class="leaf-dot ' + dot + '" cx="36" cy="-10" r="4"></circle>');
      parts.push("</g></g>");
    });

    parts.push("</g>");
  });

  treeSvg.innerHTML = parts.join("");
}

/* ---------- 枝叶新闻面板 ---------- */

function panelKeyParts(key) {
  const i = key.indexOf(":");
  return { kind: key.slice(0, i), id: key.slice(i + 1) };
}

function pItemHTML(x) {
  return (
    '<article class="p-item" data-id="' +
    esc(x.id) +
    '" role="button" tabindex="0"><div class="p-tag" style="color:' +
    esc(x.color || "#777") +
    '">' +
    esc(x.categoryName || x.category || "") +
    " · " +
    timeAgo(x.time) +
    '</div><div class="p-title">' +
    esc(x.title) +
    '</div><div class="p-sum">' +
    esc(x.summary) +
    "</div></article>"
  );
}

function renderPanelItems(key, items) {
  if (pinnedKey !== key && hoverKey !== key) return; // 过期响应
  if (!items.length) {
    panelBody.innerHTML = '<div class="p-empty">这片枝叶暂时没有可用新闻。</div>';
    return;
  }
  panelBody.innerHTML =
    items.slice(0, 15).map(pItemHTML).join("") + '<div class="p-note">点击新闻卡片可查看详情</div>';
}

async function fetchPanel(key, id, isSrc) {
  try {
    const q = isSrc
      ? "source=" + encodeURIComponent(id)
      : "category=" + encodeURIComponent(id);
    const r = await fetch("/api/news?" + q);
    const d = await r.json();
    const items = d.items || [];
    panelCache[key] = items;
    if (pinnedKey === key || hoverKey === key) renderPanelItems(key, items);
  } catch {
    if (pinnedKey === key || hoverKey === key) {
      panelBody.innerHTML = '<div class="p-empty">该枝叶暂时无法获取新闻，请稍后刷新。</div>';
    }
  }
}

function showPanel(key) {
  const { kind, id } = panelKeyParts(key);
  const isSrc = kind === "s";
  const obj = isSrc ? findSource(id) : findCategory(id);
  if (!obj) return;

  treeSvg.querySelectorAll(".leaf-node.active").forEach((nd) => nd.classList.remove("active"));
  if (isSrc) {
    const nd = treeSvg.querySelector('.leaf-node[data-src="' + id + '"]');
    if (nd) nd.classList.add("active");
  }

  const sub = isSrc
    ? obj.categoryName + (obj.note ? " · " + obj.note : "")
    : obj.description || "该枝干下所有厂家的新闻";
  panelTitle.innerHTML =
    '<span class="pt-name">' + esc(obj.icon) + " " + esc(obj.name) + '</span><span class="pt-sub">' + esc(sub) + "</span>";

  newsPanel.classList.add("open");
  if (panelCache[key]) {
    renderPanelItems(key, panelCache[key]);
  } else {
    panelBody.innerHTML = '<div class="p-skel skeleton"></div><div class="p-skel skeleton"></div><div class="p-skel skeleton"></div>';
    fetchPanel(key, id, isSrc);
  }
}

function hidePanel() {
  if (panelTimer) {
    clearTimeout(panelTimer);
    panelTimer = null;
  }
  pinnedKey = null;
  hoverKey = null;
  newsPanel.classList.remove("open");
  treeSvg.querySelectorAll(".leaf-node.active").forEach((nd) => nd.classList.remove("active"));
}

/* ---------- 中央大树交互 ---------- */

treeStage.addEventListener("mouseover", (e) => {
  const leaf = e.target.closest(".leaf-node");
  if (!leaf) return;
  const key = "s:" + leaf.dataset.src;
  if (hoverKey === key && !panelTimer) return;
  hoverKey = key;
  if (panelTimer) {
    clearTimeout(panelTimer);
    panelTimer = null;
  }
  if (!pinnedKey) showPanel(key);
});

treeStage.addEventListener("mouseout", (e) => {
  const leaf = e.target.closest(".leaf-node");
  if (!leaf) return;
  if (leaf.contains(e.relatedTarget)) return;
  hoverKey = null;
  if (displayMode === "hover" && !pinnedKey) {
    if (panelTimer) clearTimeout(panelTimer);
    panelTimer = setTimeout(hidePanel, 350);
  }
});

treeStage.addEventListener("click", (e) => {
  const leaf = e.target.closest(".leaf-node");
  if (leaf) {
    pinnedKey = "s:" + leaf.dataset.src;
    hoverKey = null;
    showPanel(pinnedKey);
    return;
  }
  const br = e.target.closest(".branch");
  if (br) {
    pinnedKey = "c:" + br.dataset.cat;
    hoverKey = null;
    showPanel(pinnedKey);
  }
});

treeStage.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    const leaf = e.target.closest(".leaf-node");
    if (leaf) {
      e.preventDefault();
      pinnedKey = "s:" + leaf.dataset.src;
      showPanel(pinnedKey);
      return;
    }
    const br = e.target.closest(".branch");
    if (br) {
      e.preventDefault();
      pinnedKey = "c:" + br.dataset.cat;
      showPanel(pinnedKey);
    }
  }
});

newsPanel.addEventListener("mouseenter", () => {
  if (panelTimer) {
    clearTimeout(panelTimer);
    panelTimer = null;
  }
});

newsPanel.addEventListener("mouseleave", () => {
  if (displayMode === "hover" && !pinnedKey) {
    if (panelTimer) clearTimeout(panelTimer);
    panelTimer = setTimeout(hidePanel, 300);
  }
});

panelClose.addEventListener("click", hidePanel);

panelBody.addEventListener("click", (e) => {
  const item = e.target.closest(".p-item[data-id]");
  if (item) openDetail(item.dataset.id);
});

panelBody.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    const item = e.target.closest(".p-item[data-id]");
    if (item) {
      e.preventDefault();
      openDetail(item.dataset.id);
    }
  }
});

/* ---------- 右下角显示方式 ---------- */

function setModeButtons() {
  document.querySelectorAll(".mode-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === displayMode);
  });
}

document.querySelectorAll(".mode-btn").forEach((b) => {
  b.addEventListener("click", () => {
    displayMode = b.dataset.mode;
    try { localStorage.setItem("newsDisplayMode", displayMode); } catch {}
    setModeButtons();
    if (displayMode === "hover" && !pinnedKey && !hoverKey) hidePanel();
  });
});

/* ---------- 列表渲染 ---------- */

function cardHTML(x) {
  return (
    '<article class="card" data-id="' +
    esc(x.id) +
    '" role="button" tabindex="0"><div><div class="tag" style="color:' +
    esc(x.color || "#777") +
    '">' +
    esc(x.categoryName || x.category || "") +
    " · " +
    esc(x.source) +
    '</div><div class="title">' +
    esc(x.title) +
    '</div><div class="summary">' +
    esc(x.summary) +
    '</div></div><div class="foot"><span>' +
    timeAgo(x.time) +
    '</span><span class="go">查看详情 →</span></div></article>'
  );
}

function moduleHTML(src, items, open) {
  const dot = src.ok ? "ok" : src.stale ? "stale" : "bad";
  const body = items.length
    ? items.map(cardHTML).join("")
    : '<div class="card empty">该厂家的枝叶暂时没有可用新闻。</div>';
  return (
    '<div class="vendor-head" role="button" tabindex="0" aria-expanded="' +
    (open ? "true" : "false") +
    '"><span class="vendor-dot ' +
    dot +
    '"></span><span class="vendor-name">' +
    esc(src.name) +
    '</span><span class="vendor-count">' +
    items.length +
    ' 条</span><span class="vendor-caret">' +
    (open ? "▾" : "▸") +
    '</span></div><div class="vendor-body"' +
    (open ? "" : " hidden") +
    '">' +
    body +
    "</div>"
  );
}

function viewTitle() {
  if (mode.type === "source") {
    const s = findSource(mode.id);
    return {
      icon: (s && s.icon) || "🌿",
      name: (s && s.name) || "新闻",
      desc: s ? s.categoryName + " · " + (s.note || "") : ""
    };
  }
  if (mode.type === "category") {
    const c = findCategory(mode.id);
    return {
      icon: (c && c.icon) || "🌿",
      name: (c && c.name) || "分类",
      desc: (c && c.description) || ""
    };
  }
  return { icon: "🌳", name: "全部新闻", desc: "所有枝干、所有厂家的最新新闻" };
}

function renderNews(items) {
  const parts = [];

  if (mode.type === "source") {
    const s = findSource(mode.id);
    if (s) {
      parts.push(
        '<article class="vendor-module open" data-source="' +
          esc(s.id) +
          '">' +
          moduleHTML(s, items, true) +
          "</article>"
      );
    }
  } else {
    const cats = mode.type === "category" ? treeData.filter((c) => c.id === mode.id) : treeData;
    for (const cat of cats) {
      const groups = cat.sources.map((s) => ({
        src: s,
        items: items.filter((i) => i.sourceId === s.id)
      }));
      const total = groups.reduce((n, g) => n + g.items.length, 0);

      parts.push('<section class="branch">');
      parts.push(
        '<h3 class="branch-title"><span class="branch-icon">' +
          esc(cat.icon) +
          "</span>" +
          esc(cat.name) +
          "<small>" +
          total +
          " 条</small></h3>"
      );
      groups.forEach((g, idx) => {
        parts.push(
          '<article class="vendor-module' +
            (idx === 0 ? " open" : "") +
            '" data-source="' +
            esc(g.src.id) +
            '">' +
            moduleHTML(g.src, g.items, idx === 0) +
            "</article>"
        );
      });
      parts.push("</section>");
    }
  }

  newsEl.innerHTML =
    parts.join("") || '<div class="card empty">暂时没有新闻，请稍后再试。</div>';
}

async function load() {
  newsEl.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join("");

  const q = new URLSearchParams();
  if (mode.type === "category") q.set("category", mode.id);
  else if (mode.type === "source") q.set("source", mode.id);

  try {
    const r = await fetch("/api/news?" + q.toString());
    const d = await r.json();
    cache = d.items || [];

    const t = viewTitle();
    viewHead.innerHTML =
      '<h2 class="view-title">' + esc(t.icon) + " " + esc(t.name) + '</h2><p class="view-desc">' + esc(t.desc) + "</p>";

    const updated = new Date(d.updatedAt).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit"
    });
    let metaHtml = cache.length + " 条新闻 · " + updated + " 更新";
    if (d.failed && d.failed.length) {
      metaHtml += ' · <span class="warn">' + d.failed.length + " 个厂家暂时休眠</span>";
    }
    meta.innerHTML = metaHtml;
    liveStatus.innerHTML = "<i></i> LIVE · 实时生长";

    renderNews(cache);
  } catch {
    meta.textContent = "加载失败";
    newsEl.innerHTML = '<div class="card empty">新闻源暂时不可用，请稍后刷新。</div>';
  }
}

/* ---------- 详情 ---------- */

function renderDetail(item) {
  const content = item.content || item.summary || "暂无详细内容，请点击下方按钮阅读原文。";
  detailContent.innerHTML =
    '<div class="detail-tag" style="color:' +
    esc(item.color || "#777") +
    '">' +
    esc(item.categoryName || item.category || "") +
    " · " +
    esc(item.source) +
    '</div><h1 class="detail-title">' +
    esc(item.title) +
    '</h1><div class="detail-meta"><span>' +
    timeAgo(item.time) +
    "</span><span>" +
    formatFullTime(item.time) +
    '</span></div><div class="detail-body">' +
    esc(content) +
    '</div><div class="detail-actions"><a class="btn-primary" href="' +
    esc(item.url) +
    '" target="_blank" rel="noopener noreferrer">阅读原文 ↗</a><button class="btn-secondary" id="share-btn">复制链接</button></div>';

  document.title = item.title + " — 新闻知识树";

  const shareBtn = document.querySelector("#share-btn");
  if (shareBtn) {
    shareBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(item.url);
        shareBtn.textContent = "已复制 ✓";
        setTimeout(() => (shareBtn.textContent = "复制链接"), 1800);
      } catch {
        shareBtn.textContent = "复制失败";
      }
    };
  }
}

async function openDetail(id) {
  showDetail();
  detailContent.innerHTML = '<div class="skeleton detail-skeleton"></div>';

  let item = cache.find((x) => x.id === id);
  if (!item) {
    try {
      const r = await fetch("/api/news/" + encodeURIComponent(id));
      if (!r.ok) throw new Error("not found");
      item = await r.json();
    } catch {
      detailContent.innerHTML =
        '<div class="detail-error"><p>新闻不存在或已过期。</p><button class="btn-secondary" id="back-from-error">返回</button></div>';
      document.querySelector("#back-from-error")?.addEventListener("click", () => {
        history.pushState(null, "", "/");
        showCurrentView();
      });
      return;
    }
  }

  renderDetail(item);
  history.pushState({ view: "detail", id }, "", "/detail/" + id);
}

/* ---------- 列表交互 ---------- */

function toggleModule(head) {
  const mod = head.closest(".vendor-module");
  if (!mod) return;
  const body = mod.querySelector(".vendor-body");
  const caret = head.querySelector(".vendor-caret");
  const open = body.classList.toggle("hidden") === false;
  head.setAttribute("aria-expanded", open ? "true" : "false");
  if (caret) caret.textContent = open ? "▾" : "▸";
}

function select() {
  renderTree();
  load();
}

treeEl.addEventListener("click", (e) => {
  const caret = e.target.closest("[data-caret]");
  if (caret) {
    caret.closest(".tree-branch").classList.toggle("open");
    return;
  }
  const root = e.target.closest('[data-mode="root"]');
  if (root) {
    mode = { type: "all" };
    select();
    return;
  }
  const cat = e.target.closest("[data-category]");
  if (cat) {
    mode = { type: "category", id: cat.dataset.category };
    select();
    return;
  }
  const leaf = e.target.closest("[data-source]");
  if (leaf) {
    mode = { type: "source", id: leaf.dataset.source };
    select();
  }
});

newsEl.addEventListener("click", (e) => {
  const head = e.target.closest(".vendor-head");
  if (head) {
    toggleModule(head);
    return;
  }
  const card = e.target.closest(".card[data-id]");
  if (card) openDetail(card.dataset.id);
});

newsEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    const head = e.target.closest(".vendor-head");
    if (head) {
      e.preventDefault();
      toggleModule(head);
      return;
    }
    const card = e.target.closest(".card[data-id]");
    if (card) {
      e.preventDefault();
      openDetail(card.dataset.id);
    }
  }
});

/* ---------- 顶栏与全局 ---------- */

viewSwitch.addEventListener("click", (e) => {
  const btn = e.target.closest(".vs-btn");
  if (btn && btn.dataset.view !== currentView) switchView(btn.dataset.view);
});

backBtn.addEventListener("click", () => {
  history.pushState(null, "", "/");
  showCurrentView();
});

brand.addEventListener("click", () => {
  mode = { type: "all" };
  currentView = "tree";
  history.pushState(null, "", "/");
  showCurrentView();
  loadTree();
});

refreshBtn.addEventListener("click", () => {
  if (!viewDetail.classList.contains("hidden")) {
    const id = location.pathname.split("/").pop();
    if (id) openDetail(id);
    return;
  }
  loadTree();
  if (currentView === "list") load();
  if (pinnedKey) {
    delete panelCache[pinnedKey];
    showPanel(pinnedKey);
  } else if (hoverKey) {
    delete panelCache[hoverKey];
    showPanel(hoverKey);
  }
});

window.addEventListener("popstate", () => {
  const match = location.pathname.match(/^\/detail\/([a-z0-9]+)$/i);
  if (match) {
    openDetail(match[1]);
  } else {
    showCurrentView();
  }
});

(function init() {
  let savedView = "tree";
  try { savedView = localStorage.getItem("newsView") || "tree"; } catch {}
  currentView = savedView === "list" ? "list" : "tree";
  try { displayMode = localStorage.getItem("newsDisplayMode") || "pin"; } catch {}
  setModeButtons();

  const match = location.pathname.match(/^\/detail\/([a-z0-9]+)$/i);
  if (match) {
    openDetail(match[1]);
  } else {
    switchView(currentView);
    loadTree();
    if (currentView === "list") load();
  }
})();