# Slice 2 Task 2/5 实现蓝图 · Flow Shadow(2026-07-25)

主 agent 已 review 并**批准全部 5 个开放裁决(R1-R5)的推荐**。本文件是 Task 2(flow_shadow 表 + ArtifactType 扩展)与 Task 5(红线 B 接线)的可实现蓝图,直接交给实现 agent。配套落地计划:`2026-07-25-slice2-content-shadow-execution-plan.md`。

基线:worktree `unified-growth-opportunity-v03` @ `945be02`。下一迁移号 = `0020`(`0019_competitor_library_foundation.sql` 之后)。共享 DB 助手已在 `0001_init.sql`:`app.set_updated_at()`、`app.reject_append_only_mutation()`(raises `55000`)。lock 当前 41 表 / 8 async / 45 api / 11 rules。

## 已批准裁决(不要偏离)

- **R1**:阶段状态用 **append-only 子行 + 派生 phase**,`flow_shadow_runs` **无可变 status 列**(忠于 `audit_runs`)。run 生命周期在 `async_runs.status`;phase 由子行是否存在派生。
- **R2**:**只** `english_blog_draft` 加为 `ArtifactType`(它需要 revision/评审机制);`research_pack` 走 `flow_shadow_research_packs` 子表(只读事实,不是 ArtifactType)。契约税枚举只加 **1** 个值。
- **R3**:`flowAdapterVersion` = **服务端固定常量** `CONTENT_SHADOW_ADAPTER_VERSION`(类比 `audit-runs.ts` 的 `CAPABILITY_VERSION`),请求字段可选/忽略或 validate-equals。禁止 operator 传任意版本。
- **R4**:frozen 竞品/keyword/generative id 集在 **service load fn 校验**(类比 `loadGrowthAuditInputs`)+ trigger 只做轻量 per-id 存在性;不做重 jsonb 迭代 trigger。
- **R5**:`english_blog_draft` 复用 `execution_artifacts` 挂**同一** `source_action_id`(不同 artifact_type,`execution_artifacts_one_active_type_idx` 允许);public `createActionArtifact` 保持拒绝 `english_blog_draft`(其 `ARTIFACT_TYPE_BY_TEMPLATE` 不匹配已拒),draft 只由 content-shadow worker 铸造。

## Provenance 模型(关键)

`flow_shadow_runs` 锚定 `capability_runs(async_run_id)`(如 `audit_runs`),但**无 `diagnostic_run`**(不跑规则,无诊断)。链:`async_run(kind='content_shadow') → capability_run(mode='shadow', side_effect_class='internal_write') → flow_shadow_run`。理由见落地计划裁决 A。

## 1. 迁移 `0020_content_shadow_foundation.sql`(可粘贴)

```sql
BEGIN;

ALTER TABLE app.async_runs DROP CONSTRAINT IF EXISTS async_runs_kind_check;
ALTER TABLE app.async_runs ADD CONSTRAINT async_runs_kind_check
  CHECK (kind IN ('collection','diagnostic','artifact_generation','export','content_shadow'));

ALTER TABLE app.async_runs DROP CONSTRAINT IF EXISTS async_runs_result_type_check;
ALTER TABLE app.async_runs ADD CONSTRAINT async_runs_result_type_check
  CHECK (result_type IS NULL OR result_type IN (
    'collection_run','diagnostic_run','artifact','export','flow_shadow_run'));

ALTER TABLE app.execution_artifacts DROP CONSTRAINT IF EXISTS execution_artifacts_artifact_type_check;
ALTER TABLE app.execution_artifacts ADD CONSTRAINT execution_artifacts_artifact_type_check
  CHECK (artifact_type IN ('content_brief','metadata_rewrite','technical_ticket','english_blog_draft'));

CREATE TABLE IF NOT EXISTS app.flow_shadow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  capability_run_id uuid NOT NULL UNIQUE
    REFERENCES app.capability_runs(async_run_id) ON DELETE RESTRICT,
  source_finding_id uuid NOT NULL REFERENCES app.findings(id) ON DELETE RESTRICT,
  source_action_id uuid NOT NULL REFERENCES app.actions(id) ON DELETE RESTRICT,
  content_brief_artifact_id uuid NOT NULL REFERENCES app.execution_artifacts(id) ON DELETE RESTRICT,
  content_brief_revision integer NOT NULL CHECK (content_brief_revision >= 1),
  flow_adapter_version text NOT NULL CHECK (length(btrim(flow_adapter_version)) BETWEEN 1 AND 200),
  frozen_input_manifest jsonb NOT NULL CHECK (jsonb_typeof(frozen_input_manifest) = 'object'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  projection_version text NOT NULL CHECK (length(btrim(projection_version)) >= 1),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS flow_shadow_runs_project_created_idx
  ON app.flow_shadow_runs(project_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS flow_shadow_runs_action_idx
  ON app.flow_shadow_runs(project_id, source_action_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS flow_shadow_runs_content_hash_idx
  ON app.flow_shadow_runs(project_id, content_hash);

CREATE TABLE IF NOT EXISTS app.flow_shadow_research_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  flow_shadow_run_id uuid NOT NULL REFERENCES app.flow_shadow_runs(id) ON DELETE RESTRICT,
  analysis_invocation_id uuid REFERENCES app.analysis_invocations(id) ON DELETE RESTRICT,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  pack jsonb NOT NULL CHECK (jsonb_typeof(pack) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flow_shadow_run_id)
);
CREATE INDEX IF NOT EXISTS flow_shadow_research_packs_run_idx
  ON app.flow_shadow_research_packs(project_id, flow_shadow_run_id, id);

CREATE TABLE IF NOT EXISTS app.flow_shadow_qa_gates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  flow_shadow_run_id uuid NOT NULL REFERENCES app.flow_shadow_runs(id) ON DELETE RESTRICT,
  evaluated_artifact_id uuid NOT NULL REFERENCES app.execution_artifacts(id) ON DELETE RESTRICT,
  evaluated_revision integer NOT NULL CHECK (evaluated_revision >= 1),
  analysis_invocation_id uuid REFERENCES app.analysis_invocations(id) ON DELETE RESTRICT,
  verdict text NOT NULL CHECK (verdict IN ('passed','needs_review','blocked')),
  claims jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(claims) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flow_shadow_run_id, evaluated_artifact_id, evaluated_revision)
);
CREATE INDEX IF NOT EXISTS flow_shadow_qa_gates_run_idx
  ON app.flow_shadow_qa_gates(project_id, flow_shadow_run_id, created_at DESC, id DESC);

-- english_blog_draft 不建表:它是 execution_artifact(type='english_blog_draft')挂 source_action_id。

CREATE OR REPLACE FUNCTION app.enforce_flow_shadow_run_provenance()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  finding_rule_id text; finding_review_state text; finding_last_seen_run_id uuid;
  action_finding_id uuid; action_status text; action_diag_run_id uuid;
  brief_action_id uuid; brief_type text; brief_current_revision integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.capability_runs capability
    JOIN app.async_runs run ON run.id = capability.async_run_id
    WHERE capability.async_run_id = NEW.capability_run_id
      AND run.workspace_id = NEW.workspace_id AND run.project_id = NEW.project_id
      AND run.kind = 'content_shadow'
      AND capability.mode = 'shadow' AND capability.side_effect_class = 'internal_write'
  ) THEN RAISE EXCEPTION 'flow shadow run capability provenance does not match its canonical run' USING ERRCODE='23514'; END IF;

  SELECT finding.rule_id, finding.review_state, finding.last_seen_run_id
  INTO finding_rule_id, finding_review_state, finding_last_seen_run_id
  FROM app.findings finding
  WHERE finding.id = NEW.source_finding_id AND finding.workspace_id = NEW.workspace_id AND finding.project_id = NEW.project_id;
  IF NOT FOUND OR finding_review_state IS DISTINCT FROM 'confirmed' THEN
    RAISE EXCEPTION 'flow shadow run requires a confirmed source Finding' USING ERRCODE='23514'; END IF;
  IF finding_rule_id NOT IN ('SEARCH-DECAY-002','CONTENT-COVERAGE-001','CONTENT-GAP-011','CRO-LANDING-003') THEN
    RAISE EXCEPTION 'flow shadow run source Finding is not a content-brief rule' USING ERRCODE='23514'; END IF;

  SELECT action.source_finding_id, action.status, action.source_diagnostic_run_id
  INTO action_finding_id, action_status, action_diag_run_id
  FROM app.actions action
  WHERE action.id = NEW.source_action_id AND action.workspace_id = NEW.workspace_id AND action.project_id = NEW.project_id;
  IF NOT FOUND OR action_finding_id IS DISTINCT FROM NEW.source_finding_id OR action_status = 'dismissed' THEN
    RAISE EXCEPTION 'flow shadow run Action does not match its confirmed Finding' USING ERRCODE='23514'; END IF;

  IF finding_last_seen_run_id IS DISTINCT FROM action_diag_run_id THEN
    RAISE EXCEPTION 'flow shadow run Finding moved beyond its frozen diagnosis' USING ERRCODE='23514'; END IF;

  SELECT artifact.action_id, artifact.artifact_type, artifact.current_revision
  INTO brief_action_id, brief_type, brief_current_revision
  FROM app.execution_artifacts artifact
  WHERE artifact.id = NEW.content_brief_artifact_id AND artifact.workspace_id = NEW.workspace_id AND artifact.project_id = NEW.project_id;
  IF NOT FOUND OR brief_action_id IS DISTINCT FROM NEW.source_action_id
     OR brief_type IS DISTINCT FROM 'content_brief' OR brief_current_revision < NEW.content_brief_revision THEN
    RAISE EXCEPTION 'flow shadow run content_brief provenance is invalid' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM app.artifact_revisions rev
    WHERE rev.artifact_id = NEW.content_brief_artifact_id AND rev.revision = NEW.content_brief_revision
      AND rev.workspace_id = NEW.workspace_id AND rev.project_id = NEW.project_id
  ) THEN RAISE EXCEPTION 'flow shadow run frozen content_brief revision does not exist' USING ERRCODE='23514'; END IF;

  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION app.enforce_flow_shadow_child_provenance()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.flow_shadow_runs run
    WHERE run.id = NEW.flow_shadow_run_id AND run.workspace_id = NEW.workspace_id AND run.project_id = NEW.project_id
  ) THEN RAISE EXCEPTION 'flow shadow child provenance does not match its canonical run' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS flow_shadow_runs_provenance_guard ON app.flow_shadow_runs;
CREATE TRIGGER flow_shadow_runs_provenance_guard BEFORE INSERT ON app.flow_shadow_runs
  FOR EACH ROW EXECUTE FUNCTION app.enforce_flow_shadow_run_provenance();
DROP TRIGGER IF EXISTS flow_shadow_runs_append_only ON app.flow_shadow_runs;
CREATE TRIGGER flow_shadow_runs_append_only BEFORE UPDATE OR DELETE ON app.flow_shadow_runs
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS flow_shadow_research_packs_provenance_guard ON app.flow_shadow_research_packs;
CREATE TRIGGER flow_shadow_research_packs_provenance_guard BEFORE INSERT ON app.flow_shadow_research_packs
  FOR EACH ROW EXECUTE FUNCTION app.enforce_flow_shadow_child_provenance();
DROP TRIGGER IF EXISTS flow_shadow_research_packs_append_only ON app.flow_shadow_research_packs;
CREATE TRIGGER flow_shadow_research_packs_append_only BEFORE UPDATE OR DELETE ON app.flow_shadow_research_packs
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS flow_shadow_qa_gates_provenance_guard ON app.flow_shadow_qa_gates;
CREATE TRIGGER flow_shadow_qa_gates_provenance_guard BEFORE INSERT ON app.flow_shadow_qa_gates
  FOR EACH ROW EXECUTE FUNCTION app.enforce_flow_shadow_child_provenance();
DROP TRIGGER IF EXISTS flow_shadow_qa_gates_append_only ON app.flow_shadow_qa_gates;
CREATE TRIGGER flow_shadow_qa_gates_append_only BEFORE UPDATE OR DELETE ON app.flow_shadow_qa_gates
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON app.flow_shadow_runs FROM anon';
    EXECUTE 'REVOKE ALL ON app.flow_shadow_research_packs FROM anon';
    EXECUTE 'REVOKE ALL ON app.flow_shadow_qa_gates FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON app.flow_shadow_runs FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.flow_shadow_research_packs FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.flow_shadow_qa_gates FROM authenticated';
  END IF;
END; $$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0020_content_shadow_foundation'::text AS migration_version;

COMMIT;
```

**表 delta:+3**(`flow_shadow_runs`/`flow_shadow_research_packs`/`flow_shadow_qa_gates`)→ lock `tables` 41→44。`english_blog_draft` 复用 execution_artifacts,不新增表。

> 实现 agent 必须先核实上述列名/表名与 `0001_init.sql` 实际一致(`findings.review_state`/`last_seen_run_id`、`actions.source_finding_id`/`status`/`source_diagnostic_run_id`、`execution_artifacts.current_revision`、`artifact_revisions.revision`、`analysis_invocations` 存在),不一致处以真实 schema 为准修正 trigger。

## 2. 红线 B 接线(Task 5)

**不变式**:confirmed content Finding → **恰一个** canonical Action(`action_key` 幂等)经**现有** `reviewProjectFinding`(`finding-review.ts`)→ content_brief 是**现有** `execution_artifact`(由 Slice-1 `createActionArtifact`→`run-artifact.ts` 生成)。Content Shadow **消费**该已确认 brief revision 作 frozen input,**绝不重铸**。无第二确认路径、无 approval/checkpoint/opportunity 表、无第二内容对象。

**复用(不改)**:`reviewProjectFinding`/`confirmFinding`、`ActionsRepository.findByKey/insert`、`createActionArtifact`、`ExecutionArtifactsRepository.*`、`ActionsRepository.countActionsForFinding`(`actions.ts:283`,作 `===1` 基数断言,反第二确认守卫)、`AsyncRunsRepository.insertQueued/findActive`、`CapabilityRunsRepository.create`、`enqueueRunInTx`、`IdempotencyRepository.begin/find/complete`(形同 `createGrowthAuditRun`)。

**新增最小 repo**(类比 `AuditRunsRepository`):`FlowShadowRunsRepository`(`packages/db/src/repositories/flow-shadow-runs.ts`):`create(...)`/`findById`/`listByProject`(cursor)/`findByContentHash`。`FlowShadowResearchPacksRepository.insert/findByRun`、`FlowShadowQaGatesRepository.insert/findByRun`。load/freeze 助手 `buildContentShadowFrozenInput(...)` 镜像 `buildDiagnosticFrozenInput`,返回 `{manifest, contentHash}`,`contentHash` 用 `@sf/db` `contentHash`(**无 DB 侧 hash**)。

`createContentShadowRun` 事务(唯一写):`idem.begin` → `AsyncRunsRepo.insertQueued(kind='content_shadow', activeKey='content_shadow:'+actionId)` → `CapabilityRunsRepo.create(mode='shadow', side_effect_class='internal_write')` → `FlowShadowRunsRepo.create(frozen+content_hash)` → `enqueueRunInTx(boss, tx, 'content-shadow')` → `idem.complete`。开工前 read-only 断言:Action 非 dismissed、Finding confirmed 且 `last_seen_run_id == action.source_diagnostic_run_id`、content_brief artifact+revision 存在、`countActionsForFinding===1`、实体集在 project scope。

worker `runContentShadow`:claim → load flow_shadow_run → RESEARCH(insert research_pack)→ DRAFT(`ExecutionArtifactsRepo.insert(type='english_blog_draft', action_id=source)` + insertRevision)→ QA(insert qa_gate)→ `setTerminal(completed, resultType='flow_shadow_run')`。

**破坏红线 B 的反模式(review 必查)**:(1) `createContentShadowRun` 建任何 Action/approval/checkpoint/opportunity 行;(2) shadow op 改 Finding review 状态(须*要求*已 confirmed,否则 422/409,绝不 `updateReview`);(3) 在 shadow 流水线内重新生成 content_brief 而非冻结现有 revision;(4) 给 brief 新建 ArtifactType,或让 `english_blog_draft` 成为 `ActionTemplate` 输出;(5) shadow run 副作用把 artifact 标 ready/published(破红线 D);(6) 把 SearchQuery+GenerativeQuery 塌缩成共同 volume(破 invariant 8)。

## 3. ArtifactType 扩展(只加 english_blog_draft)

加 `english_blog_draft` 到:①`packages/contracts/src/zod/artifacts.ts:10`(z.enum)②`packages/artifacts/src/types.ts:8`(union + `ARTIFACT_FORMAT: english_blog_draft:"markdown"`)③`packages/engine/src/action-templates.ts:11`(union,仅 3 处一致性,无模板行用它,可选)④`openapi/mvp.yaml` + `authority/.../openapi.yaml`(字节一致)⑤generated(`pnpm contracts:generate`,勿手改)⑥迁移 CHECK(§1 已含)⑦`artifacts.ts` `listProjectArtifacts` 的 `artifactType` 参数 union + `artifact-mappers`。`ACTION_TEMPLATES` 保持 11 行不变。`research_pack` **不**加 ArtifactType。

## 4. 契约草案(Task 4,置 `packages/contracts/src/zod/content-shadow.ts`)

`CreateContentShadowRunRequest`(strict):`actionId:Uuid`、`contentBriefRevision?:int>=1`、`flowAdapterVersion?`(R3 服务端固定,忽略或 validate-equals)、`competitorEntityIds:Uuid[]<=50 unique default[]`、`searchCluster:{clusterKey, keywordEntityIds:Uuid[1..500] unique}`、`generativeQueryEntityIds:Uuid[]<=500 unique default[]`(与 search **分离**)、`outputLocale:Bcp47Locale`。
Accepted 202 响应镜像 `GrowthAuditAcceptedResult`:`{status:202, run:AsyncRunDto, statusUrl, resourceRef:{type:'flow_shadow_run', id}, location, replayed}`。
`ContentShadowRunResponse`(getContentShadowRun):`id/projectId/createdAt/contentHash/projectionVersion/flowAdapterVersion` + `source{findingId,actionId,contentBriefArtifactId,contentBriefRevision}` + `frozenInputs{primaryFindingId, sourceDiagnosticRunId, evidenceRefs[], competitorEntityIds[], searchCluster{clusterKey,keywordEntityIds[]}, generativeQueryEntityIds[]}` + `research{packId,sources[AuthoritySource],generatedAt}|null` + `draft{artifactId,status,currentRevision,revisions[ShadowRevision]}|null` + `qa{gateId,verdict,evaluatedRevision,claims[QaClaim],evaluatedAt}|null` + `sideBySide{contentBrief{artifactId,revision,contentText}, draft{...}|null}` + `run:AsyncRunDto` + `phase:enum(queued|research|draft|qa|complete|failed)`(派生)。评审编辑复用现有 `UpdateArtifactRequest` 对 `english_blog_draft` artifact(409 STALE_REVISION);Task 8 的 `reviewContentShadowRevision`(若加)只记录评审*决策*,Publish disabled/simulated。

## 5. 契约税 checklist(Task 2/4 同 commit)

`openapi/mvp.yaml` + `authority/.../openapi.yaml`(字节一致同 sha256)+ generated(`pnpm contracts:generate`)+ `scripts/spec-v0.3-lock.json`(`tables` 41→44、`asyncOperations` 8→9 加 `createContentShadowRun`、`apiOperations` 加 `createContentShadowRun`/`getContentShadowRun`、刷新迁移+实现文件 `shasum -a 256`)+ `scripts/verify-implementation.mjs` EXPECTED 数组 + `authority/.../scripts/verify-spec.mjs` EXPECTED_*_COUNT + `authority/.../MVP-IMPLEMENTATION-SPEC.md`(Task 1 已放宽 CMS 禁令)。另:`packages/db/src/queue.ts` 的 `QueueName` union 加 `'content-shadow'`;worker `kind→queue` 映射(`apps/worker/src/handlers/recovery.ts`)加 `content_shadow → 'content-shadow'`。
