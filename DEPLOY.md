# 部署到 Cloudflare（GitHub → Cloudflare → newstree.dpdns.org）

本项目采用 **Workers Static Assets** 形态，一个仓库即可完成全自动部署：

- `public/` → 静态资源（树/列表/热榜页面），由 Cloudflare Assets 托管
- `src/index.js` → Worker 入口：处理 `/api/*`（抓 RSS/热搜、去重、热度）并为 SPA 深链回落 `index.html`
- `lib/news-core.mjs` → 本地 Express 与 Worker 共用的统一引擎（无第三方运行时依赖）
- `wrangler.jsonc` → 部署配置（已在仓库内，云端不需要再生成）

## Cloudflare 面板配置（一次性）

1. **Workers & Pages → Create → Worker → 连接 Git 仓库**（`Learner-ning/news-nb`，分支 `main`）
   - 若旧项目已存在并失败：直接在项目 **Settings → Builds & deployments → Build configuration** 修正：
     - Build command：`npx wrangler deploy`
     - Output directory：`public`
2. **避免交互初始化**：仓库里已有 `wrangler.jsonc`，`wrangler deploy` 不会再提问 `functions 目录`/`是否修改设置`，直接按配置上传。
3. 部署成功后你会得到 `*.workers.dev` 地址。验证：
   - 首页能看到完整新闻树
   - `https://<name>.workers.dev/api/health` 返回 `{"ok":true,"itemCount":…}`
   - 直接访问任意 `/detail/xxxx` 能回到首页（SPA 深链）
4. 之后每次 `git push` 自动部署。

## 自定义域名

Workers & Pages → 项目 → **Settings → Domains & Routes** → Add custom domain：`newstree.dpdns.org`
- 若域名在 Cloudflare：会自动加好 DNS 记录；等待证书签发即可
- 生效后访问 `https://newstree.dpdns.org`

## 本地运行 / 调试

```bash
npm install
npm start                # Express 本地服务 http://localhost:3000（调 API 走 server.js）

npx wrangler dev         # 本地模拟 Worker（走 src/index.js + public 静态资源）
```

## 常见问题

- **`Infinite loop` / `Invalid _redirects`**：已删除 `public/_redirects`，SPA 深链由 Worker 回落处理，不再用 _redirects。
- **`functions directory … Pages deployment` 提问**：已删除 `functions/`（迁移为 Worker 后不需要）。
- 某热搜平台失效：编辑 `lib/news-core.mjs` 里对应条目 `enabled:false` 即可关闭，不影响其他源。
- 本仓库不含任何 Token/Secret；Cloudflare 账号权限由平台 Git 集成提供。
