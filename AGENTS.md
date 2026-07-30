# Nevermore / GenGrowth Agent Operating Guide

本文件约束在本仓库中工作的 Codex、Codex 子代理及其他工程代理。产品与
合同细节以仓库中的 active authority 为准；本文件只定义工程执行方式、
双代理协作、权限和验收纪律。

默认代码修改、打包和测试范围是**当前 Git repository root**。父级
`nevermore` 工作区中的其他 checkout、`review-packages/`、`audit/`、
`.gstack/`、截图、历史 ZIP，以及 `/Users/wzb/Code/signalframe` 均视为
只读参考，除非用户在当前任务中明确把它们纳入范围。不得因本机路径不同而
把绝对路径写成永久规则。

## 1. 项目身份与不可混淆的权威

- **Nevermore** 是内部仓库、产品边界、授权边界和 system of record。
- **GenGrowth** 是客户可见品牌。历史 `SignalFrame`、`signalframe-*`、
  `@sf/*`、schema、数据库及 problem-type 名称只是兼容实现标识，不能重新
  成为客户品牌或产品信息架构。
- 客户工作台是中文优先的四模块产品：
  `概览 / 增长地图 / 执行中心 / 效果追踪`。
- 客户视觉与交互权威是仓库自有源码
  `docs/artifact-src/` 及其确定性生成物
  `docs/artifacts/GenGrowth-Interactive-Artifact.html`。不得另建一套
  authenticated App 截图作为第二个“canonical visual baseline”。
- 当前产品、HTTP 和数据库权威顺序：
  1. `authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md`
  2. `authority/implementation-spec-v0.4/openapi.yaml`
  3. `authority/implementation-spec-v0.4/schema.sql`
  4. `scripts/spec-v0.4-lock.json`
  5. `schemas/service-bundle-manifest.schema.json`
- 若本文件与 active authority、`CLAUDE.md` 或更高层级指令发生冲突，
  先遵守更高层级指令和安全边界，再把冲突作为合同缺陷报告，不得在代码里
  猜测兼容行为。

## 2. 双代理协作是复杂工程任务的默认模式

以下任一条件成立时，默认使用本文件定义的双代理流程：

- 跨多个文件或模块的功能开发、重构或缺陷修复；
- 架构、数据合同、迁移、权限、安全或生产发布准备；
- 四模块客户工作台、Artifact、真实数据链或复杂交互的收敛；
- 需要深入研究、长时间实现或独立复核的任务；
- 用户明确要求使用 ChatGPT Pro、外部高级工程师或“双 Agents”。

简单的只读查询、状态说明、单行文案修正或明显的机械修改可由 Codex 单独
完成，但仍须遵守权限和验收边界。

### 2.1 角色分工

**ChatGPT Pro：外部高级工程师**

- 深入研究问题并提出候选方案；
- 在收到的源码包范围内审查架构、设计和实现；
- 编写候选补丁、代码、测试或审查报告；
- 根据 Codex 提供的具体证据修正候选交付。

**Codex：总负责人和唯一验收人**

- 理解用户目标并维护需求、权限和验收标准；
- 检查仓库、工作树、运行环境和 active authority；
- 安全准备必要源码与任务说明；仅在当前任务明确授权外部上传时，才可把
  通过检查的最小源码包上传给 ChatGPT Pro；
- 创建、保存、恢复和监控 ChatGPT Pro 对话；
- 审查并落地候选补丁，不直接信任外部结论；
- 独立运行全部适用门禁，判断是否合格；
- 仅在用户本次请求明确授权的范围内提交、推送、部署或迁移。

ChatGPT Pro 的输出始终是**候选交付**，不是权威、审批或真实验证证据。
“两个模型都同意”也不能替代源码、合同、测试和生产事实。

Codex 原生子代理可以并行做只读探索、测试定位、安全审查或独立复核，
但它们不能替代 Codex 的最终验收，也不能自行扩大外部权限。

双代理流程不假定浏览器永久登录或 ChatGPT Pro 永久可用。若当前会话未认证、
服务不可用或用户不同意上传源码包，Codex 必须记录外部协作尚未执行并暂停
该环节；只有用户在当前任务中明确豁免后，才可改为 Codex-only 流程，且最终
报告不得把它描述成双代理交付。

## 3. 每个复杂任务的强制执行流程

### Phase 0：建立任务和权限账本

开始前写清楚：

- 用户的实际目标、非目标和可验收结果；
- 当前允许的读取、修改、上传和外部操作；
- 是否允许 commit、push、PR、deploy、数据库迁移、线上配置或真实数据操作；
- 哪些操作是本次一次性授权，不能继承到后续任务；
- 哪些事实只能在本地、CI、staging 或 production 中验证。

默认权限是：

- 可读取仓库、运行只读检查、修改本地代码并运行本地测试；
- **不可**向 ChatGPT Pro 或其他外部服务上传源码、补丁、客户数据或内部
  文档，除非用户在当前请求中明确授权外部上传；
- **不可** commit、push、创建 PR、deploy、迁移数据库、修改线上配置、
  启用生产功能或操作真实用户数据，除非用户在当前请求中逐项明确授权；
- ChatGPT Pro 的建议不会自动扩大权限。

若用户只授权 commit/push 而未授权 deploy/migration，必须在 push 后停止。

### Phase 1：仓库侦察与基线冻结

Codex 必须先完整阅读或核对：

- 本文件、`CLAUDE.md`、`README.md`、根 `package.json`；
- 与任务相关的 active authority、架构、运行手册、计划和审查记录；
- 当前分支、HEAD、remote、Git status、tracked/untracked changes；
- 适用的必跑门禁和安全脚本。

要求：

- 不覆盖、不丢失、不擅自清理用户或其他代理的已有改动；
- 记录源码 commit、分支、dirty state 和任务开始时的差异；
- 若需要隔离，使用独立 worktree 或安全的任务副本；
- 不把旧 PRD、历史 mock、离线场景或截图基线误当成 active authority。

### Phase 2：在当前任务获准外部上传后，安全准备源码 ZIP

不得假设 ChatGPT Pro 能访问本地路径、私有仓库、终端、数据库或内部环境。
只有当前任务已经明确授权外部上传，才可把完成任务所需的最小充分源码和
说明显式提供给它。没有上传授权时，可以先完成本地侦察、拟定任务说明和
最小文件清单，但必须暂停外部交付，不得以“双代理默认模式”为由自行外发。

源码包默认包含：

- 与任务直接相关的源码、测试、配置和必要文档；
- 根 `package.json`、lockfile、workspace 配置及适用的 authority；
- 为理解现有未提交改动所必需的补丁或文件；
- 一份不含秘密的任务清单与基线 manifest。

必须排除：

- `.git`、`node_modules`、构建产物、coverage、缓存和临时目录；
- `.next`、`dist`、`build`、`.turbo`、`.cache`、`.playwright*`、
  `.gstack`、备份 dump、历史 review package 和任务外截图；
- 数据库文件、对象存储内容、日志、队列/运行状态；
- 浏览器 profile、Cookie、local/session storage、下载历史和运行状态；
- `.env`、`.env.*`、API Key、Token、密码、私钥、证书、OAuth secret、
  Cookie、恢复码及其他凭据；
- 与任务无关的大文件、客户原始数据和个人信息。

上传前必须：

1. 检查 ZIP entry 清单、符号链接和路径，防止越界或意外打包；
2. 运行仓库 `pnpm secrets:scan` 及适用的额外密钥扫描；
3. 对包内文件名和文本再做一次凭据模式检查；
4. 记录基线 commit、dirty state、压缩包文件数、字节数和 SHA-256；
5. 在上传后向 ChatGPT Pro 明确说明它没有其他本地或生产访问能力。

若扫描发现疑似秘密，停止上传，先缩小包或移除敏感内容；不得把秘密粘贴进
对话来解释扫描结果。

### Phase 3：编写可验收的外部工程任务

发送给 ChatGPT Pro 的任务说明至少包含：

- 背景、用户问题、目标和客户影响；
- 当前架构、active authority 和不可破坏的边界；
- 已知事实、复现步骤、相关文件和已有测试证据；
- 需要研究、修改和明确不修改的范围；
- 期望交付物：报告、补丁、完整文件、测试或迁移建议；
- 必须执行的测试和期望结果；
- 禁止执行或禁止声称的操作；
- 可逐条判断的验收标准；
- 权限边界，以及“不得把 mock/local 说成 production”的诚实性要求。

任务说明必须要求 ChatGPT Pro：

- 标注假设、风险和未验证部分；
- 提供最小且完整的修正，不用绕过测试的方式掩盖问题；
- 不声称访问过未提供的仓库、环境、数据库或生产系统；
- 不提交、不推送、不部署、不迁移，也不操作真实用户数据；
- 返回精确文件路径、补丁/附件说明和实际运行过的命令。

### Phase 4：对话隔离、监控与恢复

- 每个相互独立的复杂工作流使用单独的 ChatGPT Pro 对话；
- 同一个根因的实现和修正留在同一对话，保留上下文；
- 保存每个对话的可恢复链接和任务映射；
- 允许长时间运行，不因耗时而催促、打断或重复发送同一任务；
- 只有在合理等待并连续检查仍无进展时，才检查页面状态或要求从最后完成处继续；
- 页面刷新、上下文截断或连接中断由 Codex 自主恢复，不让用户充当传话人。

若遇到登录失效、账号选择、验证码、密码、Passkey 或两步验证：

- 立即暂停该浏览器操作；
- 通知用户在指定浏览器中亲自完成；
- 不索取、不读取、不保存密码、Cookie、验证码或恢复码；
- 用户确认完成后，从原对话继续，不另开重复任务。

### Phase 5：候选交付接收与独立落地

ChatGPT Pro 返回后，Codex 必须独立完成：

1. 检查报告、补丁、源码和附件是否完整；
2. 核对附件文件名、字节数和 SHA-256；
3. 将候选补丁应用到隔离 worktree 或明确控制的当前工作树；
4. 审查差异是否越界、是否覆盖已有改动、是否新增秘密；
5. 核对依赖、版本、锁文件、生成文件和迁移顺序；
6. 对涉及第三方库/平台的结论核对官方文档和实际版本；
7. 检查权限、安全、project isolation、证据诚实性和外部写边界；
8. 只保留 Codex 能从源码和测试独立证明正确的部分。

不要因为候选补丁“看起来合理”就直接合并，也不要用修改测试期望、
删除覆盖或降低断言强度来制造绿色结果。

### Phase 6：风险对应的独立验收

以 `CLAUDE.md`、根 `package.json`、CI 和相关 authority 为准，至少运行
所有与改动相关的门禁。复杂发布候选通常包括：

```bash
pnpm verify:docs
pnpm verify:authority
pnpm verify:spec
pnpm verify:spec:test
pnpm implementation:check
pnpm contracts:check
pnpm openapi:lint
pnpm secrets:scan
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e:artifact
pnpm test:e2e:mock
pnpm test:e2e:real
pnpm deploy:check
```

按风险补充：

- 数据库/迁移：在**显式 loopback disposable database** 中执行两次
  `pnpm db:migrate`、`pnpm db:migrate:check`、`pnpm db:smoke` 和恢复演练；
- 客户 Artifact：执行 `pnpm artifact:regen` 两次并证明 worktree 无 drift，
  再跑 `pnpm artifact:verify` 和 Artifact E2E；
- UI/交互：验证中文优先、四模块信息架构、响应式、a11y、URL 状态和真实点击；
- worker/异步：验证真实临时 PostgreSQL、pg-boss、幂等、恢复和优雅退出；
- production：只有得到本次明确授权后才可验证或操作，且必须绑定不可变 SHA。

测试证据必须准确分层：

- `mock E2E` 只能证明 mock 边界；
- `real E2E` 在本仓库通常指真实 App/Worker/PostgreSQL 加确定性离线 provider seam，
  不是第三方生产 provider 验证；
- 本地真实数据库不等于 Supabase production；
- CI green 不等于已部署；
- unique deployment smoke 不等于 production origin；
- preview、Artifact `ready`、delivery receipt 不等于已发布或产生效果；
- 未执行的测试必须明确写“未验证”，不能用历史结果替代本次结果。

### Phase 7：证据驱动的纠错循环

发现候选交付有缺陷时，Codex 直接向原 ChatGPT Pro 对话反馈：

- 精确错误日志和复现命令；
- 失败测试、期望值与实际值；
- 文件路径、行号和违反的 authority/安全约束；
- 要求的最小完整修正和不能采用的绕过方式。

收到修正后重新执行 Phase 5 和 Phase 6。持续循环，直到：

- 全部验收通过；或
- 出现无法通过本地或已授权环境解决的真实外部阻塞。

普通实现选择由 Codex 和 ChatGPT Pro 自主讨论并决定，不要求用户传话。
只有登录、安全验证、不可逆操作授权或会改变重大产品方向的选择才交还用户。

### Phase 8：持久证据与最终报告

通过验收后，把有长期价值的内容保存到仓库允许的位置，例如
`docs/reviews/`、`docs/plans/` 或已有证据目录；不要只留在 ChatGPT 对话、
临时目录或浏览器会话中。不得保存凭据、完整生产日志或客户敏感数据。

最终报告必须包含：

- 若当前任务已获准并实际执行外部协作：ChatGPT Pro 对话链接及各自任务、
  源码 ZIP 的基线 commit、dirty state、大小和 SHA-256，以及 ChatGPT Pro
  的原始交付与被要求修正的问题；
- 若外部协作未获授权、未认证或未执行：明确记录原因，不得伪造对话链接、
  ZIP 或“双代理已完成”的结论；
- Codex 实际采用、修改或拒绝的内容；
- 独立测试命令、结果和证据层级；
- 仍未验证的风险与外部阻塞；
- 最终 Git 状态和 commit SHA；
- 代码究竟只是本地修改，还是已经提交、推送、创建 PR、部署或迁移。

## 4. Git、发布与生产安全

- 未经当前请求明确授权，不执行 commit、push、PR、deploy 或 migration。
- 授权必须按动作分别解释；“修复”“上线测试”“继续”不自动等于全部授权。
- push 前必须检查 `git diff`、目标 remote、目标分支和 CI 必跑门禁。
- 不 force-push，不覆盖远端历史，不清理未知改动。
- deploy 前必须遵循 `docs/DEPLOYMENT.md` 的顺序，并证明 Web、Worker、
  migration evidence 使用同一不可变 SHA。
- production migration 前必须先备份并完成 restore verification。
- 不把生产凭据打印到终端、ChatGPT Pro、提交、报告或用户消息中。
- 若当前授权明确排除 deploy/migration，即使测试全绿也必须在 push 后停止。

## 5. 本仓库的客户体验保护线

- 客户界面以中文为主；英文保留给 English Blog、Keyword、URL、标准名、
  provider 名和代码等必要对象。
- 关键词库与竞品库是增长地图的内置核心功能和判断依据，不是外部附属页面。
- `概览 / 增长地图 / 执行中心 / 效果追踪` 必须保持统一四模块工作台；
  英文 route/internal alias 不能替代客户可见中文名称，`/context`、
  `/sources` 是二级入口，兼容路由不能重新变成一级导航。
- App 应融合真实后端判断逻辑，但不得用另一套视觉壳替换已批准 Artifact。
- 客户可见数据必须来自 canonical read models 或明确标注的 scenario Artifact；
  不得把 mock/scenario 数据渲染为真实客户数据。
- GSC、GA4、Crawl、DataForSEO、CSV、provider seam 和生成式内容的来源、
  时间、可用性、限制和 lineage 必须诚实呈现。
- `unavailable` 不是 `0`；无证据的结果、发布、PR、排名、收入或 attribution
  不得推断或承诺。

## 6. 完成定义

只有同时满足以下条件，任务才可标记完成：

- 用户目标和验收标准逐项有证据；
- 若当前任务实际启用了 ChatGPT Pro：候选交付已被 Codex 独立审查，而非
  直接采信；
- 适用的静态、合同、单元、集成、构建和 E2E 门禁通过；
- 没有秘密、权限扩大、未声明 mock 或未验证生产声称；
- 有价值的报告和证据已持久保存；
- Git、push、deploy、migration 和 production 状态被准确报告；
- 没有把“代码已写”“本地测试通过”或“CI 通过”误报为“已上线”。

## 7. 仓库与营销站发布标识

- GitHub 代码仓库与 Vercel Git 集成的唯一源仓库都是
  `phananhson733-oss/nevermore`（完整地址：
  `https://github.com/phananhson733-oss/nevermore.git`）。引用仓库、核对
  remote、发布来源、Production Branch 或排查 Vercel 构建问题时，必须使用
  这个唯一标识；不得改用本地目录名、其他 fork、Vercel 组织名、部署 URL
  或项目显示名。
- GenGrowth 营销站源码位于 `apps/marketing`，生产域名为 `gengrowth.ai` 和
  `www.gengrowth.ai`。Vercel 界面中显示的 `gengrowth-agents` 只是该营销站
  的项目显示名，不是另一套 Git 仓库，也不是另一个发布来源。
- `apps/web` 对应应用站 `app.gengrowth.ai`，与营销站是独立发布目标。用户
  授权“只发布营销站”时，只能发布营销站产物，不能借此发布 `apps/web`、
  worker、数据库或其他工作区改动。
