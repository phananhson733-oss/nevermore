# v0.4 Candidate Provider Boundaries

本文是 review-only、non-normative candidate。所有网络请求只能在未来 Task 8 的受控 worker adapter 中发生；纯合同、授权判断、idempotency 和 Results eligibility 必须保持确定性。

## 共同边界

1. Destination 是 project/site-scoped、append-only revision。读取端只接受同一 workspace/project/site 下最新 revision；旧 revision 保留审计用途。
2. Credential 只通过 encrypted secret reference 关联。API、receipt、telemetry、错误和导出绝不返回 token、application password、private key 或 OAuth secret。
3. 每次新的 publish 外部写入前重新验证：
   - destination 最新 revision 为 `ready`；
   - authorization snapshot 未过期且未 revoked；
   - Action 的 canonical target_ref、Artifact、精确 approved revision/content hash 和 durable Artifact Approval Event 仍一致；
   - approval event 冻结 reviewer、QA gate snapshot、客户 acknowledgement，且没有后续 revocation / supersession；`execution_artifacts.status = ready` 不能替代批准；
   - preview checksum 与 approved content hash 对应；
   - remotePrecondition 仍成立；
   - canonical `async_runs.active_key` 没有第二个 active publication。
4. Adapter 只返回有界、redacted provider facts。timeout、body、redirect、retry 和 cost 都必须有硬上限；未知结果记录为 `unavailable` 或需要 reconciliation，绝不静默重试外部写入。
5. Delivery Receipt 与 Change Receipt 分离。前者证明 provider 接受了交付动作，客户状态仍为 `pending`，不能表达 `delivered`；后者证明变化已在 live canonical URL 上可验证。
6. `pending`、`unavailable` 和 `revoked` 是一等状态，不得降级成成功、空数组或零指标。
7. Destination request 只接受 server-issued authorization grant reference 与 requested scope。authorization snapshot、normalized provider scope、permission/capability probe facts、readiness 和 limitation 全由服务端产生；客户端提交的同名事实必须被拒绝。
8. Rollback attempt 必须指向同 scope/provider/target 的 source publication attempt 与 verified Change Receipt。source approval 只作为历史 lineage，即使后来 revoked/superseded 也不阻止已发生 change 的合法回滚；服务端重读 source rollback plan 和当前 remote revision，并要求新的 rollback authorization、authenticated actor、customer acknowledgement 与 preview。客户端不能复用原 publish authorization，也不能提交 resolved authorization snapshot 或 rollback plan。
9. 每个 `change_receipt` 必须引用同 attempt 更早的 `delivery_receipt`。两者的 provider、content checksum 与稳定 `remoteScopeRef` 必须一致；GitHub scope 绑定 repository + PR，WordPress scope 绑定 site + post。无 predecessor 或任一 lineage 不一致都禁止 Change Receipt。

## GitHub provider boundary

### 授权与 scope

- 只能使用 **GitHub App installation**，不能使用个人长期 PAT 作为生产默认路径。
- 安装回调冻结 installation id、GitHub account id、授权时间、权限集合和授权 actor。
- 客户必须进行 explicit **repository selection**；installation 可见的其他 repository 不自动进入 Nevermore scope。
- Destination revision 冻结 repository id、owner/name、**base branch**、允许创建的 branch prefix 和目标内容路径。
- 每次创建 preview 或外部写入前执行 **permission probe**，至少验证 metadata read、contents read/write 和 pull requests write；权限不足进入 `unavailable`。
- 被卸载、repository 移除、权限降低或 installation suspended 时，新 attempt 被拒绝为 `revoked` 或 `unavailable`；历史 receipts 不删除。

### 默认交付

1. 用 approved Artifact Revision 的精确 bytes 生成 preview，冻结 path、content checksum、base SHA 和 expected remote revision。
2. 创建或更新受控 branch，并提交精确 checksum。
3. 打开 Pull Request；默认不 auto-merge。
4. PR number、URL、head SHA、base SHA、repository id 和 provider request id 形成 `delivery_receipt`；`remoteScopeRef` 稳定绑定 repository + PR。
5. Delivery 后保持 `pending`。PR opened、checks passed 或 approved 都不是 live change。

### Reconciliation 与 Change Receipt

- Reconciler 必须读取 provider 当前事实，验证 PR 已 merge，并记录精确 **merged SHA**。
- merge 本身仍不足够。必须通过受控部署映射或显式配置找到实际 **live canonical URL**，并在有限重试、有限响应体、同站 canonical 规则下验证该 URL 对应 merged SHA/content checksum。
- 只有 merged SHA 与 live canonical URL 都成功验证，且已存在同 attempt/provider/checksum/remoteScopeRef 的 Delivery Receipt，才写入带 `predecessorDeliveryReceiptId` 的 append-only `change_receipt`。
- 无法确认部署映射、页面尚未上线、canonical 不一致或 provider read 不可用时保持 `pending` 或 `unavailable`，不得制造 Change Receipt。

### Rollback

- Rollback plan 冻结 base SHA、pre-change blob SHA/path、revert branch prefix 和 expected current remote revision。
- Rollback 是新的授权 attempt：它使用新的 rollback-purpose authorization/acknowledgement，而不是原 publish authorization；创建 revert branch/commit/PR，先产生新的 delivery receipt；merge + live URL 验证后才产生新的 change receipt。
- 不 force-push、不删除原 PR、不改写已有 receipt。

## WordPress provider boundary

### 授权与 scope

- Destination 绑定一个规范化 WordPress site base URL 和一个 **encrypted secret reference**；明文 credential 永不落入 authority row 或 API。
- 创建/更新 destination revision 时执行 bounded **capability probe**：
  - REST API identity 与目标站点一致；
  - authenticated user id；
  - posts create/edit capability；
  - publish capability是否存在；
  - 可用 post types；
  - 被允许的 author 与 status。
- Destination 冻结明确 **author allowlist** 和 **status allowlist**。默认 status 只允许 `draft | future`；`publish` 必须由单独、当前有效的 publish approval 明确授权。
- credential 失效、用户删除、capability 降低、站点 origin 漂移或 secret revoked 时，新 attempt 进入 `unavailable` / `revoked`，历史 receipts 保留。

### 默认交付

1. Preview 冻结 title、slug、content checksum、author、status、schedule time、canonical expectation 和当前 post revision precondition。
2. 默认创建或更新 `draft` / `future` post。
3. post id、REST revision、edit URL、preview URL、status 和 provider request id 形成 `delivery_receipt`；`remoteScopeRef` 稳定绑定 WordPress site + post。
4. Draft 或 scheduled post 保持 `pending`，不能启动 outcome window。

### Reconciliation 与 Change Receipt

- Reconciler 必须重新读取 post，确认 status 为 `publish`、post revision 等于预期、canonical URL 属于 destination site。
- 再对 **live canonical URL** 做 bounded live-page verification；仅 REST 返回 publish 不足以证明客户页面可访问。
- 只有 `publish` + exact revision + live canonical URL 全部成立，且存在同 attempt/provider/checksum/remoteScopeRef 的 Delivery Receipt，才写带 `predecessorDeliveryReceiptId` 的 `change_receipt`。
- private、draft、future、trash、404、canonical mismatch、credential failure 或未知 provider state 分别保持 `pending` 或 `unavailable`。

### Rollback

- Rollback plan 冻结 prior WordPress revision id、prior content checksum、prior status、author、slug 和 expected current revision。
- Rollback 是新的显式 attempt。恢复到 draft、创建 revision 或重新发布必须遵守当前 status allowlist、新的 rollback authorization 与 acknowledgement；source approval 仅保留历史 lineage，不删除或覆盖历史 receipts。

## Results 与 Measurement 边界

- Delivery receipt 仅进入时间线与审计显示。
- Change receipt 只允许成为未来 measurement window 的 lineage anchor；它不包含正向 outcome。
- Results 不得从 receipt 状态、PR merge、WordPress publish、live HTTP 200 或技术 recheck 推导 organic clicks、rank、conversion、revenue 或 AI citation improvement。
- 正向、负向或无变化结论必须由 Task 9 的 immutable GSC/GA4/UTM/technical observations 在绝对时间窗、样本量、freshness 和 limitation 下独立给出。
