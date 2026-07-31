# [已废弃] Public Tools / Website Health Map (`seo-audit`) V0 设计规范

状态：历史设计，不再是实现依据
日期：2026-07-30
目标路由：`/{locale}/tools/seo-audit`
目标 API：`POST /api/tools/seo-audit`

> 本文记录已被放弃的单页、评分和次数限流方案，仅保留为决策历史。当前唯一
> 实现依据是
> [`2026-07-30-public-tools-seo-audit-sitewide-audit-only-spec.md`](./2026-07-30-public-tools-seo-audit-sitewide-audit-only-spec.md)：
> 正式免费、无固定页数或次数产品额度、同步技术安全边界、全站发现和
> audit-only 结果。本文下方任何与 V3 合同冲突的内容均不得实现或对外展示。

## 1. 背景与决策

GenGrowth 需要把增长全链路拆成可独立体验、可被营销和 SEO/GEO 页面承载
的公开工具。Website Health Map 是第一项有服务端测量能力的工具，也是
后续关键词立项、GEO 可见度、内链、外链等工具的数据契约样板。

Public Tools 与 `app.gengrowth.ai` 是两个运行系统，但代码统一归入当前
Nevermore monorepo：

```text
apps/marketing
  └─ gengrowth.ai 页面、匿名 API 路由、限流和交互状态
packages/public-tools
  └─ 公共工具统一 DTO、证据模型、确定性规则和无状态编排
packages/sources
  └─ 可复用的公共网络采集、DNS 校验与连接时 IP 固定

apps/web / worker / db / engine
  └─ app.gengrowth.ai 完整产品（Public Tools V0 不依赖）
```

本功能不会修改 MVP OpenAPI、认证、数据库 schema、迁移、项目/工作区、
队列或 App 内部服务。外层工具只提供一次匿名预览；完整站点审计通过 CTA
跳转到 `https://app.gengrowth.ai`。

## 2. V0 产品范围

一次运行只测量：

1. 用户提交的一个公开 HTTP(S) 页面；
2. 最终页面同源的 `/robots.txt`；
3. 最终页面同源的 `/sitemap.xml`。

明确不包括：

- 全站爬取、JavaScript 浏览器渲染、Core Web Vitals；
- GSC/GA4、排名、关键词、外链或真实索引状态；
- 登录、项目创建、历史记录、数据库持久化；
- AI 生成结论或自动修改用户网站；
- 把静态原始响应缺失解释为渲染后也缺失。

页面和报告必须明确显示上述范围，不能使用“完整审计”“全站扫描”或
“生产验证”等误导措辞。

## 3. Public Tools 统一契约

成功响应：

```json
{
  "data": {
    "run": {
      "tool": "seo_audit",
      "schemaVersion": "1.0.0",
      "mode": "public_preview",
      "scope": "single_raw_page_and_standard_support_files",
      "persistence": "none",
      "completedAt": "ISO-8601"
    },
    "result": {}
  }
}
```

错误响应：

```json
{
  "error": {
    "code": "stable_machine_code"
  }
}
```

统一 check 结构包含：

- `id`：稳定、语言无关的规则 ID；
- `module`：健康地图模块；
- `status`：`pass | warning | fail | unverified`；
- `severity`：`critical | high | medium | low`；
- `weight`：分数权重；
- `evidence[]`：稳定 label、标量 value、明确 source；
- `limitation`：存在证据边界时使用的稳定限制码。

API 不返回原始 HTML/XML、解析堆栈、DNS 地址、内部错误、Cookie、请求
header 或服务端路径。

## 4. 采集与 SSRF 安全

### 4.1 URL 边界

- 输入省略协议时补 `https://`；
- 最长 2048 字符；
- 只允许 `http:` / `https:`；
- 禁止 userinfo、IP literal、localhost、`.local`、无 TLD 和已知 metadata
  主机；
- DNS 解析失败、超时、空结果或任一解析地址属于私网/保留/metadata 范围
  时 fail closed。

### 4.2 连接安全

每个请求和每个重定向 hop 都必须：

1. 规范化 URL；
2. DNS 解析并检查全部地址；
3. 选择一个已通过检查的地址；
4. 用自定义 undici dispatcher 在 TCP/TLS 连接时固定该 IP，同时保留原始
   hostname 作为 Host/SNI；
5. 使用 `redirect: manual`，读取 Location 后重新执行 1—4。

只做 DNS 预检后调用普通 `fetch` 不合格，因为存在 DNS rebinding TOCTOU
窗口。

资源限制：

- 页面总超时 8 秒，响应体前缀上限 1.5 MB；
- robots/sitemap 各 5 秒，响应体前缀上限 256 KB；
- 最多 5 次重定向；
- robots/sitemap 的所有重定向必须保持在页面最终 origin；
- 每个 response body 都受流式字节上限，超限立即取消 reader；
- dispatcher、timer、reader 在成功和失败路径都必须释放。

响应截断时允许使用确定性的 header/status 和已观测到的正向事实；任何
依赖“全文未出现”或完整数量/比例的检查必须标记为 `unverified`。

## 5. 规则、证据与评分

健康地图固定分为五组：

1. 抓取与索引；
2. 技术基础；
3. 页面内信号；
4. 内容与可提取性；
5. 结构化数据与 AI 可读性。

V0 规则目录：

| ID | 模块 | 主要证据 |
| --- | --- | --- |
| `homepage_status` | 抓取与索引 | 最终 HTTP 状态 |
| `indexability` | 抓取与索引 | X-Robots-Tag + 静态 meta robots |
| `robots_access` | 抓取与索引 | `/robots.txt` 状态和可解析性 |
| `sitemap` | 抓取与索引 | `/sitemap.xml` 状态和 XML 根元素 |
| `https` | 技术基础 | 最终 URL 协议 |
| `redirects` | 技术基础 | 实际重定向 hop |
| `html_content_type` | 技术基础 | Content-Type |
| `canonical` | 技术基础 | 静态 canonical |
| `html_lang` | 技术基础 | 静态 `<html lang>` |
| `title` | 页面内 | title 是否存在和长度 |
| `meta_description` | 页面内 | description 是否存在和长度 |
| `h1` | 页面内 | 静态 H1 数量 |
| `heading_order` | 页面内 | 静态 H1—H6 层级 |
| `text_depth` | 内容 | 可提取静态词数 |
| `internal_links` | 内容 | 同源静态链接数量 |
| `social_meta` | 内容 | Open Graph/Twitter 标记 |
| `json_ld` | 结构化数据 | 静态 JSON-LD block/解析错误 |

核心语义：

- 页面 4xx/5xx 是一次成功完成的工具报告，`homepage_status=fail`；传输失败
  才返回 API 错误。
- `/sitemap.xml` 404 只说明标准路径未找到，记 `warning`，不能声称网站
  没有 sitemap。
- 合法但不存在的 robots.txt 不等于阻塞抓取。
- 静态响应中没有 JSON-LD 只能记 `unverified`；检测到 malformed block
  才能记 `fail`。
- 响应截断或非 HTML 时，依赖完整 body 的缺失、数量和比例规则为
  `unverified`。
- `unverified` 不进入分母。其余按 `pass=1`、`warning=0.5`、`fail=0`
  乘权重计算，并四舍五入为 0—100。
- 总分同时显示 `measuredChecks / totalChecks`，不能隐藏覆盖率。

## 6. API 约束

- 只接受 `application/json`；
- 请求体最多 4 KB，必须流式限制；
- 每个 IP 每 10 分钟最多 5 次；
- 每个 IP 同时最多 1 个运行；
- 限流必须发生在发起网络请求之前；
- 429 返回 `Retry-After`；
- 所有响应 `Cache-Control: no-store`；
- 当前内存限流只保证单 isolate 的 best effort，代码和文档不得声称全局
  严格限流；
- 不记录提交 URL，不写数据库或分析事件。

状态码：

| 场景 | HTTP |
| --- | --- |
| 非 JSON | 415 |
| 超过 4 KB | 413 |
| JSON/URL 无效 | 400 |
| 单实例限流/并发冲突 | 429 |
| DNS、连接、TLS、读取等传输失败 | 502 |
| 总超时 | 504 |
| 页面返回 4xx/5xx | 200（报告内失败） |

## 7. UI 与可访问性

- 路由支持 `en` 和 `zh`，沿用 `apps/marketing` 的深色 charcoal、陶土色
  accent、排版和 Header/Footer；
- Tools 列表新增 Website Health Map 卡片；
- 输入框支持键盘、可见 label、loading/disabled 和 `aria-live` 状态；
- 结果同时用图标、文字和颜色表达，不能只靠颜色；
- 首屏展示实测分数、覆盖率、最终 URL 和优先项；
- 五个模块可展开查看证据、状态和下一步建议；
- 显示采集范围、证据边界、FAQ 与方法说明；
- CTA 只跳转完整 App，不共享其认证或数据。

## 8. 验收门禁

必须有自动化覆盖：

- URL 规范化与危险输入；
- redirect 每 hop 重新 guard、连接时 pinned IP、same-origin 资源约束；
- timeout、body cap、dispatcher/reader 清理；
- 截断/非 HTML/静态 JSON-LD 缺失的 `unverified` 语义；
- sitemap 标准路径缺失只 warning；
- 加权分数排除 unverified；
- API content type、4 KB body、稳定错误、限流发生在网络前；
- 双语页面和核心交互的构建/E2E。

交付前运行适用的：

- `pnpm verify:spec`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- 相关 Playwright E2E
- `pnpm secrets:scan`
- `git diff --check`

不能运行的真实外网或生产检查必须列为未验证，不得用 Mock 结果代替。
