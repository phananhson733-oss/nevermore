# GEO 工具集 · 设计（营销站 tools）

日期 2026-08-29 · 基线 `origin/main` 1969d7ce · 分支 `feat/marketing-geo-tools-20260829`

## 0. 这份文档是什么

Owner 2026-08-28 交来 `geo-handoff-package.zip`（下称「原方案」）。评审结论：方向成立，但按原文不能开工（三个「已有」假设为假、成本口径缺失、数据模型无租户列、随附代码有若干会说谎的缺陷）。评审报告：https://claude.ai/code/artifact/c65e224a-46a6-4baf-bf2a-90e9c5d93dd9

Owner 裁决（2026-08-28 晚）：

1. 做成**多个独立的 GEO tools**，不以 Agent 形式存在；代码与功能允许和 `/agents/geo` 重叠、重复。
2. 入口是 4 个 tool：知识库 / AI 可见性体检 / 页面可引用性检查 / GEO Brief 生成器。
3. 预算暂不设限，先做。
4. 目标是「一串可用的简单 tools」，不是 Agent。

本文档把原方案 + 评审 + 裁决收敛成可实现的规格。**与原方案冲突时以本文档为准。**

## 1. 四个工具

| slug | 登录 | 外部成本 | 一句话 |
|---|---|---|---|
| `page-citability-check` | 否 | 无（3 次 HTTP 抓取） | 一个 URL，14 项检查：AI 抓取器能不能读到、读到了能不能抽出来 |
| `geo-knowledge-base` | 是 | 无（抓本站 + 竞品首页） | 品牌别名 / 品类词 / 竞品映射 / 已核实事实，冻结成不可变版本，并生成提问集 |
| `ai-visibility-check` | 是 | 约 $9.6 / 轮 | 用冻结的提问集跑 DFS ChatGPT 采样，出可见性指标 + 引用来源 + 缺口清单 |
| `geo-brief` | 是 | ≤2 次 LLM | 把一条缺口或一个提问变成可写作的 Brief |

代码根目录：`apps/marketing/src/lib/geo-tools/`（与 `lib/agents/geo-*` 并列，允许重复实现）。

## 2. 已裁决事项（D1–D12，全部按推荐）

- **D1 引擎**：v1 单引擎 `DataForSEO ChatGPT LLM Responses`。UI 从第一天按「引擎多选」建模，但 `engines.length === 1` 时不渲染 byEngine 表与「跨引擎混合」标签。Perplexity（DFS 有 `/v3/ai_optimization/perplexity/llm_responses/live`，仅 Live、每平台 30 并发）作为后续 PR，需先做措辞标定。
- **D2 知识库**：独立工具页 + 自有表 `marketing_geo_*`，按 `user_id` 隔离 + RLS；冻结 = append-only 快照行（照 `0005_account_websites.sql`）。首次进入时若账号已有确认过的网站档案，提供**一次性导入**预填，不做双向同步。
- **D3 提问集**：三层模式化。`discovery` / `comparison` 只从模板注册表渲染，标 `retrieval`，进引用分母；`problem` / `evaluation` / `branded` 允许 LLM 扩写与人工改，标 `natural_demand`，引用数只报不进分母。角色语汇只能进句子前半段，不得出现在句尾。
- **D4 规模**：默认 42 题 × n=5 × 1 引擎 = 210 次调用；表单印出「210 次调用 · 约 $9.6 · 约 15 分钟」，三个数字全部由常量推导。归因候选题自动补采到 n=10。安全阀（非预算限制）：每用户每日 5 轮 + 全站日熔断。
- **D5 对比基线**：服务端。每轮落一行 `marketing_geo_runs`（聚合指标 + 逐题计数，**不含回答原文**），对比读同指纹的上一轮。另提供导出运行文件 + 两文件对比（纯无状态）。
- **D6 SOV**：保留但改名「品牌同场提及率」，副标题印「已确认竞品 N 个」；全部竞品未确认时不出数。
- **D7 零观测分界**：`ZERO_CLAIM_UPPER_BOUND = 0.10`。`successes === 0` 且 Wilson 上界 ≤ 0.10 才可写「0.0%」，否则写「本次 n=x 未观测到（上界 y%）」。阈值印在页面上。
- **D8 归因**：上线即带「归因 beta · 阈值未标定」标并印出阈值；判定按 Wilson 区间而不是原始计数；未达门槛一律 `unattributed` 并写明「样本不足（0/5，上界 43%）」。
- **D9 Brief**：独立上线，不依赖 content-draft。出口 = 页面 + `.json` + `.md` + 「复制 Brief 给 AI」。不渲染「生成 Draft」按钮。
- **D10 T2 限流**：自有桶 `geo-citability:ip`（匿名 20/小时）、`geo-citability:target`（30/小时）、登录 60/小时。不走 `crawl-gate`（那是整站爬取的闸门）。抓取一律 `fetchPublicResource`（8s / 1.5MB / SSRF pin）+ 单飞。
- **D11 bot 分组**：**检索组**（计入结论）`OAI-SearchBot · ChatGPT-User · PerplexityBot · ClaudeBot`（= 仓库 `AI_BOT_USER_AGENTS`）；**训练组**（只展示、不计入）`GPTBot · Google-Extended`。
- **D12 身份与兜底**：v1 不接 GSC 角色聚类（GSC 是 `gg_id` 身份，知识库是 Supabase 身份）；ICP 角色手填，可从网站档案 `buyer/user/jtbd/primaryIcp` 预填。`officialName` 抽取失败时用域名主体兜底并强制用户核对。C 类缺口出口维持不开（只导出待办）。

## 3. 从评审继承的强制修正（不再讨论）

1. **四态**：`pass | fail | fetchError | notApplicable`。「未填目标提问」「页面没有 FAQ 结构化数据」是 `notApplicable`，不是抓取失败。通过率分母 = 总数 − fetchError − notApplicable。
2. **文案不进引擎层**：规则与统计函数返回结构化数据（`messageKey` + `values`），中文/英文文案在 i18n。`formatProportion` 返回判别联合，不返回句子。
3. **robots 三态**：`{ status: "ok", text } | { status: "absent" }`（404/410 ⇒ RFC 9309 全部允许）`| { status: "unreachable", httpStatus }`。匹配对象是 `pathname + search`。
4. **SSR 判定双条件**：`ssrRatio = 1` 只在原始正文达标时成立；正文不足且未完成渲染取 ⇒ `fetchError`，绝不判 pass。v1 **不做渲染取**（仓库无 JS 执行器），文案写明。
5. **超时**：`SAMPLE_TIMEOUT_MS = 90_000`，超时**不重试**（重试是再一次计费）。只有请求未发出的网络错误才允许重试。
6. **采样契约**：`Sample` 必带 `webSearchPerformed`；引用分母 = `ok ∧ webSearchPerformed === true`（检索层）。唯一键区分 `sampleIdx`（第几次独立采样）与 `providerTryIdx`（第几次尝试）。
7. **匹配不用子串**：品牌提及与实体覆盖走 NFC + 整词 + 最短长度，本站域名判定用 `host === own || host.endsWith("." + own)`。
8. **归因输入三态**：站点索引 `ok | empty | partial`；目标页 T2 结果 `missing | unknown | fail | pass`。非 `ok`/`pass` 一律不产出 A/B/C，返回 `unattributed` 并写明原因。
9. **交接走仓库唯一机制**：`lib/tools/tool-handoff.ts`（单 key、精确键集、10 分钟 TTL、读一次即删、新标签页 `rel="opener"`）。新增 destination 与 payload variant，不引入 `gg:brief:<runId>` 这类按 run 的键。
10. **随附包不整体入库**：`schema.sql`、`content-brief.v1.1.ts`、`types.ts` 的 `ActionCard/ActionStatus/T3Output/AnswerBrief/DeltaReport.attributedTo` 一律不入库。

## 4. 交付顺序

| PR | 内容 | 上线后可用 |
|---|---|---|
| 1 | `page-citability-check`：stats + 规则集 + 限流桶 + 页面 + 注册面 | 免登录工具独立可用 |
| 2 | `geo-knowledge-base`：迁移 + store + 页面 + 提问集生成 + 冻结 | 资产可建立 |
| 3 | `ai-visibility-check`：Workflow 管线 + 结果页 + 归因 + 服务端 run 行 + 对比 + 导出 | 体检闭环 |
| 4 | `geo-brief`：缺口/手动入口 + Brief 生成 + 导出 | 内容链起点 |

每个 PR 单独合并即上生产（main 自动部署 Vercel `gengrowth-agents`）。PR 之间的交接按钮，在目的地路由存在之前**不渲染**（房规：没有落点就不给按钮）。

## 5. 注册面（每个 PR 的 DoD）

新增一个 slug 必须同步：路由 `page.tsx`（scoped messages）、`tools/page.tsx` 的 GEO 分组、`tools-hub-contract.test.ts` 有序 slug 数组、`client-message-scope.test.ts`、`config/sitemap-tools.ts` 与其测试、`i18n/messages/{en,zh}.json`、route 的 `runtime`/`maxDuration` 测试、e2e mock（如该套件覆盖同类工具）。
