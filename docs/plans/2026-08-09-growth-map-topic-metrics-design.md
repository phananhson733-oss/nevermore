# Growth Map Topic Automation and Keyword Metrics Design

**Date:** 2026-08-09
**Status:** approved by Owner
**Source baseline:** `origin/main@743f99d709e28e85617234bdf64cac93bd331e3a`
**Customer experience authority:** `docs/artifact-src/` and
`docs/artifacts/GenGrowth-Interactive-Artifact.html`

## 1. Decision summary

Growth Map will use real keyword observations and a real revisioned Topic Model
while matching the approved Artifact experience.

The Owner approved these product decisions:

1. Retain DataForSEO keyword difficulty and provider search intent from the
   ranked-keywords response instead of discarding them during normalization.
2. Use an LLM only as a search-intent fallback when the provider does not supply
   intent. Generated intent must keep its model invocation lineage.
3. When a project has keyword evidence but has neither a confirmed Topic Model
   nor a draft, Analysis Refresh automatically generates the first Topic Model,
   automatically confirms it, and assigns eligible keywords to its confirmed
   nodes.
4. Automatic confirmation is explicitly a system confirmation, not a disguised
   human review.
5. Users retain the existing draft/edit/confirm controls. Once a confirmed model
   or any draft exists, automation never silently regenerates or overwrites it.
   User changes therefore create the next immutable revision and remain the
   authority until a user explicitly requests another regeneration.
6. Missing provider facts remain `null`; KD is never estimated by an LLM.
7. Historical published Growth Map generations remain frozen and are never
   rewritten by recollection, model output, or later user edits.

## 2. Scope and authority boundary

### In scope

- DataForSEO KD and provider-intent parsing, normalization, persistence, and
  Growth Map projection.
- A provenance-bearing resolved search-intent read model with the precedence:
  user-confirmed, provider-observed, LLM-generated fallback, unavailable.
- A durable Topic Model generation child run with bounded structured LLM input,
  model-call reservation, immutable invocation record, retry fencing, automatic
  first-model confirmation, and keyword assignment.
- Existing user Topic/keyword review flows as the adjustment mechanism for later
  revisions.
- Artifact-aligned Keyword and Topic Cluster presentation, including Topic to
  page to CTA context and same-cluster demand signals.
- Restoring Pages subviews `url | cluster | opportunity`, with `opportunity` as
  the default, only when every aggregate is computed from a complete pinned
  inventory rather than the current cursor page.
- A safe recollection path for historical keywords. Local implementation and
  tests must not execute paid production provider requests.

### Out of scope without separate authorization

- Production DataForSEO recollection or any other paid provider call.
- Database migration against hosted production.
- Commit, push, pull request, deployment, or production configuration changes.
- Any GitHub, CMS, WordPress, Vercel, or customer-site external write.
- Automatic regeneration over an existing confirmed or draft Topic Model.

## 3. Current-state gaps

### 3.1 Keyword metrics

`DataForSeoRankedKeywordRow` currently retains only keyword, search volume,
current URL, and current rank. The provider response also contains:

- `keyword_data.keyword_properties.keyword_difficulty`
- `keyword_data.search_intent_info.main_intent`

Those fields are dropped before the immutable Snapshot/Observation is written.
The read side already supports KD through `/valueJson/keywordDifficulty`, so KD
is primarily a producer-side truth gap. Search intent needs a separate
provenance-bearing projection because the existing top-level `intent` field is
the governed classification, not a provider metric.

### 3.2 Topic authority

The first `beginDraftFromLatestConfirmed` call creates an empty revision when no
confirmed model exists. Automatic keyword governance derives a legacy
`clusterKey` but intentionally assigns no Topic Node. The Keyword review dialog
only accepts nodes in the latest confirmed Topic Model. These behaviors explain
the current empty Topic selector without implying that raw cluster labels are a
confirmed Topic authority.

### 3.3 Artifact parity

The current Keyword table and detail rail can render a confirmed cluster, but
the Topic gateway is below the main workspace and the project lacks a generated
first model. The Pages object also canonicalizes away the Artifact's URL and
Cluster subviews. Restoring the visual shell without complete canonical reads
would produce false counts, so data/read-model work precedes the final UI shell.

## 4. Target architecture

```text
Analysis Refresh plan v3
  Crawl
  -> GSC
  -> GA4
  -> DataForSEO Search Landscape
  -> DataForSEO Backlinks
  -> Topic Model generation (optional internal child)
  -> Growth Audit
```

The Topic step follows four rules:

1. If a confirmed Topic Model exists, mark the step skipped with the reason
   `existing_confirmed_model`; never call the model.
2. If a draft exists, mark it skipped with `existing_draft`; never call the
   model.
3. If no eligible keyword evidence exists, mark it skipped with
   `insufficient_keyword_evidence` and preserve the truthful unavailable state.
4. Otherwise enqueue one bounded internal Topic generation child run. A failed
   optional child makes the parent partial and records a limitation; it must not
   fabricate an empty confirmed model or destroy the Growth Audit.

The provider call must not run inside the Analysis Refresh database
transaction. The parent creates and observes a child async run. The child uses
the established Product Profile pattern:

```text
freeze input + hash
-> reserve invocation attempt
-> release transaction
-> call structured LLM client
-> persist immutable AnalysisInvocation
-> atomically create/patch/confirm Topic revision and assign keywords
-> terminalize child
```

This prevents a network call from holding project locks and gives crashes an
explicit `outcome_unknown` state rather than silently repeating a paid call.

## 5. Data contracts

### 5.1 DataForSEO observation fields

The canonical ranked-keyword observation adds:

```ts
keywordDifficulty: number | null // integer 0..100
providerSearchIntent:
  | "informational"
  | "navigational"
  | "commercial"
  | "transactional"
  | null
```

Missing fields become `null`. Malformed or out-of-range fields fail the provider
response boundary; they are never coerced to zero or a guessed enum.

### 5.2 Resolved search intent

The existing governed `intent` field remains backward compatible. A new
provenance-bearing `searchIntent` projection drives the Artifact column:

```ts
interface GrowthMapKeywordSearchIntent {
  value: string | null;
  authority:
    | "user_confirmed"
    | "governed_legacy"
    | "provider_observed"
    | "llm_generated"
    | "unavailable";
  snapshotId: string | null;
  observationId: string | null;
  analysisInvocationId: string | null;
  observedAt: string | null;
  limitation: string | null;
}
```

Resolution order is:

1. a current or frozen user decision with non-null intent;
2. a provider-observed intent from the exact current or frozen observation;
3. an LLM-generated system suggestion with non-null invocation lineage;
4. a legacy governed value whose original field-level provenance predates this
   contract;
5. unavailable.

A published generation resolves only refs frozen in that generation. It never
falls back to a newer observation or newer governance decision.

The resolved wire value stays a bounded string so historical user and legacy
governance values remain readable without coercion. New provider-observed and
LLM-generated values use the canonical four-value taxonomy
`informational | navigational | commercial | transactional` and fail closed on
any other literal. The new `searchIntent` envelope validates bounded strings
without trimming or rewriting the wire value; leading or trailing whitespace
is invalid.

### 5.3 LLM intent lineage

`keyword_review_decisions` gains nullable `analysis_invocation_id`. A generated
intent decision must reference the successful `topic_model_generation`
invocation. Deterministic system approvals and provider observations do not fake
an invocation id. User decisions continue to carry the server-resolved actor and
have no model invocation id.

### 5.4 Topic generation provenance

The existing server-authored `generation_basis` stores a versioned shape:

```json
{
  "origin": "llm_auto_confirmed",
  "generationVersion": "topic-model-generation.v1",
  "baseTopicModelRevision": null,
  "analysisInvocationId": "uuid",
  "promptSetVersion": "topic-model.prompt.v1",
  "inputHash": "sha256",
  "keywordGroupCount": 0,
  "keywordCount": 0,
  "reason": "Initial model generated by Analysis Refresh"
}
```

The Topic workspace projection exposes a typed generation summary and
`confirmationMode: system_auto | user | legacy`. A user confirmation carries
the real confirming actor in `confirmedBy`; a system confirmation carries
`confirmedBy: null` and retains its initiating actor only in the structural
server-owned `createdBy` field. Legacy/migration rows map to the explicit
`legacy` mode rather than being guessed as either LLM output or a reviewed user
confirmation.

`keywordGroupCount` and `keywordCount` are the immutable frozen-input coverage
baseline for that confirmation. `reason` remains the exact server-owned
generation-context literal shown above and is never caller-authored. Assigned,
skipped, and unassigned counts plus explicit limitations are derived later from
the exact confirmed Topic revision, its append-only system decisions, the
bounded group/keyword inventory frozen in the matching generation run, and the
durable Topic-generation outcome. Frozen items without an exact matching
decision remain conservative limitations; they are not guessed as assigned.
These derived facts are not written back into or allowed to mutate this
nine-key generation basis.

## 6. Bounded Topic generation

The model does not receive raw provider responses, customer secrets, review
bodies, or arbitrary page contents. The deterministic input groups eligible
keywords by the existing canonical cluster-key algorithm and includes only:

- an opaque group key;
- bounded representative keywords;
- keyword count and aggregate search volume where available;
- provider intent distribution;
- bounded mapped/ranking URLs;
- market and language;
- Product Profile/ICP facts already authorized for model use.

The structured result is one root plus one level of customer-readable Topic
nodes. Each group is assigned to exactly one Topic node. This deliberately
avoids an unbounded arbitrary graph in the first automatic version; users may
create deeper structures through the existing editor.

The client validates:

- one non-empty root;
- unique topic keys and labels;
- bounded node and group counts;
- every returned group reference exists in the frozen input;
- no group is assigned twice;
- no unknown intent value;
- no free-form IDs, actor, revision, timestamp, hash, or confirmation fact.

Unassigned output groups remain unassigned and appear as coverage limitations.

## 7. Automatic confirmation and assignment

After a successful structured result, one transaction:

1. verifies that no confirmed Topic Model and no draft appeared since input
   freeze;
2. begins revision 1 with server-authored generation basis and evidence refs;
3. creates the root and child nodes through repository-owned UUID allocation;
4. confirms the exact draft edit revision as `system_auto`;
5. appends topic-aware system keyword decisions for eligible keywords;
6. uses provider intent where available and LLM intent only as fallback;
7. records the same successful AnalysisInvocation on every generated fallback;
8. skips any keyword with a user decision or a revision that moved;
9. returns a report accounting for assigned, skipped, unassigned, and limited
   keywords.

No existing confirmed revision is mutated. Any concurrency conflict is a safe
no-op/skip for automation, not an instruction to overwrite the newer model.

## 8. User adjustment semantics

- The automatic revision is immediately available to Keyword review and Topic
  insights.
- The UI labels it `AI 自动生成 / 系统自动确认` and shows generation time,
  provider/model lineage, coverage, and limitations.
- `调整 Topic` begins the next draft from the exact confirmed revision.
- Rename preserves Topic Node identity; split/merge/retire use existing
  successor and invalidation rules.
- User confirmation creates the next immutable revision and is labelled
  `用户确认`.
- Future Analysis Refresh runs see an existing confirmed model and skip Topic
  generation. They never erase the user's revision.

## 9. Artifact-aligned UI

### Keyword mode

- Move the Topic status/gateway above the keyword master-detail workspace.
- Show Topic, resolved search intent with authority badge, search volume, KD,
  rank/URL, source, freshness, and review status.
- Keep provider/LLM/user facts visually distinct.
- The right rail shows Topic -> mapped page -> CTA, same-topic demand signals,
  exact limitations, and the existing governed adjustment action.
- If generation is pending or failed, show that durable state and a safe retry
  route; never show an empty confirmed Topic as success.

### Pages mode

- Restore `按 URL / 按主题簇 / 按机会`, defaulting to `按机会`.
- Cluster view joins the exact confirmed Topic revision with the complete
  keyword and URL/opportunity inventories from one diagnostic generation.
- Counts, search-volume totals, page membership, and gaps are server-owned or
  computed only after all opaque cursor pages are loaded and identity-checked.
- A run/revision drift during aggregation fails closed and asks the user to
  refresh; it does not mix generations.

## 10. Historical recollection

Old observations remain immutable and continue to show unavailable KD/provider
intent. After code deployment, a separately authorized Analysis Refresh creates
new DataForSEO snapshots and observations with the retained fields. The current
library may use the newest canonical observation; pinned historical generations
continue to use their frozen refs and values.

The implementation may add a visible `需要重新采集` state and reuse the existing
server-owned Analysis Refresh command. It must not add a client-controlled
DataForSEO endpoint, accept provider credentials/limits from the browser, or
run a paid recollection during tests.

## 11. Failure behavior

- Provider field absent: keep null plus limitation.
- Provider field malformed: fail the provider boundary; do not partially invent
  the affected row.
- LLM configuration unavailable: Topic child fails/step becomes partial; no
  model or keyword assignment is written.
- LLM response invalid: persist rejected invocation, write no Topic revision.
- Crash after provider return: mark invocation attempt outcome unknown and do
  not silently repeat the paid call.
- Existing confirmed/draft model appears concurrently: do not write; report
  stale/no-op.
- Assignment conflict or human decision: skip that keyword and report it.
- Topic insights integrity drift: keep the existing fail-closed 503 behavior.

## 12. Verification requirements

Completion requires fresh evidence for:

1. DataForSEO parser RED/GREEN tests for KD and provider intent.
2. Adapter/search-landscape tests proving both fields survive normalization.
3. Contract and service tests proving provider and generated intent never
   overwrite user-confirmed intent and frozen generations never read newer
   facts.
4. Structured LLM client tests for bounds, unknown refs, duplicate assignments,
   malformed output, hashes, and absence of secret/raw payload leakage.
5. Worker/repository tests for first-model generation, auto-confirmation,
   assignment, retries, invocation lineage, and existing-model/manual-revision
   skip behavior.
6. Disposable real-PostgreSQL migration/integration tests for all new columns,
   tables, FKs, triggers, and transaction behavior.
7. Analysis Refresh vertical integration with a fake deterministic model client
   and live network disabled.
8. Growth Map view-model, i18n, accessibility, mock-browser, and real-browser
   tests for Topic state, user adjustment, three Pages views, deep links, and
   complete-inventory cluster aggregation.
9. Authority, OpenAPI, generated contract, lint, typecheck, unit, integration,
   build, secrets, Artifact, and deployment-configuration gates applicable to
   the changed surface.

GitHub Actions remain disabled/manual policy state and are not substituted for
these local and disposable-database gates.
