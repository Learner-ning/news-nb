// 列表模式 + 详情视图 + 悬停卡：与树模式共用同一份真实数据与跳转逻辑
import { esc, timeAgo, fmtFull } from "./helpers.js";

const SKELETON = '<div class="skeleton"></div>'.repeat(4);

export function renderList(container, items, catName) {
  if (!items.length) {
    container.innerHTML = '<div class="card empty">暂时没有新闻，请稍后刷新。</div>';
    return;
  }
  // 同数据源按来源分组显示
  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.source)) groups.set(it.source, []);
    groups.get(it.source).push(it);
  }
  container.innerHTML = [...groups.entries()]
    .map(([source, list]) => `
      <section class="lg">
        <h3 class="lg-name">${esc(source)}<span class="lg-count">${list.length}</span></h3>
        <div class="lg-cards">
          ${list.map((x) => card(x)).join("")}
        </div>
      </section>`)
    .join("");
}

function card(x) {
  return `
  <article class="card" data-id="${esc(x.id)}" role="button" tabindex="0">
    <div class="tag">${esc(x.tag)} · ${esc(x.source)}</div>
    <div class="title">${esc(x.title)}</div>
    <div class="summary">${esc(x.summary || "")}</div>
    <div class="foot"><span>${timeAgo(x.time)}</span><span class="go">查看详情 →</span></div>
  </article>`;
}

export function renderListMeta(elm, items) {
  elm.textContent = `${items.length} 条新闻`;
}

// ---------- 详情 ----------
export function showDetailSkeleton(container) {
  container.innerHTML = `<div class="skeleton detail-skeleton"></div>`;
}

export function showDetailError(container, onBack) {
  container.innerHTML = `
    <div class="detail-error">
      <p>新闻不存在或已过期。</p>
      <button class="btn-secondary" type="button" id="back-from-error">返回列表</button>
    </div>`;
  container.querySelector("#back-from-error")?.addEventListener("click", onBack);
}

export function renderDetail(container, item) {
  const content = item.content || item.summary || "暂无详细内容，请点击下方按钮阅读原文。";
  container.innerHTML = `
    <div class="detail-tag">${esc(item.tag)} · ${esc(item.source)}</div>
    <h1 class="detail-title">${esc(item.title)}</h1>
    <div class="detail-meta">
      <span>${timeAgo(item.time)}</span>
      <span>${fmtFull(item.time)}</span>
    </div>
    <div class="detail-body">${esc(content)}</div>
    <div class="detail-actions">
      <a class="btn-primary" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">阅读原文 ↗</a>
      <button class="btn-secondary" type="button" id="share-btn">复制链接</button>
    </div>`;
  const share = container.querySelector("#share-btn");
  share?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(item.url);
      share.textContent = "已复制 ✓";
      setTimeout(() => (share.textContent = "复制链接"), 1800);
    } catch {
      share.textContent = "复制失败";
    }
  });
}

// ---------- 悬停信息卡（跟随在叶片附近，不占屏幕中央） ----------
export function fillHoverCard(cardEl, item) {
  const byId = (id) => cardEl.querySelector("#" + id);
  byId("hc-chip").textContent = `${item.tag} · ${item.source}`;
  byId("hc-time").textContent = timeAgo(item.time);
  byId("hc-title").textContent = item.title;
  byId("hc-summary").textContent = (item.summary || "").slice(0, 90);
}

export function positionHoverCard(cardEl, evt) {
  const pad = 16;
  const m = 12;
  const cw = cardEl.offsetWidth, ch = cardEl.offsetHeight;
  let x = evt.clientX + m, y = evt.clientY + m;
  if (x + cw > innerWidth - pad) x = evt.clientX - cw - m;
  if (y + ch > innerHeight - pad) y = evt.clientY - ch - m;
  cardEl.style.left = x + "px";
  cardEl.style.top = y + "px";
}
