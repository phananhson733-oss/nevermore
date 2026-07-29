# Nevermore × ChatGPT Pro 双代理工程复核与本地验收（2026-07-28）

## 结论

本轮最终结论是：**当前本地源码通过仓库级静态门禁、单元测试、真实
PostgreSQL integration、生产构建、Mock E2E、Real E2E、静态客户
Artifact E2E 和本地恢复演练；但没有验证 hosted Supabase、真实
GSC/GA4/DataForSEO、生产登录、GitHub Actions Ubuntu runner 或
`app.gengrowth.ai` 线上运行。**

因此本报告使用“本地验收通过”，不使用“已经上线”“生产验证通过”或
“真实客户数据验证通过”。

本轮没有提交 Git、没有推送、没有创建 PR、没有部署、没有运行 hosted
数据库迁移、没有修改线上配置、没有访问真实用户数据，也没有触发任何
外部发布写入。

---

## 1. 基线、边界与仓库事实

| 项目 | 本轮事实 |
|---|---|
| 仓库 | Nevermore / GenGrowth |
| 工作树 | `/Users/wzb/.config/superpowers/worktrees/signalframe-mvp-app/unified-growth-opportunity-v03` |
| 分支 | `codex/content-research-quality-v04` |
| 基线 HEAD | `94ec37cd12fb6959743f3afc0e7670eff8120711` |
| 产品版本 | `0.3.0` |
| 运行合同 | `2026-07-21` |
| Active authority | v0.4 |
| Authority inventory | 77 API operations、9 shared async operations、76 application tables、11 frozen rules |
| 迁移范围 | 32 个，至 `0032_keyword_initial_governance.sql` |
| 客户主导航 | 恰好四个：概览 / 增长地图 / 执行中心 / 效果追踪 |

本轮持续执行的产品边界：

- 关键词库、竞品库和 Backlink 是增长地图中的一级对象模式，不是第五个
  客户模块，也不是平行 SEO 工具。
- 客户可见连接仍只有 GSC、GA4、GitHub；Crawl、DataForSEO 和内部
  证据流水线不伪装成客户连接。
- 当前 authority 仍不允许外部发布写入；本轮没有扩大授权。
- 浏览器生产边界仍是同源 `/api/mvp`；生产认证不会自动创建 membership。
- Local Real E2E 指本地真实 Next/API/worker/PostgreSQL、loopback
  dev-auth 和离线 provider seam；它不等于 hosted auth 或真实 provider。
- Static Artifact 是客户演示/交付物，不是生产应用或线上数据证明。

---

## 2. 提交给 ChatGPT Pro 的安全源码包

四个任务被拆到四个独立对话，避免 Growth Map/CI、Studio/i18n、
Keyword governance 和 Worker recovery 的上下文相互污染。

| 任务 | ChatGPT Pro 对话 | ZIP | 字节 | SHA-256 |
|---|---|---:|---:|---|
| A — Growth Map、Real E2E、CI Linux visual capture | [对话 A](https://chatgpt.com/c/6a68ab7b-f970-83e8-9818-2137ec5dfb51) | `nevermore-task-a-growth-map-real-e2e-ci-94ec37c.zip` | 1,770,975 | `19e6e992e8ac5a291ae290216b4d6469edca583278d2b2e0f20f71cc72bc3c69` |
| B — Studio error、i18n、Mock E2E | [对话 B](https://chatgpt.com/c/6a68abf2-01d4-83e8-ba95-caf87819d52e) | `nevermore-task-b-studio-i18n-error-mock-e2e-94ec37c.zip` | 1,230,884 | `c075178d344514d072eafcf286ed181964aa2a528cea7856e03f29357c52e738` |
| C — Keyword Review DB clock | [对话 C](https://chatgpt.com/c/6a68b796-6878-83e8-8c11-4f7d79a273a3) | `nevermore-task-c-keyword-review-clock-94ec37c.zip` | 180,356 | `0ec0c33be6e3fea14277ab1beef9de45001d054554f4adc19a6ca6fb1d1c5b22` |
| D — Content Shadow recovery clock harness | [对话 D](https://chatgpt.com/c/6a68b7ee-2be8-83e8-aca2-05869de216eb) | `nevermore-task-d-recovery-clock-harness-94ec37c.zip` | 190,424 | `4549ca2d36099773d8acd2ccbd7fff3a0dc864c601e54c4f6c5779c23711a40d` |

持久保存位置：

```text
/Users/wzb/Code/nevermore/review-packages/2026-07-28/
```

所有包均以 HEAD `94ec37c` 为源码基线。A/B 包含当时的前端与 E2E
工作树修改；C/D 是后续数据库/测试缺陷的最小定向包。ChatGPT Pro
无法访问本机工作树，因此后续每个新 finding 的精确文件、行号、diff
和测试结果都在对应对话中重新提供，未假设它能读取本地文件。

打包与上传前后的安全证据：

- ZIP 清单复查未发现 `.git`、`node_modules`、`.next`、`dist`、
  `build`、coverage、Playwright 运行产物、数据库文件、浏览器状态、
  `.env*`、私钥、证书或 Cookie 文件。
- 四个 staging tree 以高信号规则复扫；未发现 OAuth token、API key、
  private key、JWT 或非空 secret assignment。
- C/D staging tree 还直接运行仓库 `scripts/secrets-scan.mjs`，均通过。
- 最终仓库 `pnpm secrets:scan` 通过，并通过 75 个 redaction tests。
- SHA-256 与字节数在最终交付前重新读取，与上传时记录一致。

---

## 3. 实际修改

### 3.1 Growth Map：同步保留最后一次真实用户意图

[Growth Map client](../../apps/web/src/app/p/[projectId]/growth-map/_growth-map.tsx)
最初曾通过 Next RSC transition、optimistic row/detail 与 intent journal
重放最后一次查询；该机制在快速点击时仍可能被较早的异步响应覆盖。此实现已于
2026-07-29 退役。当前同页 Growth Map 查询状态使用 Next App Router 支持的
native History API 同步写入 URL，使地址、选中行、详情、指标和 Finding
identity 在同一次客户意图中更新。

对应的 Real E2E 断言整个同页交互不会发出 `_rsc` 请求，并覆盖：

- Pages → Keywords → Competitors → Pages 快速往返；
- URL A → B → A；
- Keyword、Competitor 与 URL 行选择均保持零 `_rsc`；
- 地址、选中行、detail、metrics 和 Finding 均以最后一次 intent 为准。

### 3.2 Project isolation：保留 readiness，并新增跨项目 pending 边界证明

[Project isolation E2E](../../e2e/project-isolation.spec.ts) 先等待项目 A 的
Sources 投影真实可见，再让项目 B 经过 `/report → /results`，最后同时
复核两边 UI、URL 和 API project scope。

最终只读审查一度提出“项目 A 的 Growth Map journal 可能被项目 B
复用”的 P2。没有直接接受这一推论，而是新增真实边界测试：

1. 进入项目 A Growth Map；
2. 在 A 的 DOM 根写入 instance probe；
3. 历史实现曾 hold A 的真实 `_rsc` 响应并确认
   `data-navigation-pending`；该异步同页导航已于 2026-07-29 退役，
   当前 Growth Map 查询状态使用同步 History API；
4. 通过真实项目切换器进入项目 B；
5. 释放 A；
6. 验证 B 的 DOM 已替换、switcher 为 B、URL 精确为 B 的 Growth Map，
   且 search 为空。

反向 mutation 时保持原始 `page.tsx`（不加 `key={projectId}`），测试仍
通过，DOM probe 也消失。Next 16 的 route state key 将动态参数值纳入
segment identity；不同 `[projectId]` 会重建 leaf/page subtree，而 shared
layout 才保留状态。因此该 P2 被 Codex reviewer 和 ChatGPT Pro 双方撤回，
没有把冗余 `key` 当成“修复”合入。

### 3.3 Studio：错误证据与中文首屏

[Frontend error E2E](../../e2e/frontend-error-states.mock.spec.ts) 将生成错误
的断言限定在 Studio canvas 的 `Error details`：

- stable error code；
- stable request ID；
- raw provider detail/credential 不可见；
- 第二次生成成功后，旧问题面板必须消失。

[Critical flow E2E](../../e2e/critical-flows.mock.spec.ts) 和同一 error spec
在请求前写入 `sf_ui_locale=zh-CN`，直接验证 SSR first paint 的
`html[lang=zh-CN]`。它们不再在冷启动 hydration 之前点击 locale button，
避免测试把“丢失的点击”误判为产品 i18n 回归。实时语言切换仍由既有
navigation case 覆盖。

### 3.4 CI：Linux visual candidate 是独立 review lane

> **历史记录，已于 2026-07-29 退役。** 下述 authenticated App
> candidate lane 已删除，不得恢复；客户视觉权威仅为仓库自有 GenGrowth
> Artifact。

[CI workflow](../../.github/workflows/ci.yml) 新增显式
`workflow_dispatch.update_linux_visual_baselines`：

- 只有人工启用时才用 Ubuntu runner 生成 Linux snapshot candidates；
- 普通 push/PR 继续运行原始 Real E2E，不更新 snapshot；
- candidate 只上传短期 artifact，不提交、不部署、不自动接受；
- workflow permissions 保持 `contents: read`。

顶层 concurrency 加入 `github.event_name`，避免 manual capture 与同 ref
的 push/PR validation 互相取消：

```yaml
group: ci-${{ github.workflow }}-${{ github.event_name }}-${{ github.ref }}
```

### 3.5 Keyword Review：PostgreSQL 是唯一 decision instant authority

[Keyword governance repository](../../packages/db/src/repositories/keyword-governance.ts)
不再把 Node `Date` 作为持久化审核时间。原子 UPDATE 使用：

```sql
greatest(
  clock_timestamp(),
  keyword_entities.updated_at + interval '1 microsecond'
)
```

并以 `UPDATE ... RETURNING updated_at` 的真实值作为唯一 `decidedAt`：

- entity `updated_at`；
- append-only `keyword_review_decisions.decided_at`；
- synthesized projection；
- returned decision。

四者使用同一 instant。这样即使数据库时钟领先应用主机、或两个审核落在
同一毫秒，revision 仍严格单调。没有增加 migration、schema、API 或
authority 变更。

回归覆盖未来时间的旧 entity、相同请求并发 replay、连续 revision、
stale revision conflict、ledger/entity 精确一致，且没有 sleep/retry。

### 3.6 Topic split/merge/retire：第二个 Keyword writer 同步修复

Codex 在全仓 writer trace 中发现
[TopicModelsRepository](../../packages/db/src/repositories/topic-models.ts)
的 split/merge/retire invalidation 也是 `keyword_entities` 的生产 writer。
它现在使用同一 DB-authoritative `UPDATE ... RETURNING` 规则，并将返回的
instant 精确写入 system invalidation decision。

Topic model/alias 的 `confirmed_at` 仍是 topic event time；keyword
invalidation 的 `decided_at` 是 keyword governance time。当前 migration、
trigger、contract 和 read model 没有规定这两个不同事件必须同刻，因此未
人为绑定。

### 3.7 Content Shadow recovery：修测试时钟，不改生产补偿语义

[Content Shadow integration test](../../apps/worker/src/content-shadow/__tests__/run-content-shadow.integration.test.ts)
原来以 PostgreSQL `now()` 写 `started_at`，随后由 Node `new Date()` 配合
`missingAfterMs: 0` 判断；两个主机时钟的微小偏差可让测试错误地保持
`running`。

测试现在使用固定且明确有序的：

- `staleStartedAt = 2026-07-28T20:59:59.999Z`
- `recoveryNow = 2026-07-28T21:00:00.000Z`

并显式把 `now` 传给现有生产 recovery。未修改 production recovery，
未用 sleep、retry 或提高 timeout 掩盖。

---

## 4. ChatGPT Pro 被要求修正的内容

### 对话 A

1. 初版对 Linux snapshot 目录作了不完整判断，后续撤回。
2. 两轮审查均漏掉 manual `workflow_dispatch` 与 push/PR 共用
   concurrency group 的 P2；收到精确 YAML 和事件时间线后承认漏报，并
   接受 `event_name` 最小修复。
3. 后续又把“不同 `[projectId]` 复用同一 GrowthMapClient”从理论风险
   错误升级为当前 P2；收到无 `key` mutation、held-RSC Real E2E 和 DOM
   instance probe 后明确撤回，接受保留原 `page.tsx`、只保留边界测试。

### 对话 B

初版对 Studio error/i18n 的判断存在自相矛盾和过宽断言。收到 canvas
scope、problem identity、成功后清除和 SSR-first-paint 的精确约束后，
接受最小测试修正；没有要求修改产品 copy 来迁就测试。

### 对话 C

1. 第一版提出新增 `0033` migration/function，扩大了 authority/schema
   范围；收到“当前 trigger 已能守 invariant、应在 writer 内原子取得
   DB time”的约束后撤回。
2. 第一轮 writer trace 又漏掉 TopicModels 的 keyword invalidation。
   Codex 用全仓 `.update(keywordEntities)` 证据追问后，ChatGPT Pro 承认
   trace 不完整，并接受对两个生产 writer 使用同一最小策略。

### 对话 D

确认 Content Shadow 失败是 deterministic test harness 的跨时钟问题，
不是生产 recovery 已失效；接受固定 `started_at + options.now`，不修改
production compensation。

---

## 5. 独立验收证据

### 5.1 静态、authority 与合同门禁

| 门禁 | 结果 |
|---|---|
| `pnpm verify:docs` | 9 / 9 |
| `pnpm verify:authority` | 77 operations / 9 async / 76 tables / 11 rules / 32 migrations |
| `pnpm verify:spec` | 通过 |
| `pnpm verify:spec:test` | 43 / 43 |
| `pnpm implementation:check` | 通过 |
| `pnpm contracts:check` | generated OpenAPI 无 diff |
| `pnpm openapi:lint` | 通过 |
| `pnpm deploy:check` | 通过；app.gengrowth.ai web-only、Supabase state、Railway worker-only 的静态配置一致 |
| `pnpm secrets:scan` | 扫描通过；redaction tests 75 / 75 |
| `pnpm artifact:verify` | 4 routes、56 declared actions、14 forms、无未覆盖 action/form |
| `git diff --check` | 通过 |

### 5.2 代码、数据库与覆盖率

| 门禁 | 结果 |
|---|---|
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm test` | 462 files / 5,609 tests |
| `pnpm test:integration` | 79 files / 566 tests |
| 完整 coverage gate | 541 files / 6,175 tests |
| Statements | 88.05%（28,634 / 32,520） |
| Branches | 81.51%（20,810 / 25,530） |
| Functions | 91.43%（5,389 / 5,894） |
| Lines | 89.40%（27,036 / 30,241） |

新的 Topic invalidation real-PG regression 在完整 integration 前还连续运行
20 次，20 / 20 通过。Keyword manual review、Topic invalidation 和
Content Shadow recovery 均在 fresh migrated PostgreSQL 中进入最终
integration/coverage 结果。

### 5.3 浏览器与客户 Artifact

| 类型 | 结果 | 它能证明什么 |
|---|---|---|
| Mock E2E | 179 / 179（29 files，0 failed，0 skipped，6.0m） | 浏览器 UI、mock API 合同、四模块、Growth Map 对象模式、Studio/i18n/error、响应式和 a11y；不证明真实 DB/provider |
| Local Real E2E | 43 / 43（0 failed，0 skipped，3.3m） | 本地真实 Next/API/worker/PostgreSQL、项目隔离、Growth Map RSC race、B2B/B2C 链；provider 为离线 seam |
| Static Artifact E2E | 20 / 20 | 四个中文优先路由、8+ URL、多对象库、Execution 客户交付物、Results before/after/UTM、dialog、a11y、390–1440 px |

Artifact 当前静态证据：

- `GenGrowth-Interactive-Artifact.html`：590,823 bytes；
- `GenGrowth-Product-Manual.html`：68,050 bytes；
- 四个主路由；
- 客户可见连接恰好 3 个；
- 57 次 action exercise、14 个 form；
- 主阅读文字在 390 / 768 / 1024 / 1440 px 均不少于 16 px；
- 无 workstation path、内部 audience block 或 runtime error。

### 5.4 构建、容器与恢复

| 项目 | 结果 |
|---|---|
| `pnpm build` | Next.js 16.2.11 production build 通过 |
| Worker Docker build | 通过；Linux/arm64、USER `node`、最终镜像 `sha256:29cc47d7db8095a808a6e9b2866704bfa61ad4cf6bdd3910790bd759272a2319` |
| Worker image inspect size | 269,051,147 bytes |
| PostgreSQL | `postgres:16-alpine`，仅 loopback `127.0.0.1:32774` |
| Fresh migrate check | 76 tables / 17 authority hash columns / 99 indexes / 140 triggers / 60 routines |
| Restore drill | migration replay、schema smoke、76 tables、row/canonical/object checksum 全部一致 |

最终验收完成后，仅属于本轮的精确本地资源已清理：

- 删除容器 `nevermore-codex-fixes-pg-0728`
  （ID `dc37a609d4e8997ac4500fa37eff9263a5266c6d71e9bc9d04b96ed18297ecc0`）；
- 删除可重新构建的本地镜像 tag
  `nevermore-worker-codex-review:0728`
  （image `sha256:29cc47d7db8095a808a6e9b2866704bfa61ad4cf6bdd3910790bd759272a2319`）。

该容器内的 disposable 测试数据库不可恢复；它不包含 hosted、客户或生产
数据。其他既有 Docker 容器、开发服务和镜像均未操作。

Restore drill 的临时证据哈希：

- JSON：`dded866850b830205607baf47a55fd1c08102e77f0cd4afe2958ec65a3025dc4`
- Markdown：`4544369eaa898fe6091ba498ce5259d27fa7a7b7d4a3082543cfa85835c62ca9`

一次误用 `pnpm test:e2e:real -- ...` 时，脚本后的 `--` 没有过滤
Playwright inventory，导致在已经跑过的数据库上启动完整 suite。新的
跨项目测试与其余 41 项通过；AC-044 被
`Real E2E requires a fresh disposable database with no pg-boss jobs`
主动拒绝，AC-045 未运行。这个失败是 fresh-database safety gate 正常
工作，不计入最终结果。

另一次完整 Real E2E 与 179 条 Mock E2E、第二个 Next dev server 和
Chromium 并发运行时得到 41 passed / 1 failed / 1 did not run。AC-044 在
10 秒 UI 断言窗口内仍看到 Studio 初始 Loading；当时 PostgreSQL 中已经
存在 7 个 ready artifacts，并出现 1–3.2 秒慢查询和 MaxListeners 告警。
这次并发失败被保留为资源争用证据，不能当作通过，也没有靠增加 timeout
掩盖。

随后在新建 fresh database、无 Mock E2E 并发的环境中单独运行
AC-044/AC-045，2 / 2 通过。最终裁决使用第三个全新数据库
`signalframe_codex_real_e2e5_0728`，独占运行完整 43 条：

- 43 passed / 0 failed / 0 skipped，Playwright 3.3m，退出码 0；
- 32 个 migration 全部应用，运行前 `pgboss.job` 不存在；
- AC-010 双项目隔离、held-RSC 跨项目边界、AC-044 B2B 和 AC-045 B2C
  全部通过；
- 运行后 14 个 pg-boss job 全部 completed，0 个非终态 job；
- 0 条 `db_slow_query`、0 条 structured warn/error、0 条 API/连接超时；
- 原始运行日志为 75,587 bytes，SHA-256
  `8e37ced3f25680a9596582a179c9325fdc63a662c5414d204f33b7e3df398523`。

最终独占 run 仍产生 16 条 Next WebServer Socket
`MaxListenersExceededWarning`；它不影响 43 / 43 结果，但继续作为第 6
节中的非阻断风险。

---

## 6. 尚未验证的风险

以下项目仍然是明确外部边界，不能从本报告推导为已完成：

1. 未登录或操作 hosted Supabase；未验证生产 RLS、真实 OAuth、
   pre-provisioned membership 或线上 schema。
2. 未读取真实 GSC、GA4、DataForSEO、GitHub 或客户站点数据。Local Real
   E2E 的 Google/Crawl/provider 是显式离线 seam。
3. 未在 `app.gengrowth.ai`、Vercel、Railway 或任何生产域名运行。
4. 未触发 GitHub Actions；Linux visual candidate 仍需在真实 Ubuntu
   runner 生成并人工审核。本机未安装 `actionlint`，因此没有声称
   GitHub-hosted workflow 已执行。
5. Real E2E 可重复出现 Next WebServer Socket
   `MaxListenersExceededWarning`（11 个 `unpipe/error/close/finish`
   listener）。它没有导致测试失败，但应单独调查 listener 注册/释放；
   不建议用提高 max listeners 隐藏。
6. Redocly 报告有新版本、npm 报告若干未来弃用配置；当前 OpenAPI
   validation 仍通过，但升级应另开受控任务。
7. 本地 Worker image 是 arm64；没有在生产架构或真实 registry 做
   pull/run 验证。

---

## 7. 最终代码与外部状态

最终 HEAD 仍是
`94ec37cd12fb6959743f3afc0e7670eff8120711`。工作树包含本轮 12 个 tracked
修改文件，以及 1 个未跟踪的本报告；没有暂存内容。`apps/web/next-env.d.ts`
已恢复为 tracked canonical 状态，Real/Mock E2E 生成目录和测试服务均无
残留。

本轮远程状态：

- Git commit：**未创建**
- Git push：**未执行**
- Pull Request：**未创建**
- 部署：**未执行**
- Hosted migration：**未执行**
- 线上配置：**未修改**
- 真实用户数据：**未访问**

本报告只裁决当前本地工作树。任何后续提交、推送、部署或生产数据接入，
都需要新的明确授权和对应环境验证。
