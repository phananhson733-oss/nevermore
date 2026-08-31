# GEO 原型对齐：最终本地验收

日期：2026-08-31。结论：本次批准的输入、输出与交接范围已完成本地实现及验收；**不是生产上线记录**。

## 代码与权限边界

- 基线：`807e2cdce85ed7e6cdde3016e3cfd178a0b45556`。
- 分支：`feat/geo-artifact-alignment-20260831`；独立工作树 `geo-artifact-alignment-20260831`，变更仍未提交。
- 原型：冻结的 666 行 JSX，SHA-256 `597746987d71170e80353fbcbad458a6c0596d10b867369b65e54bd0d9cebe2a`；38 条要求见 `requirements.csv`，逐项实现映射见 `implementation-acceptance.md`。
- 最终 Marketing 构建 ID：`7hnzuOvV6Asb00JWNOzqo`，构建文件时间 `2026-08-31T06:25:37.445Z`；E2E 前后和每份账本均核对这个 ID。
- 没有 commit、push、PR、部署、hosted migration 或新增付费 provider canary；没有复制生产密钥到工作树/renderer。
- 原主工作区及旧 release 工作树未修改。测试仅使用明确命名的本地 disposable Postgres 数据库。

## 完成的实际链路

1. Settings → Websites → GEO 为正式入口；旧 KB URL 保持同一资产的快捷入口，不再作为 Tools hub 中的独立资产卡。
2. Profile 继承、待核功能候选、真实 GSC/公开页面证据、GEO 覆盖项与不可变 context/问题集绑定。Profile/CAS 漂移及未建立正式 Website 的情况明确拒绝。
3. ChatGPT/Perplexity 按冻结计划采样，实际观测字段、SOV、问题覆盖率、分层位次/样本、历史版本、文件对比与完整待办贯穿导出。
4. 实际站点/引用页/T2 证据决定缺口；A/D → Brief，B → T2，C → 第三方待办；不足以归因的情况保留 unattributed。
5. GEO `gengrowth.content_brief/v1.1` 进入同一 Content Draft。Q1/评分要求、事实、空值原因、主题来源、角色、market/language 和全部版本锚保留；旧 SEO v1 继续单独解析。
6. Draft 服务端重新读取所属冻结数据与运行记录，公开 fingerprint 不构成认证。正文及模型标题受同一有限事实词面规则约束；Draft/B 的 T2 交接只预填，不自动提交。
7. T2 使用真实受限 Chromium 的两侧正文取证，确定性规则和共享根因分组；并非配置了一个永远不可用的 adapter。

## 最终门禁

| 门禁 | 实际结果 | 说明 |
|---|---|---|
| Marketing production build | PASS | 清空外部凭据的 `next build`；297 个静态页面，新 Settings/API 路由进入产物 |
| 全工作区 TypeScript | PASS | `pnpm typecheck`，包含 Product、Marketing、Worker 与共享包；最终 build 的 TS 检查再次通过 |
| 修改范围 ESLint | PASS | 对本轮修改/新增的代码文件运行；不是忽略全量 lint 的旧错误 |
| 全仓库 unit | 15,746 PASS / 1 既有失败 | 1,050 个文件通过；唯一失败为未修改的博客数量断言，见下节 |
| Marketing 真 PostgreSQL | 6 文件 90/90 PASS | 两条新增迁移、exact Profile/CAS、权限、不可变性、并发与实际持久化链 |
| 最终加强版浏览器链 | 4/4 PASS，15.9 秒 | 新 build；actual owner verifier，不再用简单指纹相等替代 |
| E2E fixture/SSR/负例 | 15/15 PASS | 错误 owner 与合法重 hash 的篡改在扣配额前拒绝 |
| 文档/authority/implementation consistency | PASS | 当前 Product v0.4 权威未被 Marketing 变更改写 |
| secret scan + redaction | PASS | secret scan 无发现；额外 75 项 redaction 测试通过 |
| `git diff --check` | PASS | 无空白错误 |

最终 unit 命令在 14:24:45 开始，耗时 74.65 秒；最终 SQL 在 14:24:44 开始，耗时 8.09 秒。此前局部通过数量只作阶段记录，不相加冒充唯一总数。

## 真实数据库与浏览器证据

`geo-persisted-chain.integration.test.ts` 通过实际 KB RPC 和 `recordVisibilityRunV2` 写入 PostgreSQL compact wire，再通过实际 `readVisibilityRunV2 → resolveOwnedVisibilityGap → resolveSharedBriefRunEvidence → assembleSharedGeoBrief → verifyOwnedGeoBrief`。未写入时返回 missing；合法 owner 为 true，错误 owner 和修改事实后重新计算 fingerprint 均被拒绝。不是只有一个内存对象假装已经保存。

浏览器最终产物位于 `apps/marketing/test-results/geo-chain-owned-final/`，共 23 个证据文件：

| 用例 | 实际结果 |
|---|---|
| A / en | canonical freeze → 90 个离线 provider 槽位 → 实际取证/缺口 → Brief → 新标签页共用 Draft → T2 手动提交 → 报告 |
| D / zh | 同一完整链；两语种界面与所有来源/版本/角色/问题字段保留 |
| B / en | 直接到 T2，正确预填；没有自动 T2 请求或 Brief/Draft 调用 |
| C / zh | 只下载第三方待办；没有内容生成动作/调用 |

A/D 每例实际调用一次 `verifyOwnedGeoBrief`，接受精确 user/snapshot；Brief 组装各一次，没有新一轮可见性采样。四例外联尝试和未预期 API 均为 0。浏览器退出后再次读回并严格解析了 2 份 Brief JSON、2 份 Draft JSON、2 份 V2 运行 JSON，以及保留冻结 hash 的 7 份 Markdown。

SSR 身份是测试专用、唯一组件 prop 的 fixture 注入；缺失/歧义会失败。提供方、认证、抓取与部分存储适配器为明确离线依赖。这证明当前 UI/handler/合同交接，**不冒充真实 Supabase 登录、付费 provider 或生产 canary**。真正的 SQL 持久化证据和真正的 renderer 运行证据分别独立执行。

主代理另在最终 build 的临时本地服务器中，通过应用内 Browser 检查公开 Tools hub/T2：不再出现独立 KB tile，两引擎说明正确，训练/检索用途说明正确，未提交报告请求。临时目视服务器按定时 SIGTERM 关闭（Node 退出 143），没有残留后台服务。

## Renderer 的独立实跑

详见 `apps/marketing/scripts/citability-renderer.md`。已实际构建并运行镜像 `sha256:8d500b6ffa5d1f2529356c0da9a0201d4c07ab4737ea1d51b33b5b42a27a7563`：Linux cgroup 768 MiB、1 CPU、128 PIDs，UID1000、只读根目录、无宿主 capabilities、no-new-privileges。实际 JS/外链 JS 捕获通过，无限脚本约 12 秒后 unavailable/null ratio，随后请求恢复正常；无硬资源边界的 production 入口在监听前拒绝。

后续 C05 修正未修改 renderer/runtime/Compose/seccomp：总行数仍 14，10 counted、4 advisory；实际分母继续排除未知与不适用。ClaudeBot 是训练用途，不能因为单独屏蔽它就形成 B；Claude-SearchBot/Claude-User 本次未测量。Google-Extended 的 Gemini training/grounding 与 Google Search 控制分开。[Anthropic 官方用途说明](https://privacy.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)、[Google 官方用途说明](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers#google-extended)

专用测试容器及网络已清理，镜像保留。已有 Colima profile 由本任务启动后保持运行，未停止/清理其他容器。Postgres 测试库 `signalframe_codex_geo_artifact_20260831` 与 `signalframe_codex_geo_chain_20260831` 为本轮明确创建的 disposable 数据；没有使用 hosted Supabase。

## 保留的真实限制

- 新 GEO 生成链只支持英语 primary 与英语地区变体；中文是界面语言，不代表实现了中文题库/生成。原 locale 保留，模型仅使用英语主语言。
- SOV 是条件回答比例；置信区间以问题为单位构造保守界，重复采样不增加独立问题数。少于 10 个问题/配对时区间不可用。区间依赖独立问题假设，不代表全市场结论。[Hoeffding 尾界来源与假设](https://www.stat.berkeley.edu/~stark/Teach/S240/Notes/ch1.pdf#page=15)
- 站点索引是受限的 declared/reachable inventory，A 的不存在判断只覆盖该范围，不是全网站/全互联网证明。
- GEO Draft 是有限词面与来源一致性校验，不是一般语义真实性判断。中性自由文本不被宣称全部已核实；不支持的模型输出会拒绝，不会自动改写成“有证据”。
- V2 只保留有界回答摘录/主题与来源元数据，不保存完整提供方回答。记录为 private append-only 历史；**当前没有自动 TTL 或 30 天删除流程**。新版本历史选择有显式 200 条资源边界，不静默截断；每份运行 wire 上限 4 MiB，证据省略量明确记录。
- 原有超长文件仍有维护债务；本次只按功能与安全边界做必要拆分，没有全面整理所有旧模块。

## 未修改的全库红项

这些文件及其相关内容在本轮 diff 中均未改动，不通过顺手调整断言或删变量掩盖：

- `apps/marketing/src/lib/blog-content.test.ts:167`：英文博客断言 80，当前仓库实际 84。全 unit 的唯一失败。
- `apps/marketing/src/components/tools/competitor-keyword-gap-tool.test.tsx:282`：未使用 `pressEnter`。
- `apps/marketing/src/components/tools/on-page-check-list.tsx:11`：未使用 `OnPageCheck`。
- `apps/marketing/src/lib/agents/draft-handler.ts:137`：未使用 `PLACEHOLDER`；同文件 147 行既有 `no-control-regex`。

## 发布边界

本轮没有发布新版本。上线前仍需按当前授权进行代码评审/合并、执行两条 Marketing 新迁移、托管隔离 renderer 并配置 `CITABILITY_RENDERER_URL` / `CITABILITY_RENDERER_TOKEN`，核对相应生成/采样环境配置，再分别取得真实登录页面、提供方和数据库的生产证据。现有本地 API KEY 或这份本地报告不能替代这些步骤。共享 `public-tools` 变更应保留旧 SEO/Product 回归，不套用先前 Marketing-only 部署的无影响结论。
