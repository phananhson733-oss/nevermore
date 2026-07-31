# ChatGPT Pro 复核任务：SEO Audit 无免费额度限制与根域跳转修复

**仓库：** `phananhson733-oss/nevermore`

**基线分支：** `origin/main`

**基线 commit：** `c89374ce1ab0c6ba12eecd587ef5dd9b4784e6d4`

**生产页面：** `https://gengrowth.ai/zh/tools/seo-audit`

**生产 API：** `POST https://gengrowth.ai/api/tools/seo-audit`

## 1. 背景与目标

P0-4 是 `gengrowth.ai/tools` 下匿名、免费的全站 SEO 审计体验工具，运行于
`apps/marketing`，与登录后的 `app.gengrowth.ai` 工作台分离。用户明确指出：

1. 没有要求对免费用户设置页数、深度、请求数或使用次数额度；
2. 生产页面当前展示“最多 25 个同源 URL、深度 4、总计 60 次请求”，属于
   未经确认的产品限制；
3. 输入 `astrologywiki.com` 会显示“当前环境无法完成对该公开网站的审计”，
   但目标站实际可访问；
4. 工具必须返回真实抓取事实，只做审计，不输出评分、建议、诊断、优先级或
   修复方案。

目标是给出一个最小但完整的修正方案，使工具不再把运行保护阈值包装成
“免费用户额度”，不再对匿名用户实施按 IP 的次数配额，同时能处理常见的
根域到 `www` canonical host 跳转，并继续满足 SSRF 与资源耗尽防护。

## 2. 已验证事实

2026-07-31 在生产执行：

```text
POST /api/tools/seo-audit {"url":"https://astrologywiki.com"}
=> HTTP 502 {"error":{"code":"scan_failed"}}

POST /api/tools/seo-audit {"url":"https://www.astrologywiki.com"}
=> HTTP 200
=> 24 个真实页面
=> sitemapUrlsObserved = 558
=> stopReason = "max_urls"
```

目标站的 HTTP 行为：

```text
https://astrologywiki.com/
=> 307 Location: https://www.astrologywiki.com/

https://www.astrologywiki.com/
=> 200 text/html
```

源码显示 `packages/sources/src/crawl/engine.ts` 在每个跳转前后要求
`new URL(url).origin === allowedOrigin`。因此 apex → www 跳转在第二跳
SSRF guard 和网络请求之前就被标记为 blocked；robots、sitemap 与首页均没有
可采集页面，最终被 `scanSeoAuditSite` 压缩为 `scan_failed`。

## 3. 当前架构与不可破坏边界

- 公开页面与 API：`apps/marketing`。
- 公开审计模型：`packages/public-tools/src/seo-audit`。
- 共享真实抓取与 SSRF 防护：`packages/sources/src/crawl`。
- 生产部署：Vercel 营销站项目，Git 源必须保持
  `phananhson733-oss/nevermore`，Production Branch 为 `main`。
- 不接入 GSC、GA4、数据库、登录、计费或用户账户。
- 不保存原始 HTML，不把 unavailable 当作 0，不伪造页面或审计记录。
- 每个 DNS / redirect hop 必须继续执行 SSRF 检查并固定公开 IP。
- 不能允许任意第三方跨站重定向扩张抓取域；canonical host 接受规则必须窄、
  可测试、可解释。
- 只做静态公开 HTML 审计；不声称浏览器渲染、搜索引擎收录或站点完整全集。
- 结果中禁止 score、grade、severity、priority、diagnosis、
  recommendation、remediation 与 action plan。

## 4. 需要研究和修改的范围

请重点审查并提出候选补丁：

1. 如何在不降低 SSRF 安全性的前提下，接受 apex ↔ `www`、HTTP → HTTPS
   这类 canonical entry redirect，并把后续同源边界收敛到最终站点 origin；
2. 如何删除 `2 次 / 10 分钟 / IP` 的免费使用次数配额及相关
   `X-RateLimit-*` 输出，同时保留真正必要的并发、超时、字节和 SSRF 防护；
3. 如何把 25 页 / 深度 4 / 60 请求从“免费用户额度”改为面向全站发现的
   技术运行边界。优先考虑复用已有 2000 页、深度 6、128 MiB 的抓取配置，
   并给 Vercel Route Handler 留出序列化 headroom；若认为同步 Vercel 函数
   无法诚实实现，请明确给出可上线的最小架构；
4. 返回合同与 UI 如何区分：
   - 没有账户或免费次数额度；
   - 本次真实检查的页面数；
   - 因 robots、站点响应、安全、函数时限或资源保护而未覆盖的边界；
5. 中英文文案、metadata、FAQ、E2E 与单元测试应如何同步，避免继续出现
   “25 页免费上限”等承诺。

## 5. 明确交付物

- 根因复核结论与安全分析；
- 推荐的数据合同（必要时将 `seo_audit.sitewide.v2` 升版）；
- 最小完整的 unified diff 或完整修改文件；
- 覆盖 apex → www 成功、任意跨站 redirect 仍阻断、无按 IP 次数配额、
  大于 25 页站点不在 25 页停止的回归测试；
- 实际运行过的命令、结果、未验证风险。

## 6. 必须执行的测试

至少覆盖：

```bash
pnpm --filter @sf/sources test -- --run
pnpm --filter @sf/public-tools test -- --run
pnpm --filter @sf/marketing test -- --run
pnpm --filter @sf/sources typecheck
pnpm --filter @sf/public-tools typecheck
pnpm --filter @sf/marketing typecheck
pnpm --filter @sf/sources lint
pnpm --filter @sf/public-tools lint
pnpm --filter @sf/marketing lint
pnpm --filter @sf/marketing build
```

并说明真实 URL 验证与 fixture/mock 验证的证据层级不同。

## 7. 禁止执行或禁止声称

- 不提交、推送、创建 PR、合并、部署或修改 Vercel 配置；
- 不访问或声称访问本地未提供文件、私有仓库、生产凭据或数据库；
- 不把测试 fixture、mock 或本地结果说成生产验证；
- 不通过关闭 SSRF、允许任意跨源跳转、提高客户端可控额度或吞掉错误来修复；
- 不加入 GSC、建议、评分、诊断、推荐、付费解锁或账户配额；
- 不声称“全站”必然等于搜索引擎已知页面全集。

## 8. 验收标准

- `astrologywiki.com` 和 `www.astrologywiki.com` 均能审计同一个真实站点；
- 任意不同 registrable domain 的 redirect 在网络请求前仍被阻止；
- 页面不再显示 25 / 4 / 60 免费额度；
- API 不再对同 IP 实施 2 次 / 10 分钟的使用次数配额；
- 一个可发现页面数超过 25 的 fixture 能采集超过 25 页；
- 每次运行仍有服务端拥有、客户端不可调的 SSRF、超时、响应体、总字节、
  redirect 与并发保护；
- 结果只呈现审计事实与覆盖边界，不输出建议或评价；
- 中英文 key parity、类型、lint、单测、构建与浏览器 E2E 通过。
