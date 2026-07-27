# v0.4 Candidate Repository Invariants

状态：review-only、non-normative candidate。以下算法是 Task 8 repository/transaction 的强制边界，不是当前 runtime 已实现能力。

## 1. Approval event transaction

1. Repository 以 authenticated session 生成 `eventActorId`；客户端不能提交 event actor、reviewer、时间或 durable acknowledgement id。
2. `approved` event 中 `eventActorId = reviewerActorId`，并由服务端读取 exact Artifact Revision、计算 content hash、运行 canonical QA gate、生成 QA snapshot/hash 与 customer acknowledgement。
3. `revoked | superseded` terminal event 的 `reviewerActorId = null`。它必须指向同 workspace/project/artifact 下的 source `approved` event，从 source approval 保留 Artifact/revision/hash、QA、acknowledgement 与 reviewer lineage，并用新的 `eventActorId` 记录真正执行终止的人。
4. Repository 在插入 terminal event 前锁定 source approval timeline；一个 source approval 只允许一个 terminal event。缺少 source、跨 scope、重复终止或 event actor 不明确时 fail closed。

## 2. Publication attempt transaction

1. 先规范化 server-owned request：最新 destination revision、canonical Action target、durable approval、preview bytes、resolved rollback plan、current remote revision、authorization snapshot、Idempotency-Key 与 canonical request hash。
2. HTTP 窗口继续使用 `app.idempotency_keys`。publication attempt 的永久唯一 key 是共享记录过期后的 external-write 防重补强，不替代共享 ledger。
3. Repository 对 `(workspace_id, project_id, idempotency_key)` 加锁读取：
   - **same-hash replay**：返回同一 attempt、async run 与已有 receipts；禁止新 provider call。
   - **different-hash conflict**：返回 409，原 attempt/receipt 不变；禁止新 provider call。
4. **stale replay** 分两类：
   - 原 key + 原 hash 是 read-only replay，即使 destination/approval 后来撤销，也只能返回历史结果，绝不重新执行。
   - 旧 payload 换新 key 必须重新读取当前 destination、approval、preview、remote precondition 与 authorization；任一 stale/revoked/drift 都 fail closed。
5. 新 attempt 在同一事务内插入 `async_runs(kind='publication', result_type='publication_attempt')`。`active_key = publication:<destination_ref>:<target_ref>`，并以 canonical `async_runs_one_active_key_idx` 作为唯一并发真相；冲突返回已有 run，不创建第二个 attempt 或 status truth。
6. publish attempt 必须引用 current、unrevoked 的 `publicationApproval`。rollback attempt 不复用 publish authorization，也不要求历史 source approval 仍 current/unrevoked：
   - `sourcePublicationAttemptId` 必须属于同 workspace/project/site/provider/target；
   - source attempt 必须已有 verified `change_receipt`；
   - `sourceApproval` 只保留历史 lineage；
   - rollback 必须冻结新的 authenticated actor、rollback acknowledgement、preview、expected current remote revision、resolved rollback plan 与 `authorizationPurpose=rollback`。
7. attempt row、async run、idempotency response 与 job enqueue 必须原子提交；任何一步失败都不得留下孤立 run、attempt 或 provider call。

## 3. Receipt transaction

1. `delivery_receipt` 证明 provider 接受交付；PR opened、WordPress Draft 或 Scheduled 状态仍投影为 customer state `pending`。
2. `change_receipt` 必须提供 `predecessorDeliveryReceiptId`，且 predecessor 必须：
   - 属于同一 publication attempt；
   - `receipt_kind = delivery_receipt`；
   - provider、content checksum 与 `remoteScopeRef` 完全一致；
   - observed time 不晚于 change receipt。
3. GitHub 的 `remoteScopeRef` 稳定绑定 repository + Pull Request lineage；WordPress 稳定绑定 site + post lineage。merge SHA 或 post revision可以变化，但不能跨 remote scope。
4. change insert 必须同时满足 provider reconciliation 与 live canonical verification。没有 delivery predecessor、provider/checksum/scope 不一致、live evidence 不足或未知状态时保持 `pending | unavailable`，不得写 change receipt。
5. receipt append 与 async completion 必须在同一恢复策略下幂等；已有 receipt 只读返回，禁止 UPDATE/DELETE 或以第二行覆盖事实。

## 4. Results boundary

Delivery Receipt 与 Change Receipt 都只是 lineage。它们不能直接创建正向 Results；measurement window 必须由后续 immutable observations 独立建立。
