# Public Tools / P0-2 Internal Link Audit

状态：已实现的公开工具规范

日期：2026-07-30

目标路由：`/{locale}/tools/internal-link-audit`

## 产品边界

P0-2 是 `gengrowth.ai` 的匿名公开内链审计工具，不属于
`app.gengrowth.ai` 的认证工作台。它在一次瞬时请求中，抓取公开站点的同源静态
HTML 并生成真实的页面关系图和需要复核的结构性发现；不连接 Search Console、
不要求所有权验证、不保存 URL/HTML/报告，也不会修改用户的网站。

“真实”不表示无限制整站爬虫。公开结果只陈述本次受限抓取实际观测到的事实，
并始终公开覆盖范围与限制。

## 架构边界

- UI/API：`apps/marketing`；路由为 `POST /api/tools/internal-link-audit`。
- 严格 URL 输入、结果 DTO 和报告派生：`packages/public-tools/internal-link-audit`。
- 网络访问、SSRF 防护、DNS 固定、重定向、robots、sitemap 与 BFS 爬虫：
  `packages/sources`。
- `apps/marketing` 仅依赖 `@sf/public-tools`；不得导入 `apps/web`、数据库、
  队列、认证、私有 API 或内部 OpenAPI。

所有外发请求（包括每个重定向）必须经现有 guarded crawler：规范化 URL、重新
DNS 校验、私有/保留地址拒绝及经验证 IP 的 pinned connection。不得以普通
`fetch(url)` 替代。

## 固定公开抓取预算

`packages/sources/src/crawl/public-preview.ts` 代码拥有且不向 HTTP 调用者暴露：

- 最多 25 个页面、最深 4 层；
- 40 秒引擎时限；路由 `maxDuration = 60` 只提供安全响应余量；
- 每页最多 1 MiB、总计最多 12 MiB；
- 最多 5 次重定向；每主机最多 2 并发、300 ms 间隔；
- robots.txt、每份 sitemap、页面与每次重定向统一最多 60 个网络请求；
- 专用 `GenGrowth-Internal-Link-Audit` User-Agent。

路由还限制 JSON body 为 4 KiB、单 IP 每 10 分钟两次请求、同 IP 仅允许一次
in-flight crawl，并给任何响应设置 `Cache-Control: no-store`。内存限流是单实例
best-effort，平台级滥用防护仍是上线前的运维风险，不能称为全局配额。

## 结果语义

报告包括实际采集页数/预算、已观测 HTML 链接数、sitemap 是否成功读取、节点、
边和最多 12 个发现。只返回有上限的公开 URL、标题、锚文本和汇总结构事实；
不返回原始 HTML、响应头、Cookie、DNS 地址或内部错误。

- **候选孤岛**：该已采集页面在已读取 sitemap 中，且本次采集页中没有观测到
  指向它的 HTML 入链。即使覆盖完整也仍是 candidate，因为 JavaScript 链接和
  未采集范围不在结论内；若 `availability=partial`，限制文案必须进一步说明。
- **低入链**：本次采集页中观测到不超过一条入链，不是权重或排名结论。
- **深层页面**：受限 crawler 观测到的遍历深度不小于三层，不是首页点击数或排名预测；
  sitemap 条目也可能作为允许的抓取种子。
- **未验证目标**：链接目标未被本次受限抓取收集。不得称为“断链”；它可能被
  robots 排除、超出页数/深度/时间预算或未被实际请求。

抓取在预算边界提前终止时返回 HTTP 200 的部分报告与 `stopReason`；无可用页面
或安全网络失败才映射为安全的 502/504/400 错误包络。

## 可见产品与 SEO 要求

页面必须清楚展示“静态 HTML、同源、受限预算、请求瞬时处理、不保存报告”，
不能保留固定样本或 Mock 结果。维持唯一 H1、可访问的输入/错误/loading 状态、
键盘可操作图节点、`aria-pressed` 筛选器、390 px 无页面横向溢出，以及
`SoftwareApplication`、`FAQPage`、`HowTo`、`BreadcrumbList` JSON-LD 与可见
内容一致。

## 验收门禁

- `packages/sources`、`packages/public-tools`、`apps/marketing` typecheck；
- `apps/marketing` lint 与 production build；
- URL/模型、处理器（oversize、未知字段、rate、in-flight、partial/error）、
  public-preset 单测，以及使用 API route fixture 的 Playwright UI 测试；
- 保留现有 crawler SSRF/redirect/robots/预算测试；
- 不部署、不迁移数据库、不创建报告记录、不把模拟 UI fixture 称作真实爬取。
