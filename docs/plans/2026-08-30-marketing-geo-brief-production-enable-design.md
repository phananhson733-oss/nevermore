# GEO Brief 生产启用设计

日期：2026-08-30  
基线：`origin/main` / `e9a5735dd28d3560c6f77f64bcc883e2bfc44abd`  
范围：`gengrowth.ai` Marketing 项目；不修改 Product、Worker 或数据库 schema

## 目标

把已经部署但因模型配置缺失而关闭的 GEO Brief 生成器推进到可用生产状态，复用现有 Azure OpenAI 凭据，同时保留 GEO Brief 自己的配置、预算与停用边界。

完成必须同时证明：

1. Azure `gpt-5.6-luna` 收到它要求的 `temperature=1`，而不是任务默认的 `0.2`；
2. 没有 `GEO_BRIEF_API_KEY` 或 `GEO_BRIEF_MODEL` 时仍在扣配额前返回 `503 provider_unconfigured`；
3. GEO Brief 不回退到 `CONTENT_BRIEF_*`、`CONTENT_DRAFT_*`、`KEYWORD_MAP_*`、`OPENAI_*` 或 `AZURE_OPENAI_*`；
4. 生产配置、不可变部署 SHA、登录后页面、一次真实 Brief、导出和 provider 费用边界均有证据；
5. Marketing 发布不冒充 Product 发布，且共享 `main` push 后独立核验 `app.gengrowth.ai` 的生产身份。

## 已有能力与复用边界

旧 GEO Agent 的 provider transport 只负责 DataForSEO ChatGPT LLM Responses 采样：读取 `DATAFORSEO_LOGIN/PASSWORD`，向固定 DataForSEO endpoint 发送冻结模型名和买家问题。它没有 Azure 组装调用，也没有 temperature resolver。

GEO Brief 已正确复用这条 DataForSEO transport 做一次问题采样；第二次调用是不同职责的结构化 Brief 组装，继续使用 `keyword-llm-client.ts` 的受限 Chat Completions transport。

Content Brief 已有成熟的 scoped configuration 规则：

- 独立 `<PREFIX>_API_KEY` 与 `<PREFIX>_MODEL`；
- 可选 `<PREFIX>_URL` 与 `<PREFIX>_AUTH_SCHEME`；
- 可选 `<PREFIX>_TEMPERATURE`，只接受 `0..2` 的有限数字；
- 缺失或非法 temperature 回退为任务自己的温度；
- 不回退到相邻工具或全局 provider 配置。

GEO Brief 沿用这套规则，但不抽出新的共享 abstraction：当前只有两个简单 resolver，直接保持模块内的小函数更符合最小改动原则。

## 代码设计

在 `apps/marketing/src/lib/geo-tools/brief-llm.ts` 增加一个模块内 `pinnedTemperature` 解析器，并让 `resolveGeoBriefLlmConfig()` 把 `GEO_BRIEF_TEMPERATURE` 解析结果写进 `KeywordLlmConfig.temperature`。

行为如下：

| 配置 | 解析结果 | 实际请求温度 |
|---|---:|---:|
| 未设置 `GEO_BRIEF_TEMPERATURE` | `null` | 任务默认 `0.2` |
| `GEO_BRIEF_TEMPERATURE=1` | `1` | `1` |
| 空、非数字、负数、超过 `2` | `null` | 任务默认 `0.2` |

不增加新的 public error code，不改变 route response，不改变 prompt、输出 schema、配额顺序、超时或调用次数。

## 配置设计

生产 Azure 映射为：

- `GEO_BRIEF_API_KEY`：现有 Azure key；
- `GEO_BRIEF_MODEL`：Azure deployment 名；
- `GEO_BRIEF_URL`：完整 `/openai/deployments/<deployment>/chat/completions?api-version=<version>` URL；
- `GEO_BRIEF_AUTH_SCHEME=api-key`；
- `GEO_BRIEF_TEMPERATURE=1`。

DataForSEO 继续读取现有 `DATAFORSEO_LOGIN/PASSWORD`。任何 secret 只写入 Vercel secret store 与未提交本地 env，不进入 Git、测试输出、日志或发布记录。

同步更新根 `.env.example`、`.env.gengrowth-production.template`、Marketing `.env.example` 与 `docs/INFRASTRUCTURE.md`，使变量名称、默认行为和 Azure 要求成为部署合同。

## 错误与费用边界

运行顺序保持：认证 → 精确冻结版本/问题验证 → provider 配置检查 → 重读冻结行 → 每日配额 → DataForSEO 采样 → LLM 组装。

因此：

- 缺配置不扣配额、不采样、不调用模型；
- DataForSEO 失败与 LLM 失败继续分别披露；
- LLM 400/超时/非法 JSON 不会返回一份假完整 Brief；
- 不增加重试；
- 真实 canary 只执行一次，失败先取证，不盲目重复付费。

## 测试设计

严格测试先行：

1. 新增 `GEO_BRIEF_TEMPERATURE=1` 的 resolver 测试，先观察当前实现返回 `null`；
2. 新增非法温度表格测试；
3. 新增 client request 测试，证明 pinned `1` 覆盖任务默认 `0.2`；
4. 保留“只读自己前缀”和“缺 key/model 返回 null”的回归测试；
5. 运行 GEO Brief、全部 GEO tools、Marketing typecheck、定向 lint、全量 unit 与 production build；
6. 已知、未触碰的 baseline 红项与补丁回归分开报告。

## 发布设计

从独立 worktree 提交、推送并创建 PR。合并前做独立 diff review；合并后等待 `gengrowth-agents` Production 在 exact merge SHA 上 READY，并核对 `gengrowth.ai`、`www.gengrowth.ai`、英文/中文路由与 runtime error logs。

共享 `main` 可能唤醒 Product Vercel 项目，即使没有 `apps/web` diff。发布报告必须单独记录 Product candidate 状态与 `app.gengrowth.ai` 当前生产 SHA。

本次没有 schema 变更，不重跑 0006/0007。恢复生产数据库只读权限后，只重跑 catalog/ACL/trigger/RPC 查询。

登录后 canary 覆盖：读取冻结版本、生成一份 Brief、页面渲染、JSON、Markdown、复制内容和无裸 i18n key。若需要重新登录、验证码、Passkey 或 2FA，停在认证点让 Owner 操作。

## 明确不在本次范围

- 拆分 `kb-store.ts` 或 `geo-knowledge-base.tsx`；
- 修复未触碰文件里的既有 lint 红项；
- 修改 Visibility 统计、采样、Workflow 或数据库；
- 复用其他工具的 LLM key 作为 silent fallback；
- 新增 Draft、历史、持久化或自动发布能力。
