# v0.4 Candidate Acceptance Matrix

状态：review-only candidate。以下每一行都必须在 Task 8 原子晋升前拥有直接 contract/repository/worker/provider 测试；本文自身不证明实现存在。

| ID | 场景 | 必须冻结或验证 | 期望结果 |
|---|---|---|---|
| PUB-POS-DURABLE-APPROVAL | 已认证 reviewer 对精确 Artifact Revision 完成 QA 与客户确认 | project/artifact scope、revision id/number/content hash、reviewer、QA gate snapshot/hash、customer acknowledgement | append-only `approved` event；不调用 provider，不自动发布 |
| PUB-POS-APPROVAL-TERMINAL-LINEAGE | 另一已认证 actor 撤销或 supersede 已批准 revision | terminal `eventActorId`、source approved event、Artifact/revision/hash/QA/ack/reviewer lineage | terminal event 的 `reviewerActorId=null`；source approval 保留原 reviewer；一个 source 只有一个 terminal |
| PUB-NEG-TERMINAL-ACTOR-MISSING | terminal event 没有可验证 authenticated actor，或客户端伪造 actor/reviewer | session actor、source approved event、approved-only reviewer semantics | 401/422；不写 terminal event |
| PUB-POS-CANONICAL-ASYNC-RUN | publication attempt 被受理 | 保留全部历史 kind/result_type，使用 `kind=publication`、`result_type=publication_attempt`、canonical active_key | queued/running/completed 状态只来自 `async_runs`；attempt 表不复制状态机 |
| PUB-POS-GITHUB-DELIVERY | 已授权 GitHub destination 对 exact approved revision 创建 PR | project/site、target_ref、installation、repository selection、base branch、permission probe、preview checksum、remote precondition、rollback、idempotency | append-only attempt + `delivery_receipt`；状态仍为 `pending`，没有 Change Receipt |
| PUB-POS-GITHUB-CHANGE | PR 已 merge 且部署后的 live canonical URL 对应 merged SHA | predecessor Delivery Receipt、同 attempt/provider/content checksum/remoteScopeRef、merged SHA、deployment mapping、live canonical URL、evidence refs | append-only `change_receipt`；只允许后续 measurement lineage，不声明正向 Results |
| PUB-POS-WORDPRESS-DELIVERY | 创建 WordPress draft/future post | site scope、encrypted secret reference、capability probe、author/status allowlist、preview、post revision precondition | append-only attempt + `delivery_receipt`；状态 `pending` |
| PUB-POS-WORDPRESS-CHANGE | WordPress 返回 publish 且 live canonical URL 验证通过 | predecessor Delivery Receipt、同 attempt/provider/content checksum/remoteScopeRef、exact post revision、publish status、canonical ownership、bounded live verification | append-only `change_receipt` |
| PUB-POS-IDEMPOTENT-REPLAY | 相同 idempotency key 与相同 canonical request hash 重放 | 已存在 attempt 的全部冻结输入 | 返回同一 attempt/receipt；不产生第二次外部写入 |
| PUB-POS-STALE-SAME-KEY-READONLY-REPLAY | 原 attempt 后 destination/approval 已撤销，再以原 key + 原 hash 重放 | permanent attempt ledger、canonical request hash、已有 run/receipts | 只读返回同一历史 attempt/run/receipts；不重新验证为新写入，不调用 provider |
| PUB-NEG-STALE-REPLAY-NEW-KEY | 旧 payload 换新 key，且 destination/approval/remote revision 已 stale、revoked 或 drift | 当前 destination、current approval、authorization、preview 与 remote precondition | 409/422；不得把新 key 当作历史 replay，不调用 provider |
| PUB-NEG-STALE-APPROVAL | approval 指向旧 Artifact Revision 或已被新 revision 取代 | 当前 artifact revision、approval event、approved content hash | 外部写入前 409/422 fail closed |
| PUB-NEG-MUTABLE-CONTENT | preview/content 未冻结，或 checksum 与 approved revision 不同 | approvedArtifactRevision、approvedArtifactContentHash、preview checksum | 拒绝，不创建 attempt |
| PUB-NEG-CROSS-SCOPE-TARGET | destination、site、Action 或 target_ref 属于其他 project/site | workspace/project/site 与 canonical Action target lineage | 404/422；不泄漏其他项目存在性 |
| PUB-NEG-MISSING-PREVIEW | previewRef 或 preview checksum 缺失 | immutable preview identity | 422；没有 provider 调用 |
| PUB-NEG-MISSING-ROLLBACK | provider rollback plan 缺失或不可执行 | provider-specific rollback plan + current remote precondition | 422；没有 provider 调用 |
| PUB-NEG-IDEMPOTENCY-HASH-MISMATCH | 同一 idempotency key 携带不同 request hash | canonical request hash | 409；原 attempt 不变，不重放外部写入 |
| PUB-NEG-SECOND-ACTIVE | 同一 project/destination/target 已有 queued/running async run | canonical `async_runs.active_key` | 409，返回可定位现有 run；publication 表不维护第二 status truth |
| PUB-NEG-DELIVERY-AS-STATE | PR opened、WordPress Draft/Scheduled 或只有 Delivery Receipt | immutable receipt kind 与 canonical async status | customer state 必须仍为 `pending`；schema/API 不允许 `delivered` assertion |
| PUB-NEG-NO-DURABLE-APPROVAL | Artifact 只是 `ready` 或只存在 `updated_at`，没有 append-only approval event | exact artifact revision/content hash、reviewer、QA gate snapshot、客户 acknowledgement | 422；禁止用可变 artifact 状态冒充客户批准 |
| PUB-NEG-REVOKED-APPROVAL | 已批准 Artifact 后续出现 revocation 或 supersession event，且请求是新的 publish | 当前 durable publication approval event timeline | 409/422；要求重新审核精确 revision，禁止新的 publish；不抹除历史 source lineage |
| PUB-NEG-APPROVAL-HASH-MISMATCH | server-computed Artifact content hash、QA authority snapshot/hash 或 preview checksum 彼此不一致 | server-side artifact revision read、QA evaluation、approved content hash、preview bytes | 409/422；不写 approval/attempt，不调用 provider |
| PUB-NEG-CROSS-SCOPE-APPROVAL | approval event、Artifact 或 revision 属于其他 workspace/project | session workspace、project path 与 artifact lineage | 404；不泄漏其他项目存在性 |
| PUB-NEG-CLIENT-APPROVAL-FACTS | 客户端尝试提交 Artifact content hash、QA snapshot/hash、ack actor/time/id，或 publication 时重复提交 Artifact/revision/hash | approval POST 只收 revision identity、expected revision/QA version 与 acknowledgement boolean/scope；publication POST 只收 approvalEventId | 422；服务端只从 session、canonical Artifact Revision、QA authority 与 durable approval event 生成事实 |
| PUB-NEG-CLIENT-AUTH-SNAPSHOT | 客户端尝试提交 authorization snapshot、capability probe facts 或 resolved rollback plan | 只接受 server-issued authorizationGrantRef / preview / plan ref，服务端重读 canonical facts | 422；客户端事实不落库、不调用 provider |
| PUB-NEG-ROLLBACK-WITHOUT-SOURCE | rollback 没有源 publication attempt，或源 attempt 未产生 verified change | sourcePublicationAttemptId、同 scope/provider/target、source change receipt、current remote revision | 409/422；不创建孤立 rollback attempt |
| PUB-NEG-ROLLBACK-REUSES-PUBLISH-AUTH | rollback 尝试沿用 source attempt 的 publish authorization/acknowledgement | 新 authenticated actor、rollback-purpose authorization、rollback acknowledgement、preview、expected current remote revision | 409/422；不调用 provider |
| PUB-POS-ROLLBACK-REVOKED-SOURCE-LINEAGE | source change 已 verified，但其历史 approval 后来 revoked/superseded | source attempt/change receipt、历史 `sourceApproval`、当前 rollback authorization/ack、remote revision | 允许创建独立 rollback attempt；不要求 source approval current/unrevoked，不复用 publish authorization |
| PUB-NEG-CHANGE-WITHOUT-DELIVERY | reconciliation 尝试直接写 Change Receipt，或 predecessor 属于其他 attempt/provider/checksum/remote scope | predecessorDeliveryReceiptId、同 attempt/provider/content checksum/remoteScopeRef、时间顺序 | 数据库/repository 拒绝；保持 `pending`/`unavailable` |
| PUB-NEG-REMOTE-REVISION-DRIFT | Git SHA、blob、WordPress revision 或 must-not-exist 条件已变化 | remotePrecondition | 409 stale remote revision；要求重新 preview/approval |
| PUB-NEG-REVOKED-AUTH | GitHub installation、repository、WordPress secret 或 destination revision 已撤销 | 最新 destination revision 与 authorization snapshot | `revoked`；禁止新外部写入 |
| PUB-NEG-RECEIPT-ONLY-RESULTS | 只有 delivery/change receipt，没有 outcome Observation | receipt lineage 与 measurement window | Results 不得显示 positive lift；显示 pending/insufficient/unavailable |
| PUB-STATE-PENDING | PR 未 merge、draft/future 未 publish，或 live URL 尚未验证 | delivery receipt 与 reconciliation facts | `pending`；不创建 Change Receipt，不启动 outcome window |
| PUB-STATE-UNAVAILABLE | provider read/write、permission probe、credential 或 live verification 当前不可用 | error code、observedAt、redacted limitation、retryability | `unavailable`；未知不转成 success/zero |
| PUB-STATE-REVOKED | 最新 destination revision 标记撤销 | revocation actor、reason、observedAt、superseded revision | `revoked`；历史 attempts/receipts 仍可审计 |
| PUB-POS-ROLLBACK | 对已验证 change 发起独立 rollback | source change receipt、历史 source approval lineage、新 rollback authorization/acknowledgement、preview、expected current remote revision、rollback plan | 新 attempt；先 delivery receipt，验证 live 后再 change receipt |
| PUB-NEG-ROLLBACK-REWRITE | rollback 试图删除或更新历史 attempt/receipt | append-only trigger | 数据库拒绝；历史证据不变 |

## 晋升前强制证据

- GitHub 与 WordPress deterministic fake provider contract tests。
- project/workspace/site repository isolation 与 cross-scope 404。
- authorization/revocation、secret redaction、bounded network、unknown-result recovery。
- durable Artifact Approval Event 的 exact-revision binding、QA gate、customer acknowledgement、revocation/supersession。
- idempotency same-hash replay、different-hash conflict、stale same-key read-only replay 与 stale payload/new-key revalidation。
- canonical `async_runs_one_active_key_idx` active-key concurrency。
- async_runs kind/result_type migration 必须保留全部历史值并新增 `publication` / `publication_attempt`。
- append-only trigger tests。
- delivery/change predecessor、provider/checksum/remote-scope lineage 与 reconciliation tests。
- receipt-only Results negative test。
- Owner 明确批准的 sandbox PR / WordPress Draft smoke；未批准 merge/publish 时保持 `pending`。
- `openapi/mvp.yaml`、migration `0022`、generated contracts、runtime、正式 v0.4 authority/lock/verifiers必须同一变更原子晋升。
