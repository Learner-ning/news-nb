// 视图层：新闻卡片列表 / 平台分组热榜 / 详情 / 悬停卡
// 所有视图共用同一份真实数据与点击→详情跳转逻辑
import { esc, timeAgo, fmtFull, colorFor } from "./helpers.js";

function heatText(x) {
  const h = Math.round((x.heatScore || 0) * 100);
  return x.dupCount > 1 ? `热度 ${h}% · 多源×${x.dupCount}` : `热度 ${h}%`;
}

// ---------- 新闻卡片列表（统一卡片：仅标题 + 基础信息，不展示正文） ----------
function card(x) {
  return `
  <article class="ncard" data-id="${esc(x.id)}" role="button" tabindex="0">
    <div class="nc-line">
      <span class="nc-cat" style="--c:${colorFor(x.tag)}">${esc(x.tag)}</span>
      <span class="nc-src">${esc(x.source)}</span>
      <span class="nc-time">${timeAgo(x.time)}</span>
      ${x.hotRank ? `<span class="nc-hotrank">热榜#${x.hotRank}</span>` : ""}
    </div>
    <h3 class="nc-title">${esc(x.title)}</h3>
    <div class="nc-foot">
      <span class="nc-heat">🔥 ${heatText(x)}</span>
      <span class="nc-go">查看详情 →</span>
    </div>
  </article>`;
}

export function renderList(container, items) {
  if (!items.length) {
    container.innerHTML = '<div class="list-empty">暂时没有新闻，请稍后刷新。</div>';
    return;
  }
  container.innerHTML = items.map(card).join("");
}

export function renderListMeta(elm, items) {
  elm.textContent = `${items.length} 条`;
}

// ---------- 热榜：按平台分组 + 排名视觉层级 ----------
export function groupHotByPlatform(items) {
  const map = new Map();
  for (const it of items) {
    if (!it.platform) continue;
    if (!map.has(it.platform)) map.set(it.platform, []);
    map.get(it.platform).push(it);
  }
  return [...map.entries()].map(([platform, list]) => ({
    platform,
    items: list.sort((a, b) => (a.rank || 999) - (b.rank || 999))
  }));
}

function hotRow(x, i) {
  const heat = Math.round((x.heatScore || 0) * 100);
  const topCls = i < 3 ? ` top${i + 1}` : "";
  const extra = [
    x.hotTag ? `<span class="b-hot">${esc(x.hotTag)}</span>` : "",
    x.praise ? `<span class="b-hot">赞 ${x.praise}</span>` : "",
    x.discuss ? `<span class="b-hot">讨论 ${x.discuss}</span>` : ""
  ].join("");
  return `
  <article class="row-item board-row${topCls}" data-id="${esc(x.id)}" role="button" tabindex="0">
    <span class="b-rank${topCls}">${i + 1}</span>
    <span class="b-main">
      <span class="ri-title">${esc(x.title)}</span>
      <span class="b-meta">${esc(x.source)} · ${esc(x.tag)} · ${timeAgo(x.time)}${extra}</span>
    </span>
    <span class="b-heat"><i class="b-bar" style="--w:${heat}%"></i><b>${heat}</b></span>
  </article>`;
}

export function renderBoard(container, groups, { limit = 10, active = null } = {}) {
  if (!groups.length) {
    container.innerHTML = '<div class="list-empty">当前分类暂无热搜数据，可切换到「全部」分类，或稍后刷新。</div>';
    return;
  }
  const shown = active ? groups.filter((g) => g.platform === active) : groups;
  container.innerHTML = shown
    .map((g) => {
      const n = active ? Math.max(limit, 20) : limit;
      const rows = g.items.slice(0, n).map((x, i) => hotRow(x, i)).join("");
      return `
      <section class="lg hot-lg">
        <h3 class="lg-name hot-plat" style="--c:${colorFor(g.items[0]?.tag || "国内")}">
          <span>${esc(g.platform)}</span><span class="lg-count">Top${Math.min(g.items.length, n)}</span>
        </h3>
        <div class="hot-rows">${rows}</div>
      </section>`;
    })
    .join("");
}

export function setBoardMeta(elm, groups, hotCount) {
  elm.textContent = `${groups.length} 个平台 · ${hotCount} 条热搜 · 按平台实时排名`;
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
  const heat = Number(item.heatScore || 0);
  const rankLine = item.hotRank ? ` · ${item.source}热搜第 ${item.hotRank} 位` : "";
  const heatLine = heat > 0
    ? `<div class="detail-heat">🔥 热度 <b>${Math.round(heat * 100)}%</b>${rankLine}${(item.dupCount || 1) > 1 ? ` · 多源报道×${item.dupCount}` : ""}</div>`
    : "";
  container.innerHTML = `
    <div class="detail-tag">${esc(item.tag)} · ${esc(item.source)}</div>
    <h1 class="detail-title">${esc(item.title)}</h1>
    <div class="detail-meta">
      <span>${timeAgo(item.time)}</span>
      <span>${fmtFull(item.time)}</span>
    </div>
    ${heatLine}
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

// ---------- 悬停信息卡（跟随在叶片附近） ----------
export function fillHoverCard(cardEl, item) {
  const byId = (id) => cardEl.querySelector("#" + id);
  byId("hc-chip").textContent = `${item.tag} · ${item.source}`;
  byId("hc-time").textContent = timeAgo(item.time);
  byId("hc-title").textContent = item.title;
  const heat = Number(item.heatScore || 0);
  const parts = [];
  if (heat > 0) parts.push(`热度 ${Math.round(heat * 100)}%`);
  if (item.hotRank) parts.push(`${item.source}热搜#${item.hotRank}`);
  if ((item.dupCount || 1) > 1) parts.push(`多源×${item.dupCount}`);
  byId("hc-heat").innerHTML = parts.length
    ? `<span class="hc-heatval"><i class="hc-bar" style="--w:${Math.round(heat * 100)}%"></i>${parts.join(" · ")}</span>`
    : "";
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
