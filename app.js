const newsEl = document.querySelector("#news");
const meta = document.querySelector("#meta");
const viewList = document.querySelector("#view-list");
const viewDetail = document.querySelector("#view-detail");
const detailContent = document.querySelector("#detail-content");
const backBtn = document.querySelector("#back-btn");
const brand = document.querySelector("#brand");
const refreshBtn = document.querySelector("#refresh");

let current = "all";
let cache = []; // 缓存当前列表，方便详情页快速展示

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}

function timeAgo(t) {
  if (!t) return "";
  const d = Date.now() - new Date(t).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  if (m < 1440) return `${Math.floor(m / 60)} 小时前`;
  return `${Math.floor(m / 1440)} 天前`;
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

function showList() {
  viewList.classList.remove("hidden");
  viewDetail.classList.add("hidden");
  document.title = "NOW — 实时新闻";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showDetail() {
  viewList.classList.add("hidden");
  viewDetail.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderDetail(item) {
  const content = item.content || item.summary || "暂无详细内容，请点击下方按钮阅读原文。";
  detailContent.innerHTML = `
    <div class="detail-tag">${esc(item.tag)} · ${esc(item.source)}</div>
    <h1 class="detail-title">${esc(item.title)}</h1>
    <div class="detail-meta">
      <span>${timeAgo(item.time)}</span>
      <span>${formatFullTime(item.time)}</span>
    </div>
    <div class="detail-body">${esc(content)}</div>
    <div class="detail-actions">
      <a class="btn-primary" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">阅读原文 ↗</a>
      <button class="btn-secondary" id="share-btn">复制链接</button>
    </div>
  `;
  document.title = `${item.title} — NOW`;

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
  detailContent.innerHTML = `<div class="skeleton detail-skeleton"></div>`;

  // 优先从缓存取
  let item = cache.find((x) => x.id === id);

  if (!item) {
    try {
      const r = await fetch("/api/news/" + encodeURIComponent(id));
      if (!r.ok) throw new Error("not found");
      item = await r.json();
    } catch {
      detailContent.innerHTML = `
        <div class="detail-error">
          <p>新闻不存在或已过期。</p>
          <button class="btn-secondary" id="back-from-error">返回列表</button>
        </div>
      `;
      document.querySelector("#back-from-error")?.addEventListener("click", () => {
        history.pushState(null, "", "/");
        showList();
      });
      return;
    }
  }

  renderDetail(item);
  history.pushState({ view: "detail", id }, "", `/detail/${id}`);
}

async function load() {
  newsEl.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join("");
  try {
    const r = await fetch("/api/news?source=" + encodeURIComponent(current));
    const d = await r.json();
    cache = d.items || [];
    meta.textContent = `${cache.length} 条新闻 · ${new Date(d.updatedAt).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit"
    })} 更新`;

    if (!cache.length) {
      newsEl.innerHTML = `<div class="card empty">暂时没有新闻，请稍后再试。</div>`;
      return;
    }

    newsEl.innerHTML = cache
      .map(
        (x) => `
      <article class="card" data-id="${esc(x.id)}" role="button" tabindex="0">
        <div>
          <div class="tag">${esc(x.tag)} · ${esc(x.source)}</div>
          <div class="title">${esc(x.title)}</div>
          <div class="summary">${esc(x.summary)}</div>
        </div>
        <div class="foot">
          <span>${timeAgo(x.time)}</span>
          <span class="go">查看详情 →</span>
        </div>
      </article>`
      )
      .join("");
  } catch (e) {
    meta.textContent = "加载失败";
    newsEl.innerHTML = `<div class="card empty">新闻源暂时不可用，请稍后刷新。</div>`;
  }
}

// 事件：点击卡片进入详情
newsEl.addEventListener("click", (e) => {
  const card = e.target.closest(".card[data-id]");
  if (card) openDetail(card.dataset.id);
});

newsEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    const card = e.target.closest(".card[data-id]");
    if (card) {
      e.preventDefault();
      openDetail(card.dataset.id);
    }
  }
});

// 筛选
document.querySelector("#filters").addEventListener("click", (e) => {
  if (e.target.matches("button")) {
    document.querySelectorAll(".filters button").forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");
    current = e.target.dataset.source;
    load();
  }
});

// 返回
backBtn.addEventListener("click", () => {
  history.pushState(null, "", "/");
  showList();
});

brand.addEventListener("click", () => {
  history.pushState(null, "", "/");
  showList();
  if (viewList.classList.contains("hidden") === false) load();
});

refreshBtn.addEventListener("click", () => {
  if (viewDetail.classList.contains("hidden")) load();
  else {
    const id = location.pathname.split("/").pop();
    if (id) openDetail(id);
  }
});

// 浏览器前进/后退
window.addEventListener("popstate", () => {
  const match = location.pathname.match(/^\/detail\/([a-z0-9]+)$/i);
  if (match) {
    openDetail(match[1]);
  } else {
    showList();
  }
});

// 首次加载：支持直接访问 /detail/:id
(function init() {
  const match = location.pathname.match(/^\/detail\/([a-z0-9]+)$/i);
  if (match) {
    openDetail(match[1]);
  } else {
    showList();
    load();
  }
})();
