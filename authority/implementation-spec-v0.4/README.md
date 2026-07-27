# Nevermore Publication and Attribution Authority v0.4 — Review Candidate

状态：**candidate**

规范性：**non-normative**

候选版本：**0.4.0**

当前 active authority：[`../implementation-spec-v0.3/`](../implementation-spec-v0.3/)

本目录冻结 Nevermore 下一阶段授权交付的评审候选，不是已发布的产品事实。它不会激活任何 HTTP operation、数据库迁移、运行时 package、GitHub/WordPress 外部写入或 Results 归因。当前 `package.json`、共享 `openapi/mvp.yaml`、生成客户端、active migrations、`scripts/spec-v0.3-lock.json` 与 v0.3 verifier 仍以 v0.3 为唯一 normative machine surface。

只有 Task 8 将 working routes、repositories、workers、provider adapters、迁移、共享 OpenAPI、generated contracts、rollback/recovery、测试和正式 v0.4 lock **原子地**落入同一个实现变更后，本候选才可以被重新审核并晋升。目录存在本身不构成晋升。

## 候选文件顺序

1. [`openapi.candidate.yaml`](openapi.candidate.yaml)：拟议 HTTP 请求、响应、状态和错误边界。
2. [`schema.candidate.sql`](schema.candidate.sql)：拟议 append-only publication persistence；不可作为 migration 执行。
3. [`provider-boundaries.md`](provider-boundaries.md)：GitHub App 与 WordPress 授权、能力探测、交付、reconciliation、撤销和回滚边界。
4. [`repository-invariants.md`](repository-invariants.md)：approval、并发、幂等 replay、rollback 与 receipt lineage 的事务强约束。
5. [`acceptance-matrix.md`](acceptance-matrix.md)：必须在晋升前由直接测试证明的正向、拒绝和诚实状态。
6. [`scripts/verify-candidate.mjs`](scripts/verify-candidate.mjs)：仅验证候选自身和未晋升边界，不替代 active v0.3 verifier。
7. [`../../scripts/spec-v0.4-candidate-lock.json`](../../scripts/spec-v0.4-candidate-lock.json)：候选文件哈希、拟议 inventory 和 active/candidate 身份锁。

## 唯一 canonical lifecycle

候选继续扩展同一条链，而不创建第二套内容、目标或结果 truth：

```text
Project
→ Snapshot / Observation
→ Evidence
→ Finding Review
→ Action
→ durable Artifact Approval Event for an exact Artifact Revision
→ authorized Publication Attempt
→ Delivery Receipt
→ verified provider merge/publish + live canonical URL
→ Change Receipt
→ Recheck / Outcome Observation
→ Results
```

- `target_ref` 只引用 Action/Finding 已拥有的 canonical target；publication 表不得复制、修正或取代 target 定义。
- `execution_artifacts.status = ready` 与 `updated_at` 都不是批准事实。`artifact_approval_events` 用 append-only `approved | revoked | superseded` 事件冻结精确 `artifact_revision_id`、revision、content hash、QA gate snapshot 与客户 acknowledgement。每个事件的实际操作人记录为 `eventActorId`；只有 `approved` 事件具有 `reviewerActorId`，terminal event 通过 source approval 保留原 reviewer lineage。
- project/artifact-scoped approval-events GET/POST 是该 ledger 的唯一候选 HTTP 边界：event actor 来自已认证 session，服务端重读 canonical Artifact Revision 并验证 revision/hash/QA；跨 scope、hash 不一致、terminal actor 缺失或重复终止事件 fail closed。
- approval POST 只提交 revision identity、必要 optimistic preconditions 和客户 acknowledgement；Artifact content hash、QA snapshot/hash 由服务端从 canonical revision 与 QA authority 生成。publication POST 只提交 `approvalEventId` 获取 Artifact/revision/hash，不接受这些事实的客户端副本。
- 客户端只提交 server-issued `authorizationGrantRef`、approval event id 与 preview/rollback-plan 引用；authorization snapshot、capability facts 和 resolved rollback plan 均由服务端重读、验证并冻结，不能接收客户端自述。
- `async_runs` remains status truth。publication attempt 只冻结请求、授权、preview、rollback、远端 precondition 和 provider 响应事实。
- Task 8 的同一原子 migration 必须保留所有现有 `async_runs.kind/result_type` 值，并新增唯一稳定轴 `kind = publication`、`result_type = publication_attempt`；queued/running/completed/failed 继续只由 canonical async run 表达。
- 一个 GitHub PR、WordPress Draft 或 Scheduled post 只产生 `delivery_receipt`，客户状态仍为 `pending`；候选不存在 `delivered` 状态。
- 只有先存在同 attempt、同 provider、同 content checksum、同 `remoteScopeRef` 的 `delivery_receipt`，并且 GitHub merge 与真实部署 URL 均验证，或 WordPress 状态为 `publish` 且 live canonical URL 通过验证，才可产生带 `predecessorDeliveryReceiptId` 的 `change_receipt`。
- receipt 本身不证明 traffic、ranking、conversion、revenue 或 GEO improvement。任何正向 Results 必须来自后续独立、不可变、有时间窗与限制说明的 Observation。

## 冻结的请求边界

每个 publication attempt 必须同时冻结：

- `workspaceId`、`projectId`、`siteId` 和 project/site-scoped destination revision；
- canonical `targetRef`、Action、Artifact、`approvedArtifactRevision` 和 `approvedArtifactContentHash`；
- publish 的当前 durable `publicationApproval`（不得已有后续 revocation / supersession）与 publish authorization snapshot；
- provider kind `github | wordpress`；
- `sideEffectClass: external_write`；
- `previewRef` 和 preview checksum；
- `idempotencyKey` 与 canonical request hash；
- `remotePrecondition`（精确当前 remote revision，或明确 must-not-exist）；
- provider-specific rollback plan。
- `attemptKind = publish | rollback`；rollback 必须冻结同 scope/provider/target 的 `sourcePublicationAttemptId`，且源 attempt 已有 verified Change Receipt。其 `sourceApproval` 仅是历史 lineage，可以后来已 revoked/superseded；rollback 必须另行生成当前 `authorizationPurpose=rollback` 的授权、客户 acknowledgement、preview 与 expected current remote revision，绝不复用原 publish authorization。

任一项缺失、过期、跨项目、被撤销或不可用时都必须在外部写入前 fail closed。Idempotency-Key 继续沿用 active 合同的 1–128 位 printable ASCII 边界；原 key + 原 hash 的 same-hash replay 永远只读返回同一 attempt/run/receipts，不再调用 provider；相同 key 不同 hash 返回冲突；旧 payload 换新 key 必须重新校验当前 destination、approval、preview、authorization 与 remote revision。`app.idempotency_keys` 仍负责共享 HTTP 窗口内的请求幂等；publication attempt 的永久唯一约束是在该共享记录过期后继续防止 external-write 重放，属于补强而不是替代。并发互斥继续由 canonical `async_runs.active_key` 与 `async_runs_one_active_key_idx` 提供，publication 表不得创造第二个 active status。

## 客户可见诚实状态

- `pending`：授权或 delivery 已发生，但尚未验证 live change。
- `changed`：存在满足 delivery predecessor 与 provider/live verification 的 Change Receipt；这不是正向 Results。
- `unavailable`：provider、权限、credential、remote precondition 或 live verification 当前不可用，并附具体原因。
- `revoked`：授权被撤销；新的外部写入禁止，历史 receipt 保留。
- rollback 是新的显式授权请求和独立 attempt，不是删除或改写历史 receipt。

候选不允许 active-looking customer control。Task 8 真实实现前，GitHub 仍是 planned delivery connector；WordPress 只可在未来 publication destination flow 中出现，不能变成第四个顶层分析数据源。

## 机器发现与候选验证

[`../index.json`](../index.json) 明确 v0.3 是唯一 active/normative authority，v0.4 只是 non-normative candidate。候选报告可用以下命令生成；它同时拒绝候选进入共享 OpenAPI、active lock、migration 或 runtime：

```bash
node authority/implementation-spec-v0.4/scripts/verify-candidate.mjs --report
```
