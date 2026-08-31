# GEO 原型对齐：生产发布候选与前置条件

日期：2026-08-31。用户已授权合并、推送和生产发布；本文不是上线成功记录。

## 发布范围

- GitHub：`phananhson733-oss/nevermore`，生产跟踪分支为 `main`，不是独立的 `prod` 分支。
- 发布分支：`feat/geo-artifact-alignment-20260831`。初始实现提交 `0eda67f89a1cef121f21b8c7ed06e527866506bd`。
- 已整合生产基线 `8ce02d2f`（Profile UX，PR #259）和 `bb85c2be24977d4411d4b355d15cf0fc6492e172`（GSC 列表刷新，PR #260），保留两者全部行为。
- Marketing 直接消费本次共享包；`apps/web` 和 `apps/worker` 没有 `@sf/public-tools` 运行依赖。根文档/CI/scripts 仍可能触发 Product 构建，因此不能根据源码依赖推断平台一定跳过。
- 没有触及原主工作区的未提交更改；没有上传源码到外部评审服务。发布审查采用原生协作代理与主代理独立复核。

## 平台实查

2026-08-31 07:09 UTC 的 canonical-domain 查询：

| 目标 | 当前生产部署 | SHA | 状态 |
|---|---|---|---|
| `gengrowth.ai` / `www.gengrowth.ai` | `dpl_qfEnDkwBn9d2UD8MukdAsRityrrx` | `bb85c2be24977d4411d4b355d15cf0fc6492e172` | READY，尚不是本候选 |
| `app.gengrowth.ai` | `dpl_DzMBdEeuhxshcsqSt8UVttk75cc7` | `de82f380bf2d531907bfad825dc4b755deced053` | READY，未由本任务 promote |

Marketing 自动分配生产域名开启；Product 的自动分配关闭。为了避免在新表/renderer 尚未就绪时接入流量，当前候选只推送分支并保留草稿 PR，不合并生产分支。

Vercel Production 已读回 `GEO_BRIEF_*`、`CONTENT_DRAFT_*` 五项配置及 `DATAFORSEO_LOGIN/PASSWORD` 的名称、目标环境和存在状态；没有读取或输出秘密值。`CITABILITY_RENDERER_URL/TOKEN` 尚不存在。变量存在不代表当前模型通过新版 parser。

## 发布审查发现与处理

1. **#259 折叠确认态丢失 GEO 入口：已修复。** 保留 #259 的折叠、焦点、并发与自动保存行为，展开/折叠状态使用同一个 canonical GEO 链接。先复现失败，再通过 ProfileEditor 65 项回归；主代理跨 Profile/GEO editor 的 98 项复核通过。
2. **手动 CI 未在 unit/coverage 前安装 Chromium：已修复。** 两个相关 job 提前安装冻结 Playwright 所需 Chromium，没有启用自动 CI 或跳过真实 renderer 测试。新增顺序回归 3/3 通过，并通过 ESLint。
3. **JSONB 文本展开超过 4 MiB：已修复并独立复核。** 修复前应用接受的 4,182,120-byte compact wire，在 PostgreSQL 中展开为 4,243,081 bytes，超过原有 4,194,304-byte 上限，导致付费后写入拒绝。现在前置计划、压缩、site/gaps 及最终 parser 使用同一 PostgreSQL 文本预算，包括分隔空格、UTF-8 和指数展开；两处成本上界以 326-byte `Number.MIN_VALUE` 而非 309-byte `Number.MAX_VALUE` 计。真实本地 RPC 写入通过，保留 1,000 槽位与 9 个页面，compact 4,124,302 bytes、PostgreSQL 4,184,215 bytes、预算函数 4,184,215 bytes。SQL 上限未修改。独立 56 项回归通过；最终构建/整链证据见后续记录。

## 修复后最终本地候选

- 最终 Build ID：`PafZja4iqn4kIsNAZmlcI`，Marketing production build 通过，299 个静态页面；包含 #260 的 GSC API 路由。
- 四个预算源文件在 build 前后组合 SHA-256 均为 `8d3e350a2f5ef663e9e4576f0d4e16e628dff8da9b20d890606100eb293deb98`，没有把旧 build 的验证转记到新字节。
- 全量 unit：`--maxWorkers 4`，15,809 通过、1 个既有博客数量失败，77.38 秒。早先与 build 并行时出现的三项计时超时，在本次不并行 build 的运行中消失；没有修改测试 timeout。
- 真实本地 Marketing PostgreSQL：7 文件、92/92 通过，3.22 秒，包括新最大体积报告的实际 RPC 写入与 PostgreSQL 指数展开回归。
- 最终浏览器：7/7 通过，35.1 秒；构建 ID 前后相同。4 份 GEO 账本、6 份严格 JSON、7 份 Markdown 已独立读回，7 份 trace 的 1,536 条请求均发往本地。A/D 执行实际所属数据重建验证，B/C 没有组装或 Draft 调用。
- 最终 E2E 目录：`apps/marketing/test-results/geo-release-final-20260831`。认证/provider/store 为明确隔离 fixture，不能当作生产登录或付费 canary。
- 189 个变更代码路径 ESLint 已通过；最后 MIN_VALUE 两处修正及全部预算改动又单独通过 ESLint。新增 CI 顺序回归 3/3 通过；secret scan 再次通过。

## 较早 checkpoint（保留）

下列是预算修复之前的 checkpoint，不得转记为修复后最终验收：

- Build ID `ySqCN8ETqpP8ZLm7d72LA`：Marketing build 通过，298 个静态页面。
- 全量 unit：15,759 通过，1 个未修改的博客数量断言失败（80 vs 85）。
- 本地 Marketing PostgreSQL：6 文件、90/90 通过；不是生产数据库证据。
- 浏览器：加强版 GEO 4 例与 account-settings 3 例合计 7/7 通过；7 个 trace 的 1,525 个请求全部发往本地。实际 owner verifier、JSON/Markdown 下载读回和桌面/移动折叠入口检查通过。
- 全工作区 TypeScript、文档、active authority、spec verifier 自测、implementation、OpenAPI、secret scan 与 75 项 redaction 回归通过。
- 合入 #260 后，grant-cookie / GSC handler / briefing / traffic-drop / GEO enrichment 相关 5 文件、109 项回归通过。

## 仍未满足的生产前置条件

### 1. 数据库管理访问与恢复证明

Railway CLI 读取指定 `signalframe / worker / production` 返回 `Unauthorized. Please run railway login again.`；当前 Supabase 连接没有生产项目 `pxgzmoypkyyutpcmqexa` 的权限，不能误用可见的旧项目。已检查的既有本地配置也没有对应数据库连接串；Vercel Product 的生产连接变量为 sensitive。

需要在本机重新登录具有该 Railway 项目权限的账号。随后先取得逻辑备份、限制文件权限并完成隔离恢复验证，再执行本仓库两条 Marketing SQL 文件。`pnpm db:migrate` 和默认 `restore:drill` 面向 Product 的 `packages/db`，不能冒充 Marketing 迁移执行器。

两条新 SQL 必须在同一事务、遇错退出的条件下应用，且在流量切换前核对表/RLS/权限/触发器/复合外键/RPC。不得在有生产流量的表上照抄旧文档中的 TRUNCATE smoke。

新竞争品牌 aliases 仍属于 v1 payload；老版本解析器会移除该字段，导致旧读路径重新计算摘要不匹配。因此新格式开始写入后，不能声称直接回退到 `807e2cdc` 完全兼容。回滚必须保留新读取合同、关闭新写入或采取向前修复，不删除不可变历史表。

### 2. 隔离 renderer 的生产承载

没有已验证的现成主机。现有 Vercel 容器能力不直接执行 Compose，Fluid 的支持规格与当前最多 768 MiB / 1 CPU / 128 PIDs 的启动校验不匹配；GCP 当前项目的已启用服务没有 Compute Engine / Cloud Run / GKE。已向用户请求指定可复用主机，或批准新增独立 Linux 主机与月度预算。

保留原 Compose、seccomp、无 capabilities、只读根文件系统和 Chromium 沙箱。部署需要 TLS、独立 scoped token、外部常驻监管及目标主机实跑证明；不能用 `--no-sandbox` 或调大硬上限消除启动失败。[Vercel 容器说明](https://vercel.com/docs/functions/container-images)、[Fluid 内存规格](https://vercel.com/docs/functions/configuring-functions/memory)

## 既有全库门禁异常

- `verify:spec` 的 `package.json` 与 `README.md` 哈希已偏离 lock；两文件及 lock 与已发布基线逐字一致，不在本次改动中。
- 全量 unit 的博客数量断言仍固定为 80，而本次整合后的真实内容数量为 85。
- 全量 lint 先停在未改动的 public-tools 两个旧错误（空数组解构、未使用的 `imageExtension`）；单独 Marketing lint 仍有原来的四个旧错误。
- 原始审计/原型归档的 7 处 EOF 空行被首次 staged diff 检查报告；为了保留冻结证据字节，未改写归档。应用代码 diff whitespace 检查通过，不能把这说成全 diff 零警告。

没有生产迁移、renderer 资源创建、环境变量修改、生产 promote 或新的付费 provider 调用。恢复前置条件后，必须重新核对最终 SHA、候选/生产域名身份，并单独完成真实登录页面与当前提供方合同 canary。
