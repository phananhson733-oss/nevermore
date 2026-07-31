# SEO Audit 无免费额度限制与裸域跳转修复：验收记录

**日期：** 2026-07-31

**仓库：** `phananhson733-oss/nevermore`

**工作分支：** `codex/seo-audit-no-free-quota`

**源码基线：** `c89374ce1ab0c6ba12eecd587ef5dd9b4784e6d4`

**生产页面：** `https://gengrowth.ai/zh/tools/seo-audit`

## 1. 外部复核输入

ChatGPT Pro 对话：

`https://chatgpt.com/c/6a6b6136-848c-83e8-8292-55fef443d987`

上传源码包：

- 文件：`nevermore-seo-audit-no-free-quota-c89374c.zip`
- 条目：97
- 字节：290,372
- SHA-256：
  `2b3da580520af5b3bb6519c1a5ff542ff85d57ebc79cd37e87e1dc9a52afed39`
- 上传前仓库密钥扫描：通过
- ZIP 禁止路径检查：通过
- ZIP 内容密钥模式检查：通过

外部任务书：

`docs/external-reviews/2026-07-31-seo-audit-no-free-quota-fix-task.md`

### ChatGPT Pro 交付与纠错

ChatGPT Pro 核对了 ZIP 条目数、字节、SHA-256、基线与解压安全，复核了
`exact-origin` 阻断根因和“两阶段入口解析、最终 origin 锁定”方向。它没有
生成可下载候选 ZIP 或可采纳 patch，也明确没有成功执行仓库全量测试、构建或
Playwright；因此外部对话只作为设计复核，不作为本地或生产验证证据。

第一次最终答复有两个被 Codex 拒绝的阻塞问题：

1. 建议按整个 registrable domain 放行，并把 `www -> cdn` 写成允许；这违反
   任务书“只允许精确 host / `www` 对、兄弟子域必须在下一请求前阻断”的边界。
2. 建议使用 `seo-audit@2.1` 并把内部运行边界放回 DTO；这与现有 V2 合同的
   V3 升级方式及“技术边界不是产品额度”的要求不兼容。

Codex 把实际候选设计和完整本地证据反馈到原对话后，ChatGPT Pro 撤回上述
两项建议，确认：

```text
PASS
只允许同 host、HTTP -> HTTPS 和精确 apex <-> www；
cdn/blog 等兄弟子域必须在下一次请求前阻断；
合同使用 seo_audit.sitewide.v3；
内部安全上限不作为产品 DTO 返回；
没有从该候选方案推出的剩余阻塞问题。
```

## 2. 生产故障基线

修改前从生产 API 真实执行：

```text
POST https://gengrowth.ai/api/tools/seo-audit
{"url":"https://astrologywiki.com"}
=> HTTP 502
=> {"error":{"code":"scan_failed"}}

POST https://gengrowth.ai/api/tools/seo-audit
{"url":"https://www.astrologywiki.com"}
=> HTTP 200
=> pagesInspected = 24
=> sitemapUrlsObserved = 558
=> stopReason = "max_urls"
```

站点入口行为：

```text
https://astrologywiki.com/
=> 307 Location: https://www.astrologywiki.com/

https://www.astrologywiki.com/
=> 200 text/html
```

根因是原爬虫在站点入口阶段直接使用提交 origin。裸域跳转到 `www` 后，
exact-origin 检查会在第二跳 DNS guard 和网络请求前阻断，导致 robots、
Sitemap 和首页都不可用，最终被 API 映射为 `scan_failed`。

## 3. 实现合同

- 移除 SEO Audit 与 Internal Link Audit 的按 IP 时段次数限制；
- 移除 `X-RateLimit-*` 输出和页面频率额度文案；
- 正常连续请求、失败请求和重复点击不消耗次数额度；
- 两个同步公开爬虫共享同一 IP 的一个 per-isolate in-flight slot；
- 同 IP 并发冲突使用 HTTP 409 `scan_in_progress`，不冒充时段配额；
- 同步爬虫采用服务端拥有的技术安全配置：
  - 页面队列 2,000；
  - 深度 6；
  - 最多 4,500 个网络请求；
  - 爬虫墙钟 240 秒；
  - Route Handler 300 秒；
  - 单响应 2 MiB、总解码量 128 MiB；
  - 最多 5 次重定向；
  - 单主机并发 5、最小发起间隔 250 ms；
- 这些数值不作为免费产品额度展示；
- 大型网站可能只得到部分覆盖，真正的大规模全站扫描留给异步任务版本；
- 入口只允许同主机、HTTP 到 HTTPS、精确裸域与 `www` 规范化跳转；
- 每个允许跳转的下一跳仍重新执行 DNS guard 与 IP pin；
- 任意兄弟子域、后缀相似域、不同 registrable domain 和 HTTPS 降级仍在
  下一次网络请求前阻断；
- SEO Audit 返回合同升级到 `seo_audit.sitewide.v3`，增加 `siteOrigin`，
  删除对外 `maxPages`、`maxDepth`、`maxRequests`；
- 页面只显示实际覆盖、观测事实、URL 证据和页面清单，不输出评分、建议、
  诊断、优先级或修复方案；
- `app.gengrowth.ai`、数据库、GSC、GA4、登录与持久化均未改动。

## 4. 自动化验收

### 聚焦测试

```text
public-http + public crawl：25 项通过
公开工具请求/handler：20 项通过
SEO model、两个 handler、内链结果文案等聚焦集合：34 项通过
```

关键回归包括：

- apex → `www` 成功；
- 允许入口跳转后对下一跳重新 guard 并创建新的 pinned dispatcher；
- HTTPS 降级、兄弟子域、后缀相似域和不同站点跳转被拒绝；
- 可发现页面超过 25 的 fixture 实际采集超过 25 页；
- 同 IP 连续 7 次 SEO 请求均成功；
- 失败扫描释放 in-flight slot；
- 同 IP 同时只允许一个同步公开爬虫；
- SEO v3 DTO 不包含评分、建议、诊断或优先级字段。

### 全仓门禁

```text
pnpm test
=> 501 个测试文件通过
=> 6,112 项测试通过

pnpm typecheck
=> 通过

pnpm lint
=> 通过

pnpm verify:docs
=> 10 项通过

pnpm secrets:scan
=> 密钥扫描通过，4 个文件 / 75 项脱敏测试通过

pnpm --filter @sf/marketing build
=> Next.js 16.2.11 production build 通过

pnpm --filter @sf/marketing exec playwright test \
  --config=playwright.config.ts \
  e2e/seo-audit.spec.ts \
  e2e/internal-link-audit.spec.ts
=> Chromium 6 项通过
```

## 5. 真实 URL 与完整本地 API 验证

真实受保护爬虫：

```text
输入：https://astrologywiki.com/
耗时：170,563 ms
最终 origin：https://www.astrologywiki.com
availability：available
pages：630
sitemapUrlsObserved：558
robotsFetched：true
sitemapFetched：true
stopReason：null
urlsBlocked：0
urlsDisallowed：2
urlsErrored：0
bytesFetched：17,947,553
```

本地 production build 的完整 API：

```text
POST http://127.0.0.1:3011/api/tools/seo-audit
{"url":"astrologywiki.com"}

HTTP：200
耗时：173,822 ms
Cache-Control：no-store
X-RateLimit-Remaining：不存在
响应字节：673,948
schemaVersion：seo_audit.sitewide.v3
scope：discoverable_same_origin_static_html_audit
targetUrl：https://astrologywiki.com/
siteOrigin：https://www.astrologywiki.com
availability：available
pagesInspected：630
sitemapUrlsObserved：558
stopReason：null
records：17
pages：630
禁止字段：无
```

这是真实网络与本地 production build 的 API 验证，不是 fixture、mock 或生产
部署后的验证。

## 6. 部署后待补证据

提交、推送、Vercel Production Deployment、生产 API 与生产浏览器验收完成后，
在本节记录 commit、部署 URL、部署状态、生产真实扫描结果、运行日志和仍未验证
风险。
