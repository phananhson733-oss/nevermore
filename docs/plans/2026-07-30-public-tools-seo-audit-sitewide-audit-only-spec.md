# P0-4 免费全站 SEO 审计：纯审计 V3 合同

**状态：** 本地候选实现

**日期：** 2026-07-30

**公开路径：** `/[locale]/tools/seo-audit`

**API：** `POST /api/tools/seo-audit`

**运行位置：** `apps/marketing`

**共享后端：** `packages/public-tools` + `packages/sources`

## 1. 产品边界

P0-4 是 `gengrowth.ai/tools` 下的免费、匿名体验工具，不是
`app.gengrowth.ai` 的登录后工作流。

V3 只做审计：

- 真实抓取同源多个页面；
- 展示抓取覆盖和停止原因；
- 展示中性审计记录；
- 展示被记录 URL、观测值和证据边界；
- 展示本次已检查页面清单。

V3 不输出：

- 总分、模块分、等级或健康度；
- 严重程度、优先级或排序后的修复队列；
- 诊断、优化建议、修复步骤或行动计划；
- 排名、流量、搜索需求、内容质量或商业影响判断。

旧页面模板中的四段式 Diagnosis / Recommendation 结构不适用于本工具。
工具页继续复用 GenGrowth 的导航、间距、字体、颜色、卡片、表格和 FAQ
视觉骨架，但结果内容以本合同为准。

## 2. 免费产品合同与同步技术边界

工具正式免费，不要求登录，不设账户、调用次数或 25 页产品额度。重复点击与
失败请求不消耗任何额度，因为本产品不存在次数额度。

当前实现是 Vercel 同步 Route Handler。它会在一次运行中尽可能采集可发现的
同源公开静态页面；大型网站可能只得到部分覆盖。以下数值是服务端拥有、客户端
不可修改的同步运行安全配置，不是免费用户权益或产品配额，也不在 UI 中显示为
“最多可审计”：

| 同步技术安全边界 | 当前值 |
| --- | ---: |
| 页面队列保护 | 2,000 |
| 遍历深度保护 | 6 |
| 总网络请求保护 | 4,500 |
| 爬虫墙钟时间 | 240 秒 |
| Route Handler 时长 | 300 秒 |
| 单响应解码上限 | 2 MiB |
| 单次运行解码总量 | 128 MiB |
| 最大重定向 | 5 |
| 单主机并发 | 5 |
| 同主机最小发起间隔 | 250 ms |

请求计数覆盖 robots.txt、Sitemap 文档、页面和每个重定向跳转。
后续大规模完整全站抓取应改为异步任务，不继续扩大同步函数的运行边界。

爬虫：

- 从站点根 URL 开始；
- 当用户提交同源深路径时，把该路径作为额外深度 0 seed；
- 读取 robots.txt 和其中声明的 Sitemap；无声明时检查标准
  `/sitemap.xml`；
- 沿同源静态 HTML 链接广度优先抓取；
- 入口允许同主机、HTTP 到 HTTPS，以及精确的裸域与 `www` 规范化跳转；
- 入口跳转结束后，后续抓取同源边界收敛到最终公开 origin；
- 遵守自身 User-Agent 对应的 robots 规则；
- 在 DNS 解析后固定公开 IP，并在每次重定向重新执行 SSRF 检查；
- 拒绝任意兄弟子域、后缀相似域和不同 registrable domain 的入口跳转；
- 不执行页面 JavaScript；
- 不保存原始 HTML。

## 3. 返回合同

运行信封：

```text
tool = seo_audit
schemaVersion = seo_audit.sitewide.v3
mode = public_preview
scope = discoverable_same_origin_static_html_audit
persistence = none
```

`result` 分四部分：

1. `targetUrl`、`siteOrigin` 与 `scannedAt`。`targetUrl` 保留标准化后的
   用户提交 URL，包括路径；`siteOrigin` 是允许的入口规范化跳转后实际使用的
   公开 origin。
2. `coverage`
3. `records`
4. `pages`

### 3.1 coverage

必须返回：

- `availability`: `available | partial | unavailable`
- `pagesInspected`
- `linksObserved`
- `sitemapUrlsObserved`
- `urlsSkipped`
- `urlsBlocked`
- `urlsDisallowed`
- `urlsErrored`
- `stopReason`

`partial` 不代表网站好坏，只说明本次同步运行触及技术安全边界、robots、
站点响应或运行能力，未覆盖所有已发现页面。所有记录只对
`pagesInspected` 中的页面成立。API 不返回 `maxPages`、`maxDepth` 或
`maxRequests`，避免把内部安全阈值误解成免费配额。

### 3.2 records

每条记录包含：

- 稳定 `id`
- 中性 `category`
- `state`: `observed | not_observed | unverified`
- `unit`
- `tested`
- `affected`
- `observations[]`
- `limitation`

禁止加入 score、grade、severity、priority、diagnosis、recommendation、
remediation 或 action plan 字段。

V2 记录集：

| 记录 ID | 直接证据 |
| --- | --- |
| `robots_resource` | robots.txt 是否成功获取、规则组和 Sitemap 引用数量 |
| `sitemap_resource` | Sitemap 是否成功获取、保留 URL 数量 |
| `non_2xx_final_status` | 已采集页面请求链的最终 HTTP 状态 |
| `redirect_chain` | 已采集请求链的重定向跳数和最终 URL |
| `http_url` | 已采集最终 URL 的协议 |
| `noindex_directive` | 静态 Meta / X-Robots-Tag 指令 |
| `canonical_missing` | 已采集 2xx HTML 的 Canonical 投影 |
| `canonical_differs` | 页面主体与 Canonical 聚合目标 |
| `title_missing` | 已采集静态 HTML 的非空 Title |
| `title_duplicate` | 已检查页面内忽略大小写、合并空白后的 Title 文本 |
| `meta_description_missing` | 已采集静态 HTML 的非空 Meta Description |
| `meta_description_duplicate` | 已检查页面内标准化后的 Meta Description 文本 |
| `h1_missing` | 已采集静态 HTML 的 H1 数量 |
| `multiple_h1` | 已采集静态 HTML 的 H1 数量 |
| `sitemap_page_without_observed_inlink` | Sitemap 成员关系和已采集静态 HTML 入链 |
| `internal_target_http_error` | 已实际采集内部目标的 4xx/5xx 最终响应 |
| `json_ld_parse_error` | 已采集静态 HTML 中 JSON-LD 的 JSON 解析结果 |

没有进入抓取额度的链接目标不能标记为坏链。覆盖不完整时，没有已观测
HTML 入链的 Sitemap 页面也不能被断言为最终孤立页面。

### 3.3 pages

每条页面记录必须可追溯到一次已采集请求链，包含：

- 初始 URL、聚合主体和最终 URL；
- 深度、初始/最终状态、重定向跳数和 Content-Type；
- 静态索引指令和 Canonical；
- Title、Meta Description、H1 数量、Heading 数量和字数；
- 已观测入链/出链数量和 Sitemap 成员关系；
- JSON-LD 类型与解析错误数量。

静态 Robots 字段使用三态事实：

- `noindex_observed`：在已采集 2xx HTML 的静态 Meta 或
  X-Robots-Tag 中观测到 noindex/none；
- `noindex_not_observed`：已检查上述静态指令，但没有观测到
  noindex/none；
- `null`：响应不是 2xx HTML，不能据此推断索引资格。

这些字段是观测值，不表示搜索引擎是否实际收录页面，也不用于生成质量
分数。

## 4. 明确不检测

- GSC / Bing Webmaster 的真实索引覆盖；
- GA4 流量和转化；
- 排名、关键词、搜索量和竞争度；
- CrUX、PageSpeed、Lighthouse、Core Web Vitals；
- 客户端 JavaScript 渲染后的 DOM；
- 移动端视觉渲染和交互；
- 外链、域名权威度和引用；
- 应存在但未知的完整页面全集；
- 页面商业价值、内容质量和修复收益。

`responseMs` 不能被描述为 Core Web Vital。静态源码中没有观测到内容，也
不能证明渲染后仍然不存在。

## 5. 安全与成本边界

- URL 只接受公开 HTTP(S)；
- 拒绝凭据、非标准端口、localhost、私有/保留/链路本地 IP 和模糊 IPv4；
- 每次 DNS 和重定向都重新检查并固定公开 IP；
- 手动处理重定向，不允许传输层自动绕过检查；
- 强制请求、时间、响应体、总字节、并发和发起间隔上限；
- 同 IP 只允许一个进行中扫描；
- 正常连续请求、失败请求和重复点击不进入按时段计数；
- 响应 `Cache-Control: no-store`；
- 不写数据库，不返回原始 HTML，不返回秘密相关响应头；
- API 请求只能包含一个 `url` 字段。

## 6. UI 合同

结果顺序固定为：

1. 本次抓取覆盖；
2. 审计记录；
3. 页面级证据；
4. 已检查页面清单。

中英文 key 结构必须一致。桌面和移动端都必须保证：

- 长 URL 不扩大文档宽度；
- 页面清单在自身容器横向滚动；
- 记录可通过原生 `details` 展开；
- 状态不能使用 PASS / FAIL；
- 结果区域不能出现评分、健康度、优先级、诊断或修复建议。

## 7. 验收

- 提交真实公开 URL 后，API 在站点存在多个可达页面时返回多个
  `pages`；
- 可发现页面超过 25 的 fixture 能采集超过 25 页；
- 触及同步技术安全边界时返回 `partial` 与明确 `stopReason`，已完成页面不丢失；
- 裸域到 `www` 与 HTTP 到 HTTPS 的安全入口规范化跳转可成功；任意跨站跳转仍
  在下一次网络请求前阻断；
- 提交深路径时，该路径保留为额外 seed；
- Mock 多页、部分覆盖、重复元数据和链接目标边界均有测试；
- API 请求校验、无时段次数配额、单 IP 同时一任务和稳定错误码均有测试；
- 中英文 key 完全一致；
- `@sf/sources`、`@sf/public-tools`、`@sf/marketing` 类型检查和 lint 通过；
- `apps/marketing` 生产构建通过；
- 浏览器 E2E 覆盖中英文、多页结果、证据展开和移动端宽度；
- 真实 URL 验证必须与 Fixture / Mock 验证分开记录。
