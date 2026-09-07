# 部署到 Cloudflare Pages（GitHub → Cloudflare → newstree.dpdns.org）

本项目是 **静态站点 + Pages Functions（API）** 架构，可在 Cloudflare Pages 上零服务器运行：

- `public/` → 前端静态资源（树/列表/热榜）
- `functions/api/*` → `/api/news`、`/api/news/:id`、`/api/health`（服务端抓 RSS 与热搜，计算去重与 heatScore）
- `lib/news-core.mjs` → 本地 Express 与 Cloudflare Functions 共用的统一抓取/解析/热度引擎

## 一次性配置（约 5 分钟，需要你在 Cloudflare 面板操作）

1. **接入 GitHub**
   - Cloudflare 控制台 → Workers & Pages → **Create → Pages → Connect to Git**
   - 选择仓库 `Learner-ning/news-nb`，分支 `main`

2. **构建设置**
   - Framework preset：**None**
   - Build command：**留空**（纯静态 + Functions，无需构建）
   - Build output directory：**`public`**
   - Root directory：**`/`**
   - 高级 → Node.js version：**20**（默认即可；Functions 运行时不依赖 Node 版本）
   - 环境变量：本项目不需要任何（无密钥）

3. **保存并等待首次部署**，你会得到形如 `xxx.pages.dev` 的地址，先访问 `https://xxx.pages.dev` 验证：
   - 首页第一屏是整棵新闻树
   - `/api/health` 返回 `{"ok":true,...}`
   - 之后每次 `git push` 都会自动触发新部署，无需手动上传

4. **绑定自定义域名（在 Cloudflare DNS 面板）**
   - Workers & Pages → 你的项目 → Custom domains → Add：`newstree.dpdns.org`
   - 按提示把该域名解析指向 Pages（CNAME 到 `*.pages.dev`；若域在 Cloudflare，通常点一下即可自动创建记录）
   - SSL 自动提供，几分钟后 `https://newstree.dpdns.org` 生效

## 本地开发 / 部署前验证

```bash
npm install
npm start          # 本地 http://localhost:3000
```

> 若 `functions/` 在 Pages 上未按预期路由（例如 /api 请求被 _redirects 吞掉），
> 说明该项目必须用 **Cloudflare Pages（Functions）** 而非纯静态导出；
> 检查 Console 中该 Pages 项目属于 "Workers & Pages" 而非 "Pages（旧版）"。

## 常见问题

- 热搜接口来自各平台公开热榜，可能随时间调整；单个源失败不影响其余数据，顶部状态会提示“部分源不可用”。
- 想关闭某个源：编辑 `lib/news-core.mjs` 中对应条目的 `enabled: false`。
- 不要在本仓库提交任何 Token/Secret；本部署全程不需要密钥。
