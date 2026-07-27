# Slice 2 Task 5 — 主 agent 对 OQ1-OQ9 的裁决(2026-07-25)

配套蓝图:`2026-07-25-slice2-task5-redline-b-blueprint.md`(同目录)。
以下裁决是**硬约束**,Task 5 实现 agent 不要重新讨论。凡与蓝图正文冲突的,以本文件为准。

---

## OQ1 — 未注册 `rule_id` 被 confirm 时的错误码

**裁决:采纳推荐,503 `DEPENDENCY_UNAVAILABLE`,但必须是显式抛出的 typed error,不是裸 `TypeError` 冒泡。**

理由:未注册 rule 是**服务端规则集/模板注册表配置缺口**,不是客户端输入错误——客户端提交的 findingId 完全合法。4xx 会误导操作员去改请求。503 语义("依赖的模板注册表没有覆盖该 rule")对操作员和监控都诚实。

实现要求:在 `action-templates` 查表未命中处显式抛,错误 payload 带上 `ruleId`,便于定位缺失映射。**禁止**用 fallback 模板兜底(那会静默铸出错误 artifact 类型)。

---

## OQ2 — dismissed Action + 重新 confirm 的语义

**裁决:采纳推荐,保持现状,不自动复活。** Task 5 只定义错误语义(见 OQ8 的错误码族),不改 `findByKey` 的查询谓词。

理由:自动复活 dismissed Action 等于绕过 Action 状态机——操作员显式 dismiss 过的东西,不该被一次 finding re-confirm 静默拉回 active。这正是红线 B "无第二确认路径" 想禁止的那类隐式路径。

补充要求:必须为 "confirmed 但零活跃 Action" 这个**已被证明可达**的状态定义明确错误码(蓝图关键发现 4)。Task 4 只写了 `===1`,`0` 的分支必须补齐:**422**,code 用现有 `INVALID_STATE` 族里语义最贴的一个(实现 agent 按真实 ProblemCode 常量表选,并在总结里说明选了哪个、为什么)。0 是**客户端可修复**的状态(操作员可以取消 dismiss 或走正常路径),所以是 4xx 而非 5xx。

---

## OQ3 — `confirmFinding` 的 `last_seen_run_id` TOCTOU

**裁决:采纳推荐,纳入 Task 5。** 事务内重读 → 不匹配则 409。

理由:这是 Slice 1 遗留的真实并发缺陷(现表现为 500),影响所有 vertical,而 Content Shadow 的红线 C(冻结输入可复现)**直接依赖** `last_seen_run_id` 的血缘正确性——留着它就是在冻结一个可能已经漂移的血缘。~10 行的修复换掉一个 5xx,值得。

**附加硬要求(防回归)**:
1. 必须新增覆盖该竞态的回归测试(集成层,并发或人为交错两个事务)。
2. **绝不允许**为了让这条通过而修改/削弱任何既有 Slice 1 测试。若既有测试因此变红,那是真实语义变化,必须停下来报告,不要就地改测试。
3. 该修复单独成一个 commit 或在 commit message 里显式标注,便于 Slice 1 回溯。

---

## OQ4 — `english_blog_draft` 的拒绝落点

**裁决:service 黑名单(采纳推荐),但必须同时修掉更深的 fail-open 缺陷。**

蓝图关键发现 5 暴露的真正问题不是"缺一条黑名单",而是 `artifacts.ts:182-183` 的校验是**fail-open** 的:`if (expectedType && …)` —— 当 `actions.template_id` 是未知值(DB 侧 text 无约束)时,`expectedType` 为假,**整条类型校验被跳过**,任意 wire 枚举值都能通过。

**两条都要做**:
- (a) 显式黑名单:`english_blog_draft` 只能由 Content Shadow worker 铸造,公开路由一律拒(422)。这与 `templates/index.ts:37` 已有的抛错保持一致语义。
- (b) **改 fail-open 为 fail-closed**:`expectedType` 解析不出来时必须**拒绝**(未知 template 的 action 不该能挂任意类型 artifact),而不是放行。

不采纳窄枚举方案——会把零契约税的 Task 变成有税,且 wire 枚举仍需保留 `english_blog_draft`(worker 侧要用)。

---

## OQ5 — 是否为 A5 加 DB 层检查

**裁决:采纳推荐,不加。** Task 5 保持零迁移。

理由:`execution_artifacts.status` 的 archived/active 属**人工状态机**,不属血缘不变式;把它写进 provenance 触发器会让状态机变更被迫拖迁移。service 断言 + 集成测试 I5 足够,且 I5 本身正是"为什么不能只靠 DB 层"的实证。

---

## OQ6 — `countActionsForFinding` 是否改口径含 dismissed

**裁决:采纳推荐,不改。**

理由:该函数已被 Slice 1 的 `technical-opportunity-vertical.integration.test.ts` 依赖并处于绿态,改口径会连带影响已验收的 Slice 1 证据链。若 Task 5 需要"含 dismissed 的计数",**新增一个语义明确的第二函数**(如 `countAllActionsForFinding`),不要重载既有语义。

---

## OQ7 — Task 4 实际代码与蓝图边界表冲突时以谁为准

**裁决:采纳推荐,以已 commit 的 Task 4 代码为准**,Task 5 只做 diff 补齐。

附加要求:Task 5 实现 agent **开工第一步**是读 Task 4 的实际 commit diff(不是蓝图),逐条核对边界表里标为"Task 4 已覆盖"的断言是否真的落地了。**任何名义已覆盖但实际缺失的断言,归 Task 5 补**,并在总结里列出这份"蓝图声称已有但实际缺失"的清单——这是对 Task 4 验证的交叉检验。

---

## OQ8 — `>1` 个非 dismissed Action 的错误码

**裁决:不采纳 503,改为 409 `CONFLICT` 族(实现 agent 按真实 ProblemCode 常量表选最贴的)。**

理由:蓝图推荐 503 的前提是"该状态被 UNIQUE 证明不可达 → 属数据破损"。这个前提**不成立**:`UNIQUE (source_finding_id, template_id)` 只保证"同一 finding + 同一 template 至多一条"。若规则集版本演进导致同一 `rule_id` 映射到新的 `template_id`,同一 finding 就能合法地拥有两条不同 template 的 Action —— 这是**可达的正常演进状态**,不是破损。

503 会告诉调用方"稍后重试",而重试永远不会好,这是不诚实的信号。409 + 明确 message(点名冲突的两个 actionId)才能让操作员知道要人工收敛。

**实现要求**:在代码注释里写清这段可达性论证(为什么不是 5xx),避免后人按"UNIQUE 保证唯一"的错误直觉改回去。

---

## OQ9 — search / generative 两组 id 交集的断言归属

**裁决:确认归 Task 4(R4 scope 检查),Task 5 只加 hash 敏感性单测。**

但这是**待验证的假设**,不是既成事实:Task 4 agent 是否真的实现了交集拒绝尚未确认。

**执行路径**:
1. Task 4 完成后,主 agent 的对抗式验证工作流把 "search/generative 集合交集是否被拒绝(invariant 8)" 列为**必查项**。
2. 若 Task 4 已落地 → Task 5 只补 hash 敏感性单测(交换两组元素后 contentHash 必须变化)。
3. 若 Task 4 **未**落地 → 该断言**降级归 Task 5**,按 OQ7 的 diff 补齐原则处理,走 422。

---

## 跨 OQ 的统一约束

- **错误码一律从真实存在的 ProblemCode 常量表里选**,不要新造字符串字面量。实现 agent 必须先读该常量表,在总结里列出"每条断言 → 选定 code → 选它的理由"的映射表。
- **零契约税仍是 Task 5 的验收条件之一**:`pnpm contracts:check` 必须 no diff。若某条裁决导致产生了税,停下来报告,不要静默扩大范围。
- **诚实报告**:任何一条裁决在实现中被证明行不通,写进总结的"已知遗留问题",不要为了让 gate 变绿而悄悄改语义或削弱测试。
