# P0-4 免费全站 SEO 审计：纯审计 V2 合同

**状态：** 本地候选实现

**日期：** 2026-07-30

**公开路径：** `/[locale]/tools/seo-audit`

**API：** `POST /api/tools/seo-audit`

**运行位置：** `apps/marketing`

**共享后端：** `packages/public-tools` + `packages/sources`

## 1. 产品边界

P0-4 是 `gengrowth.ai/tools` 下的免费、匿名体验工具，不是
`app.gengrowth.ai` 的登录后工作流。

V2 只做审计：

- 真实抓取同源多个页面；
- 展示抓取覆盖和停止原因；
- 展示中性审计记录；
- 展示被记录 URL、观测值和证据边界；
- 展示本次已检查页面清单。

V2 不输出：

- 总分、模块分、等级或健康度；
- 严重程度、优先级或排序后的修复队列；
- 诊断、优化建议、修复步骤或行动计划；
- 排名、流量、搜索需求、内容质量或商业影响判断。

旧页面模板中的四段式 Diagnosis / Recommendation 结构不适用于本工具。
工具页继续复用 GenGrowth 的导航、间距、字体、颜色、卡片、表格和 FAQ
视觉骨架，但结果内容以本合同为准。

## 2. 免费抓取合同

公开请求不能传入或修改抓取额度。额度固定在服务端：

| 边界 | 固定值 |
| --- | ---: |
| 最大 URL | 25 |
| 最大深度 | 4 |
| 最大总请求 | 60 |
| 最大执行时间 | 40 秒 |
| 单响应解码上限 | 1 MiB |
| 单次运行解码总量 | 12 MiB |
| 最大重定向 | 5 |
| 单主机并发 | 2 |
| 同主机最小发起间隔 | 300 ms |

请求计数覆盖 robots.txt、Sitemap 文档、页面和每个重定向跳转。

爬虫：

- 从站点根 URL 开始；
- 当用户提交同源深路径时，把该路径作为额外深度 0 seed；
- 读取 robots.txt 和其中声明的 Sitemap；无声明时检查标准
  `/sitemap.xml`；
- 沿同源静态 HTML 链接广度优先抓取；
- 遵守自身 User-Agent 对应的 robots 规则；
- 在 DNS 解析后固定公开 IP，并在每次重定向重新执行 SSRF 检查；
- 不执行页面 JavaScript；
- 不保存原始 HTML。

## 3. 返回合同

运行信封：

```text
tool = seo_audit
schemaVersion = seo_audit.sitewide.v2
mode = public_preview
scope = bounded_same_origin_static_html_audit
persistence = none
```

`result` 分四部分：

1. `targetUrl` 与 `scannedAt`。`targetUrl` 保留标准化后的用户提交 URL，
   包括路径；它不被替换为站点首页。
2. `coverage`
3. `records`
4. `pages`

### 3.1 coverage

必须返回：

- `availability`: `available | partial | unavailable`
- `pagesInspected`
- `maxPages`
- `maxDepth`
- `maxRequests`
- `linksObserved`
- `sitemapUrlsObserved`
- `urlsSkipped`
- `urlsBlocked`
- `urlsDisallowed`
- `urlsErrored`
- `stopReason`

`partial` 不代表网站好坏，只说明固定额度提前停止。所有记录只对
`pagesInspected` 中的页面成立。

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
- 同 IP 十分钟最多 5 次；
- 同 IP 只允许一个进行中扫描；
- 响应 `Cache-Control: no-store`；
- 不写数据库，不返回原始 HTML，不返回秘密相关响应头；
- API 请求只能包含一个 `url` 字段。

## 6. UI 合同

结果顺序固定为：

1. 抓取覆盖与免费额度；
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
- 达到 25 页时返回 `partial + max_urls`，已完成页面不丢失；
- 提交深路径时，该路径保留为额外 seed；
- Mock 多页、部分覆盖、重复元数据和链接目标边界均有测试；
- API 请求校验、限流、单并发和稳定错误码均有测试；
- 中英文 key 完全一致；
- `@sf/sources`、`@sf/public-tools`、`@sf/marketing` 类型检查和 lint 通过；
- `apps/marketing` 生产构建通过；
- 浏览器 E2E 覆盖中英文、多页结果、证据展开和移动端宽度；
- 真实 URL 验证必须与 Fixture / Mock 验证分开记录。
