# Public Tools / P0-2 Internal Link Audit 设计规范

状态：本轮实现依据

日期：2026-07-30

目标路由：`/{locale}/tools/internal-link-audit`

## 1. 产品目标

P0-2 是 `gengrowth.ai` 的公开内链审计工具，不属于
`app.gengrowth.ai` 的认证工作台。用户输入一个公开网站 URL 后，应能理解：

1. 哪些页面处于孤岛、低入链、过深或断链状态；
2. 为什么这些结构问题值得处理；
3. 最适合从哪个已有页面、哪个正文位置补链接；
4. 修复后应如何重新验证。

正式产品为爬取型，不连接 Google Search Console。P0-2 与 P0-4 可以在未来
共享安全 URL 规范化、robots.txt、sitemap 和公共网络采集基础设施，但两个
工具的公开页面、输入、结论和分析契约保持平级且独立。

## 2. 本轮范围：可交互 Mock

本轮只实现前端产品体验和固定演示结果，不发起真实网站请求：

- 输入仅保留在 React 内存中；
- 不调用 `fetch`、XHR、Beacon、WebSocket 或浏览器持久化 API；
- 不写 Supabase、数据库、对象存储、队列或分析事件；
- 结果使用固定的 `petwise.example` 42 页面、118 条内链演示数据；
- 页面在输入前、运行中和结果区持续说明“未真实抓取、未保存”；
- 用户输入用于演示流程，不能让固定样本看起来像该 URL 的真实结果。

本轮不实现：

- 真实 crawler、JavaScript 渲染、分布式抓取或后台任务；
- 真实 CSV 文件生成；
- 登录、项目创建、历史记录或“推送到项目”；
- GSC OAuth、搜索展现、排名或流量证据；
- 自动写入网站、自动补链接或修改 CMS；
- 错链语义判断；第一版只展示断链和结构性机会。

## 3. 用户流程

1. 用户看到工具价值、公开读取边界和 Mock 标识；
2. 输入域名或 URL，客户端只做基础格式校验；
3. 界面模拟“读取入口 → 构建关系 → 识别结构缺口”三个阶段；
4. 展示固定样本的覆盖范围、摘要指标、关系图和优先修复项；
5. 用户可以筛选关系图，用鼠标或键盘打开节点/问题详情；
6. 详情展示证据、限制、建议来源页、锚文本和复验动作；
7. 页面后半部解释方法、能力边界、适用场景、FAQ 和完整产品 CTA。

## 4. 演示数据语义

演示结果固定为：

- 42 个已映射页面；
- 118 条 HTML 内链；
- 4 个孤岛页面；
- 3 个深度超过 3 的页面；
- 2 条断链；
- 7 条可优先执行的补链建议；
- 平均点击深度 3.2。

“孤岛”在未来真实版本中应定义为：sitemap 中存在，但从首页和 sitemap
入口按可抓取 HTML 链接遍历后没有任何站内入链的页面。若 sitemap 缺失、
过期、响应截断或 JavaScript 才生成链接，结论必须携带对应 limitation，
不能作为无条件事实。

“低入链”指一至两条已观测入链；正文链接与导航/页尾链接应分开统计。
“深层”默认指从首页最短路径超过三次点击。“断链”只在目标响应被真实测量
为失败时成立；当前 Mock 仅演示这种结果形态。

## 5. 页面与 SEO

英文：

- Title：`Free Internal Link Audit — Find Broken Links & Orphan Pages`
- H1：`Internal Link Audit`
- 主词：`internal link audit`

中文：

- Title：`免费内链审计：发现断链、孤岛页面与结构缺口`
- H1：`内链审计`

页面必须包含并与可见内容一致的：

- `SoftwareApplication`
- `FAQPage`
- `HowTo`
- `BreadcrumbList`

页面应使用现有 `generatePageMetadata` 生成 canonical 与语言 alternate。

## 6. 页面区块

1. Hero 与信任边界；
2. URL 输入和持续可见的 Mock 说明；
3. 可交互结果：摘要、关系图、优先修复、详情、四段式解释；
4. 四步使用指南；
5. 能发现的问题类型；
6. 判断方法透明度；
7. 能力限制；
8. 适用场景和与 Screaming Frog / Search Console 的诚实比较；
9. 十项 FAQ；
10. 相关工具、相关阅读和完整产品 CTA。

不使用待定的 `[X]` 免费页数，也不发布未经确认的 62% 自有站案例。

## 7. 可访问性与响应式

- 唯一 H1，后续标题保持语义层级；
- 输入有可见 label、错误说明、loading/disabled 和 `aria-live`；
- 图节点支持鼠标、Enter 和 Space；
- 筛选器使用 `aria-pressed`；
- 状态不能只用颜色表达；
- 详情更新后有明确标题和文本；
- 390 px 下不横向溢出，数据表改用卡片/列表或允许有标注的局部滚动；
- 尊重 `prefers-reduced-motion`；
- 所有交互有可见焦点。

## 8. 后续真实实现边界

真实爬取必须单独设计 `packages/public-tools/internal-link-audit` 契约，并复用
或扩展 `packages/sources` 的 SSRF 安全边界。每次重定向都要重新验证目标，
连接时固定已验证 IP，并限制跳数、时间、响应字节、总页面数、并发和同源
范围。robots、sitemap、canonical、noindex、响应截断、编码和 JavaScript
渲染缺口必须进入证据与 limitation，不能被压成一个不透明总分。

在该合同和测试完整落地前，前端不得调用普通 `fetch(url)` 进行网站抓取。

## 9. 本轮验收

- `/en/tools/internal-link-audit` 与 `/zh/tools/internal-link-audit` 可构建；
- `/tools` 列表包含 P0-2；
- 表单演示不产生外部请求或持久化；
- 三阶段运行状态和固定结果可达；
- 图筛选、节点/问题详情、键盘操作可用；
- Mock、范围、限制和固定样本在结果前后均清晰；
- 四类 JSON-LD 存在且与页面内容一致；
- 桌面和 390 px 移动端无页面级横向溢出；
- P0-4 现有实现和 Public Tools 依赖边界不受破坏。
