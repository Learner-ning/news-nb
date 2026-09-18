// 路由解析（纯函数，可在 Node 中直接单测）
//
//   /            首页：新闻源树 / 新闻列表（按来源分区）/ 热榜
//   /source/:key 某个新闻源的独立新闻树
//   /detail/:id  新闻详情（Stage 3.1 及以前就存在，保持不变）
//
// key 就是来源名本身（浏览器会自动做百分号编码），不引入第二套来源命名，
// 避免出现「微博 / Weibo / weibo / 微博热榜」这种多套名称混用。

export function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return String(s ?? "");
  }
}

/** 来源名 → 路由路径 */
export function sourceHref(key) {
  return "/source/" + encodeURIComponent(String(key ?? ""));
}

/** 详情 id → 路由路径 */
export function detailHref(id) {
  return "/detail/" + encodeURIComponent(String(id ?? ""));
}

/** 路径 → 路由对象（不传参时按当前地址解析，便于浏览器内直接调用） */
export function parseRoute(pathname) {
  // 修复：之前 `p` 直接取 "/"，于是 app.js 里所有 `parseRoute()` 都只会返回 main ——
  // 直接访问 /source/:key、/detail/:id（地址栏输入 / 刷新 / 分享链接）以及浏览器
  // 前进后退全部失效，只能靠站内点击跳转。单测当时传了显式路径，所以没暴露。
  // 纯函数性质保留：显式传路径时行为完全不变。
  const p = String(
    pathname ?? (typeof location !== "undefined" && location.pathname ? location.pathname : "/")
  );
  const detail = p.match(/^\/detail\/([^/]+)\/?$/);
  if (detail) return { view: "detail", id: safeDecode(detail[1]) };
  const source = p.match(/^\/source\/([^/]+)\/?$/);
  if (source) return { view: "source", key: safeDecode(source[1]) };
  return { view: "main" };
}
