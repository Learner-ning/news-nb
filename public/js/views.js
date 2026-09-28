// 视图层：新闻来源长条列表 / 平台分组热榜 / 详情 / 悬停卡
// 所有视图共用同一份真实数据与点击→详情跳转逻辑
import { esc, timeLabel, fmtFull, colorFor } from "./helpers.js";

// ---------- 新闻列表来源分区（Stage 3.2 → Stage 3.7 被来源长条取代） ----------
// Stage 3.7：列表不再用「来源区域 + 卡片网格」（用户要求改为可竖向滑动的来源长条），
// 旧的 sourceSection / renderSourceSections / card 已删除，避免留下两套并行实现。

// ---------- 新闻列表：来源长条（Stage 3.7） ----------
// 设计意图（用户要求）：
//   · 每个新闻源 = 一条「长条矩形」，横向铺满、彼此上下堆叠
//   · 整列可竖向滚动，不再把每条新闻都平铺成卡片网格
//   · 来源按时间排序（以该来源最新一条的时间为准）
//   · 长条内只预览最新若干条（默认 3），点条头「展开」看该来源全部
// 为什么不做成折叠手风琴：用户要的是「一眼扫过所有来源的时效性」，
// 所以默认就展示每条来源的最新几条，而不是全部收起。
const BAR_PREVIEW = 3;

function srcBar(s, i, sort, expanded) {
  const isOpen = expanded && expanded.has ? expanded.has(s.key) : false;
  const preview = isOpen ? s.items : s.items.slice(0, BAR_PREVIEW);
  const rest = s.items.length - preview.length;
  // 展开态下最多渲染 60 条，避免单条来源极多时把内存和 DOM 撑爆（其余仍可通过进来源树查看）
  const shown = isOpen ? preview.slice(0, 60) : preview;
  const rows = shown.map((x) => `
    <li class="sb-row" data-id="${esc(x.id)}" role="button" tabindex="0" aria-label="${esc(x.title)}">
      <span class="sb-time">${esc(timeLabel(x))}</span>
      <span class="sb-title">${esc(x.title)}</span>
      <span class="sb-heat" title="热度">${Math.round((x.heatScore || 0) * 100)}</span>
    </li>`).join("");
  const newest = s.items[0] ? timeLabel(s.items[0]) : "";
  const moreCls = s.items.length > BAR_PREVIEW ? "" : " hidden";
  const restLine = !isOpen && rest > 0
    ? `<li class="sb-rest">还有 ${rest} 条，点「展开全部」查看</li>`
    : (isOpen && s.items.length > 60 ? `<li class="sb-rest">仅显示前 60 条，其余请进入该来源新闻树</li>` : "");
  return `
  <section class="src-bar${isOpen ? " open" : ""}" data-source="${esc(s.key)}" style="--c:${s.color}" aria-labelledby="sb-name-${i}">
    <header class="sb-head">
      <span class="sb-accent" aria-hidden="true"></span>
      <div class="sb-id">
        <h3 class="sb-name" id="sb-name-${i}">${esc(s.name)}</h3>
        <span class="sb-meta">${s.count} 条 · 最新 ${esc(newest)}</span>
      </div>
      <span class="sb-tag" style="--c:${s.color}">${esc(s.tag)}</span>
      <button class="sb-more${moreCls}" type="button" data-more-source="${esc(s.key)}"
        aria-expanded="${isOpen ? "true" : "false"}"
        aria-label="${isOpen ? "收起" : "展开"}${esc(s.name)}的新闻">${isOpen ? "收起 ↑" : `展开全部 ${s.count} →`}</button>
      <button class="sb-enter" type="button" data-enter-source="${esc(s.key)}"
        aria-label="进入${esc(s.name)}的独立新闻树">进入新闻树 →</button>
    </header>
    <ul class="sb-rows" data-sort="${esc(sort)}">${rows}${restLine}</ul>
  </section>`;
}

export function renderSourceBars(container, sections, sort = "time", expanded = null) {
  if (!sections.length) {
    container.innerHTML = '<div class="list-empty">当前筛选下没有新闻，请切换分类或稍后刷新。</div>';
    return;
  }
  container.innerHTML = sections.map((s, i) => srcBar(s, i, sort, expanded)).join("");
}

export function setSourceBarsMeta(elm, sections, total, sort = "time") {
  const order = sort === "time" ? "按来源最新时间排序" : "按来源热度排序";
  elm.textContent = `${sections.length} 个来源 · ${total} 条 · ${order}`;
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
      <span class="b-meta">${esc(x.source)} · ${esc(x.tag)} · ${esc(timeLabel(x))}${extra}</span>
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

/**
 * 总榜：把**全部新闻**（RSS 资讯 + 平台热搜）按统一 heatScore 排名，
 * 不再按平台分组 —— 回答「全网此刻最热的是哪几条」。
 * 与平台榜的区别：平台榜组内按平台名次，总榜跨来源按热度分值。
 */
export function renderBoardOverall(container, items, { limit = 50 } = {}) {
  if (!items.length) {
    container.innerHTML = '<div class="list-empty">当前分类下没有可用于总榜排名的新闻，请切换到「全部」分类或稍后刷新。</div>';
    return;
  }
  const ranked = [...items]
    .sort((a, b) => (b.heatScore || 0) - (a.heatScore || 0) ||
      new Date(b.time || 0) - new Date(a.time || 0) ||
      String(a.id).localeCompare(String(b.id)))
    .slice(0, limit);
  const rows = ranked.map((x, i) => hotRow(x, i)).join("");
  container.innerHTML = `
    <section class="lg hot-lg">
      <h3 class="lg-name hot-plat overall-head">
        <span>总榜 · 全部来源</span>
        <span class="lg-count">Top${ranked.length}</span>
      </h3>
      <div class="hot-rows">${rows}</div>
    </section>`;
}

export function setBoardOverallMeta(elm, count) {
  elm.textContent = `全部来源 ${count} 条 · 按统一热度分值排名`;
}

// ---------- 详情 ----------
export function showDetailSkeleton(container, text = "正在加载正文…") {
  container.innerHTML = `
    <div class="skeleton detail-skeleton"></div>
    <div class="detail-loading" role="status">${esc(text)}</div>`;
}

export function showDetailError(container, onBack, message = "") {
  container.innerHTML = `
    <div class="detail-error">
      <p>${message ? "加载失败：" + esc(message) : "新闻不存在或已过期。"}</p>
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
      <span>${esc(timeLabel(item))}</span>
      ${fmtFull(item.time) ? `<span>${esc(fmtFull(item.time))}</span>` : ""}
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
  byId("hc-time").textContent = timeLabel(item);
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
  // 触屏上 click 的坐标可能落在屏幕边缘（甚至为 0），必须把卡片强制夹回视口内，
  // 否则卡片会有一大半跑到屏幕外（实测移动端点最左侧叶片时就出现了这个情况）。
  const px = Number.isFinite(evt?.clientX) ? evt.clientX : innerWidth / 2;
  const py = Number.isFinite(evt?.clientY) ? evt.clientY : innerHeight / 2;
  let x = px + m, y = py + m;
  if (x + cw > innerWidth - pad) x = px - cw - m;
  if (y + ch > innerHeight - pad) y = py - ch - m;
  // 夹取到视口范围内（左右都保证至少 pad 的边距）
  x = Math.max(pad, Math.min(x, innerWidth - cw - pad));
  if (innerWidth - cw - pad < pad) x = Math.max(4, (innerWidth - cw) / 2); // 卡片比视口还宽时居中
  y = Math.max(pad, Math.min(y, innerHeight - ch - pad));
  if (innerHeight - ch - pad < pad) y = Math.max(4, (innerHeight - ch) / 2);
  cardEl.style.left = x + "px";
  cardEl.style.top = y + "px";
}

// ---------- 新闻源预览卡（首页悬停来源节点时） ----------
// 首页不显示新闻，所以悬停时必须能「先看一眼」这个来源里有什么，
// 否则用户只能盲点。预览列表用真实数据，不编造。
export function fillPeekCard(cardEl, name, count, items) {
  cardEl.querySelector("#pk-name").textContent = name;
  cardEl.querySelector("#pk-count").textContent = count ? `${count} 条` : "";
  const ul = cardEl.querySelector("#pk-list");
  ul.innerHTML = "";
  for (const it of items || []) {
    const li = document.createElement("li");
    li.className = "pk-item";
    li.dataset.id = it.id;
    const t = document.createElement("span");
    t.className = "pk-t";
    t.textContent = it.title || "(无标题)";
    const tm = document.createElement("span");
    tm.className = "pk-time";
    tm.textContent = timeLabel(it);
    li.append(t, tm);
    ul.appendChild(li);
  }
  if (!ul.children.length) {
    const li = document.createElement("li");
    li.className = "pk-item pk-empty";
    li.textContent = "该来源暂无可用新闻";
    ul.appendChild(li);
  }
  cardEl.querySelector("#pk-foot").textContent = name
    ? `点击进入「${name}」的新闻树 →`
    : "点击进入该来源的新闻树 →";
}

/** 把预览卡摆到节点附近（优先右侧，超出则左/上翻转） */
export function positionPeekCard(cardEl, anchorEl, evt) {
  const pad = 16;
  const m = 14;
  const cw = cardEl.offsetWidth, ch = cardEl.offsetHeight;
  let x, y;
  if (evt && evt.clientX) {
    x = evt.clientX + m;
    y = evt.clientY + m;
  } else if (anchorEl) {
    const r = anchorEl.getBoundingClientRect();
    x = r.right + m;
    y = r.top;
  } else {
    x = innerWidth / 2;
    y = innerHeight / 2;
  }
  if (x + cw > innerWidth - pad) x = Math.max(pad, x - cw - m * 2);
  if (y + ch > innerHeight - pad) y = Math.max(pad, innerHeight - pad - ch);
  // 同样夹回视口（预览卡也不是弹出层，越界就等于看不全）
  x = Math.max(pad, Math.min(x, Math.max(pad, innerWidth - cw - pad)));
  y = Math.max(pad, Math.min(y, Math.max(pad, innerHeight - ch - pad)));
  cardEl.style.left = x + "px";
  cardEl.style.top = y + "px";
}
