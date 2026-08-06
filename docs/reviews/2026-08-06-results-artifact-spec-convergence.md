# Results / 效果追踪：Artifact、v0.4 Spec 与生产实现逐项收敛

日期：2026-08-06
基线：`origin/main@c3776c3f374b56137ad99c688ab4486e6aa85f04`

## 结论

这次偏差不是 Results 后端缺失，而是前端信息架构没有收敛：真实实现已分别具备 technical recheck、immutable Measurement Window、GSC、GA4/UTM、目标词、GEO 引用和报告导出，但此前按实现边界纵向堆叠，未按客户 Artifact 的“结果摘要 / 页面改前改后 / Campaign / UTM”叙事组织。

修复保持现行 v0.4 合同不变，只重组生产前台并增加一个纯 view-model 汇总：

- 不新增或修改 API、OpenAPI、数据库、worker 或 provider 写入；
- 不跨 URL 或 Measurement Window 生成项目总数；
- 不把项目最近一次 technical recheck 假定为当前所选 URL 的复查；
- 不把 `null`、provider unavailable 或数据不足补成 `0`；
- 不把 Artifact 的离线“模拟分享”伪装成生产能力。

Artifact 视觉与交互依据见 `docs/artifact-src/client-app.js:1291-1324`；现行 Results 合同依据见 `authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md:293-301`、`packages/contracts/src/zod/recheck.ts:101-102` 与 `packages/contracts/src/zod/measurement.ts:1077-1083`。

## 逐项对照矩阵

| 项目 | 当前 Artifact | v0.4 / 机器合同边界 | 修复前生产实现 | 本次裁决与状态 |
| --- | --- | --- | --- | --- |
| Authority 版本 | `origin/main` 的静态 Artifact 是客户视觉与交互权威；旧保留分支中的同名文件内容已滞后 | `authority/implementation-spec-v0.4/` 是当前唯一机器合同 authority | 用户原 checkout 混合了旧 Artifact 与未提交的新 spec 内容 | 在干净 `origin/main` worktree 实施；不改 Artifact 本身 |
| 一级信息架构 | 三个页签：结果摘要、页面改前 / 改后、Campaign / UTM（`client-app.js:1296`） | `/results` 与 Measurement Window 是两个独立读取边界 | Measurement、recheck、report 三块连续纵向堆叠 | 增加三个 ARIA tabs；默认进入结果摘要；report/export 仍是下方独立客户输出 |
| 顶部 KPI | 自然搜索点击、转化、AI 引用、UTM 转化 | recent feed 明确没有 server-fabricated aggregate；每条 Measurement Window 对应一个 URL 和冻结窗口 | 无 KPI strip，必须下钻表格找数值 | 显示“当前所选 URL”四项：自然点击、GA4 直接转化、AI citations、已列 UTM Campaign 直接转化；不跨 URL 汇总 |
| KPI 缺失语义 | 场景数据主要用于演示 | `unavailable`、数据不足与真实 `0` 必须区分 | 明细表已区分，但没有摘要层验证 | 所有单值沿用 nullable pair；UTM 空列表、任一 phase 缺失或安全整数溢出均 fail closed 为 unavailable |
| 技术复查 | 摘要内显示技术条件复查、旧值、新值、验收值（`client-app.js:1312`） | latest recheck 只证明技术条件，DTO 没有 URL/window join，也没有 Artifact 的 expected-value 字段 | 独立 Panel 放在 Measurement 下方 | 移入摘要，但明确标为“项目最近一次复查 · 独立证据”；不制造 URL 关联或验收值 |
| 结论边界 | 已验证、已观察、数据不足、回执不等于效果（`client-app.js:1312`） | Results 必须是 observational / non-causal | 只有明细尾部 non-causal 文案与 limitation tooltip | 摘要增加四项边界卡；明确 unavailable 不等于 0，receipt 不等于 outcome |
| 时间线 | 动作回执与效果结果两条证据线（`client-app.js:1312`） | verified Change Receipt 才启动 Measurement clock；Delivery Receipt 不证明 live/outcome | 日期和 receipt 分散在四格元数据与独立 recheck 中 | 摘要把当前 URL 的 Change Receipt、before/after window、recordedAt 编排成两列；不把 project recheck 并入 URL 时间线 |
| 页面改前 / 改后 | 多页面表格与详情 overlay（`client-app.js:1317`） | Measurement Window 是 URL 级 immutable record，并保留 provider lineage | 左侧 URL selector + 右侧完整 GSC/GA4/rank/GEO 明细 | 保留更严格的生产主从视图，移入“页面改前 / 改后”tab；切换 URL 时所有证据同步 |
| Campaign / UTM | 独立 tab，含摘要与每个 UTM identity 明细 | direct / assisted conversion 必须分开，Campaign identity 不得丢失 | Campaign 表夹在页面长明细中 | 移入独立 tab；增加仅对“当前 URL、当前窗口、已列且字段完整 Campaign”的 Sessions / direct / assisted 合计；表格仍保留 identity |
| 分享 / 报告 | “模拟分享结果”只产生 `local-artifact://` 会话预览，不发邮件（`client-app.js:1653`、`2118-2122`） | 当前 active HTTP surface 没有结果分享写操作 | 已有真实 report/export rail，无 Artifact share UI | 不复制模拟分享按钮；保留真实 report/export rail，避免把离线场景包装成生产能力 |
| 回退生成 Opportunity | 计划材料包含结果回流目标态 | 当前 v0.4 Results/Measurement contract 没有从 regression 创建 Opportunity 的 command | 无入口 | 本次不实现；需要未来独立 typed command、权限与审计合同 |
| 无障碍 | tabs 支持方向键、Home、End；dialog/focus 有明确行为 | 生产 UI 需要稳定语义与键盘操作 | URL button 可键盘操作，但无 Results tabs | tabs 使用 `tablist/tab/tabpanel`、roving `tabIndex`、Arrow/Home/End 与 `aria-controls`；保留 URL selector 的 `aria-pressed` |

## 安全的 KPI 映射

| UI 指标 | 当前所选 `MeasurementWindow` 字段 |
| --- | --- |
| 自然搜索点击 | `dimensions.gsc.metrics.clicks` |
| 直接转化 | `dimensions.ga4.metrics.directConversions` |
| AI 引用 | `dimensions.geo.metrics.citations` |
| 已列 UTM Campaign 直接转化 | `dimensions.ga4.campaigns[].metrics.directConversions` 的 fail-closed 合计 |

UTM 合计规则：

1. `campaigns.length === 0`：before 与 after 都为 unavailable；
2. 任一 Campaign 的某个 phase 为 `null`：该 phase 不聚合，保留另一侧的真实值，delta unavailable；
3. 所有已列行均为安全整数：分别聚合 before 与 after；真实 `0` 保持为 `0`；
4. 任一 phase 的合计超出 JavaScript safe integer：整个 pair fail closed；
5. 该数字只能标注为“已列 Campaign 行合计”，不能称为项目总数或全量 UTM 总数。

## 查询与失败隔离

- Measurement loading/error/empty 不会吞掉独立的 technical recheck：摘要 tab 仍可终止为 recheck data 或 honest empty state；
- technical recheck 404/error 不会吞掉 KPI、页面明细、Campaign 或 report/export；
- page/rank/GEO 子查询仍由当前所选 Measurement Window ID 驱动；
- report/export 继续保留原打印边界，新的 Results chrome 均位于 `screenOnly` 区域。

## 验收证据

自动化覆盖包括：

- view model：单值 KPI、缺 phase、UTM fail-closed 合计、安全整数溢出；
- i18n：中英文 key parity；
- Results E2E：三个 tabs、默认摘要、KPI、键盘 End、URL 往返、page/rank、Campaign 切换；
- GEO E2E：URL 切换及 unavailable 不得显示为 `0`；
- 四模块工作台：Results 摘要、页面明细与跨模块主流程截图回归。

生产发布不需要 schema migration：本次 diff 不包含 `packages/db`、migration、OpenAPI 或 worker 变更。
