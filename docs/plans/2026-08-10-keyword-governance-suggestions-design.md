# Growth Map Keyword Governance Suggestions and One-Click Approval Design

**Date:** 2026-08-10

**Status:** approved by Owner

**Implementation baseline:** `main@beb0dc0d0d596fb84c9c5e54e1f79e74ddb5420d`

**Active customer experience authority:**
`docs/artifact-src/` and
`docs/artifacts/GenGrowth-Interactive-Artifact.html`

**Related authority:**

- `authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md`
- `authority/implementation-spec-v0.4/openapi.yaml`
- `authority/implementation-spec-v0.4/schema.sql`
- `docs/plans/2026-07-27-nevermore-keyword-growth-governance-design.md`
- `docs/plans/2026-08-09-growth-map-topic-metrics-design.md`

## 1. Decision summary

The Owner chose the single-keyword approval experience:

1. GenGrowth generates a complete, provenance-bearing Keyword governance
   suggestion before the customer opens the review UI.
2. The normal customer action is one click: **批准系统建议**.
3. The existing multi-field form is hidden behind **展开修改** and remains the
   escape hatch for exceptions and customer overrides.
4. Versioned suggestions remain separate from the effective, append-only
   `keyword_review_decisions` authority. A suggestion does not change the
   Keyword until a customer approves it.
5. Provider facts remain provider facts. An LLM may suggest governance fields
   but may never invent Keyword Difficulty, search volume, current rank,
   current URL, provider search intent, Snapshot facts, or Observation facts.
6. The current production save failure is a P0 in the same delivery. The
   advanced editor must remain reliable; known database constraint failures
   must not escape as an opaque HTTP 500.
7. Batch approval is intentionally out of scope. The Artifact and the Owner's
   selected option both define a single-item decision in this release.

## 2. Authority and Artifact boundary

The active worktree Artifact is the formal customer visual authority. At the
design baseline its generated HTML SHA-256 is:

```text
51d66a6c88fe23c0174da3859cc4dc0738e83a79dce8ae929d3f0c847cb36fbe
```

The Owner also supplied a historical Artifact from another checkout as an
interaction reference. Its SHA-256 is:

```text
7b4c38320e7fa8064f066283bf4cee4b415d54274329b148fc9aaae9cd0aacc9
```

The historical copy does not override the current repository-owned Artifact,
OpenAPI, or database authority. The relevant interaction principles are the
same in both copies:

- the Keyword workspace is a master-detail layout;
- selecting a row renders a concise right-hand conclusion rail;
- deeper lineage and mapping detail moves into a secondary drawer;
- the default surface explains the route from Topic to Page to CTA rather than
  presenting a large form;
- missing metrics remain `未连接`, `不可用`, or `未覆盖`, never synthetic zero;
- Keyword actions are single-item actions; there is no batch governance UI.

The Artifact does not yet contain a versioned Keyword suggestion approval flow.
This design extends its existing information hierarchy instead of treating the
historical scenario as proof that the new capability already exists.

## 3. Current-state gaps and confirmed failure boundary

### 3.1 The current UI is a data-entry form

`KeywordReviewDialog` initializes seven editable fields from the current
effective Keyword state:

- status;
- intent;
- buyer stage;
- Topic node;
- mapping decision;
- mapped SitePage;
- reason.

Those values are not a separately versioned system suggestion. The user must
understand and confirm every field before saving. That is the opposite of the
approved conclusion-first interaction.

### 3.2 Candidate Keywords are excluded from the LLM path that could help them

The existing Topic generation and assignment flow starts from diagnostic
governance that is already approved, mapping-confirmed, and clustered. A
`candidate + unreviewed` CSV Keyword therefore cannot enter the LLM assignment
input. This creates a circular gate:

```text
candidate Keyword
  -> customer must manually classify it
  -> only approved governance enters Topic generation
  -> the system suggestion arrives after the work it was meant to remove
```

The new suggestion candidate inventory must be independent from the published
Diagnostic governance freeze. It may read current candidate governance, but it
must never rewrite a published generation.

### 3.3 Production review currently has an uncaught database failure class

Production evidence from 2026-08-10 confirms that one Keyword review PATCH
returned HTTP 500 with a `DrizzleQueryError`. The same Keyword's preceding
review-detail GET returned 200, and an earlier PATCH returned 200. This rules
out a general authentication, route, or request-parser outage.

The failure crossed the current service boundary because it maps only typed
`KeywordGovernanceConflictError` and `KeywordGovernanceIntegrityError` values.
A native PostgreSQL/Drizzle failure from either the `keyword_entities` CAS
update or `keyword_review_decisions` insert is rethrown as an internal error.
The current production log did not include a safe SQLSTATE/constraint label, so
the design does not guess a constraint name.

The canonical production-shaped tuple itself is valid and already exercised by
fixtures:

```text
CSV candidate
  + confirmed Topic
  + approved
  + mappingDecision=new_asset
  + mappedSitePageId=null
```

The highest-probability remaining classes are state/migration drift, an
unmapped trigger/FK constraint, or corrupt mirror-versus-ledger state. The fix
must therefore start with a genuine PostgreSQL reproduction and safe structured
error evidence, not with relaxing constraints.

## 4. Target customer experience

### 4.1 Keyword rail

The selected Keyword's right-hand rail retains the Artifact hierarchy:

1. Keyword identity, current status, Topic, and intent;
2. provider metrics with honest null states;
3. source/ingestion route;
4. Topic -> Page -> CTA path;
5. related demand signals;
6. one concise governance action area.

When a current pending suggestion exists, the governance area shows:

- `系统建议待批准`;
- suggested status;
- search intent and buyer stage;
- confirmed Topic;
- Page mapping (`已有页面`, `新内容资产`, or `暂不分配`);
- one short reason;
- deterministic readiness/limitation text;
- primary action `批准系统建议`;
- secondary action `展开修改`.

It does not show raw invocation IDs, Snapshot IDs, prompt payloads, SQL details,
or a multi-field form in the default state. Those remain available in a
secondary provenance disclosure where customer value warrants them.

### 4.2 Review dialog/drawer

Opening review renders the same compact suggestion summary first. The primary
button is `批准系统建议`. Approval requires no checkbox and no repeated reason
entry.

`展开修改` reveals the existing fields with the suggestion prefilled. The user
may change any governed field before saving. A modified approval remains a
human decision and records that it resolved a system suggestion with edits.

Only these conditions force the expanded path or a second confirmation:

- the Topic has a confirmed coverage conflict;
- the suggested Topic or SitePage is no longer active;
- the Keyword governance revision changed after suggestion generation;
- the suggestion has insufficient deterministic authority to be marked ready;
- a required Product Profile, market, language, or confirmed Topic authority is
  unavailable.

### 4.3 UI states

The customer-visible states are:

| State | Meaning | Primary presentation |
| --- | --- | --- |
| `generating` | An internal bounded job is producing a suggestion | `系统建议生成中` and no approval button |
| `pending_ready` | Suggestion is complete and all stable identities resolve | `批准系统建议` |
| `pending_needs_review` | Suggestion exists but one governed choice requires judgment | `展开修改` |
| `stale` | Keyword/Topic/Page authority changed after generation | refresh/regenerate explanation; no blind approval |
| `unavailable` | Required authority or a safe model outcome is absent | honest limitation and optional manual edit |
| `approved` | A human decision was appended from this suggestion | current effective governance and receipt |

No model-supplied numeric confidence score is displayed as truth. `ready` versus
`needs_review` is a deterministic server decision based on identity resolution,
lineage, conflict, and required-field checks.

## 5. Suggestion authority

### 5.1 New durable record

Add one table, provisionally named `app.keyword_review_suggestions`, in ordered
migration `0051_keyword_review_suggestions.sql`.

The row contains immutable suggestion content plus a tightly constrained
resolution transition:

- stable suggestion UUID;
- workspace, project, and Keyword entity scope;
- exact `expected_governance_revision`;
- `suggestion_version = keyword-governance-suggestion.v1`;
- `prompt_set_version = keyword-governance-suggestion.prompt.v1`;
- `input_hash` and `output_hash`;
- `pending | approved | superseded` state;
- suggested status, intent, buyer stage, Topic node/revision, mapping decision,
  mapped SitePage, and reason;
- field-level authority/provenance for intent and generated governance fields;
- successful `analysis_invocation_id` for model-generated fields;
- creation time;
- terminal resolution mode `accepted | edited` when approved;
- final `keyword_review_decision_id` when resolved;
- superseding suggestion identity when replaced.

Suggestion content is immutable after insert. A database guard permits only one
legal transition from `pending` to `approved` or `superseded`, with the required
terminal linkage. A partial unique index allows at most one pending suggestion
per current Keyword scope.

The table is not the current Keyword authority. Effective state remains:

```text
keyword_review_decisions append-only ledger
  -> keyword_entities current compatibility projection
```

### 5.2 Human authority remains explicit

One-click approval appends a normal `decision_origin=user` decision with the
server-resolved actor. It does not relabel the user action as an automatic
`system_suggestion` decision.

Historical effective `system_suggestion` rows remain readable and are never
rewritten. New pending suggestions do not appear as user-confirmed values in
current or frozen Growth Map projections.

### 5.3 Eligible candidate inventory

Version 1 admits current Keywords that are:

- in an active scoped project;
- `query_kind=search_query`;
- `status=candidate`;
- `mapping_review_state=unreviewed`;
- not already governed by a later human decision;
- in the exact primary market and Site language used by the confirmed Product
  Profile/Project authority;
- backed by at least one current occurrence with valid provenance.

GenerativeQuery rows are excluded. They belong to the fixed AI citation cohort,
not Page/Topic content governance.

Human decisions always win. A suggestion generator may supersede an older
pending suggestion after the input hash or governance revision changes, but it
may never overwrite an approved, excluded, parked, or human-confirmed Keyword.

## 6. Suggestion generation

### 6.1 Triggering and latency

Suggestion generation is asynchronous post-processing. It must not extend the
critical customer-visible Analysis Refresh duration.

The same internal enqueuer is invoked after any of these authoritative events:

- Analysis Refresh has materialized new current Keyword evidence;
- a CSV Keyword import has materialized current occurrences;
- a new Topic Model revision is confirmed.

The enqueuer freezes a deterministic input hash and uses an active-key/idempotent
run fence. If no confirmed Topic authority exists yet, generation waits for
Topic confirmation instead of inventing a Topic.

Use a distinct internal async operation,
`keyword_governance_suggestion_generation`. Do not disguise it as
`topic_model_generation`; the inputs, output contract, retry semantics, and
customer meaning differ.

### 6.2 Bounded model work

Generation is batched and paginated; it never performs one model call per
Keyword. Version 1 uses bounded, deterministic ordering and a fixed maximum of
100 Keywords per invocation. Larger candidate inventories converge through
subsequent idempotent batches.

Each frozen input includes only the data needed for its batch:

- exact Keyword IDs and expected governance revisions;
- display/normalized Keyword and current occurrence lineage;
- provider-observed metrics and intent, when present;
- confirmed Product Profile and ICP facts;
- exact confirmed Topic revision and bounded active Topic nodes;
- bounded same-project SitePage candidates and their stable identities;
- existing deterministic URL/Page attribution;
- market, language, input version, and hashes.

The model sees prompt-local keys, not database-owned UUIDs it can invent. The
server resolves every returned Topic/Page key back to the frozen allowlist.

### 6.3 Deterministic-first resolution

Resolution order is:

1. keep an existing human-confirmed governance value;
2. use exact provider-observed intent when available;
3. use exact GSC/current-ranked URL attribution when it resolves to an owned
   SitePage;
4. use current confirmed Topic/Page coverage rules;
5. ask the LLM for missing governance recommendations from bounded candidates;
6. use `new_asset` or `unassigned` honestly when no existing Page is supported.

The LLM may suggest:

- Keyword status;
- canonical semantic intent when provider intent is absent;
- buyer stage;
- one prompt-local confirmed Topic;
- mapping mode and one prompt-local SitePage candidate;
- a short reason.

The LLM may not generate:

- Keyword Difficulty;
- search volume;
- current rank or current URL;
- provider-observed intent;
- Snapshot/Observation IDs or timestamps;
- Topic/SitePage UUIDs or revisions;
- actor, approval, or publication facts.

### 6.4 Invocation and retry boundary

Reuse the established model-call fence:

```text
freeze input and hash
  -> reserve invocation attempt in a transaction
  -> release transaction
  -> call the structured model client
  -> persist immutable AnalysisInvocation/output hashes
  -> resolve prompt-local identities
  -> insert pending suggestions atomically
  -> terminalize the internal run
```

The network call never holds project or Keyword locks. `reserved` and
`outcome_unknown` states block silent duplicate paid calls. Invalid structured
output fails closed and creates no partial suggestions.

## 7. HTTP and transactional flows

### 7.1 Read model

The current Keyword review detail adds a nullable strict
`pendingSuggestion` projection. Published `diagnosticRunId` reads remain frozen
and never read a later pending suggestion. The current `view=review` read may
return the current pending suggestion and its customer-safe lineage summary.

### 7.2 One-click approval endpoint

Add a scoped operation equivalent to:

```text
POST /projects/{projectId}/audit/keywords/{keywordId}/review-suggestions/{suggestionId}/approve
```

The strict body carries the expected Keyword governance revision and suggestion
version. It carries no client-authored actor, timestamp, lineage, Topic label,
or provider fact.

Inside one transaction the service:

1. acquires the project Topic-governance writer lock;
2. locks the Keyword and pending suggestion;
3. verifies project/workspace scope and active project;
4. verifies suggestion version and expected Keyword revision;
5. revalidates confirmed Topic and same-project SitePage authority;
6. copies the immutable suggestion into a canonical human review decision;
7. advances `keyword_entities.mapping_revision` exactly once;
8. appends `keyword_review_decisions` with `decision_origin=user`;
9. marks the suggestion approved with `resolution_mode=accepted` and links the
   decision;
10. returns the authoritative current detail projection.

An exact replay returns the same final decision. A stale or mismatched request
never partially advances either record.

### 7.3 Expanded edit

The existing human PATCH remains the advanced editor command. Under the same
project lock it resolves any current pending suggestion for the exact expected
revision. On successful edited review it:

- appends the user decision;
- advances the current projection;
- marks the pending suggestion approved with `resolution_mode=edited` and links
  the decision.

If no pending suggestion exists, PATCH keeps its existing manual-review
semantics.

## 8. P0 save reliability and error handling

### 8.1 Genuine PostgreSQL RED fixture

Before changing production code, add a disposable PostgreSQL integration test
that follows the real path:

```text
CSV occurrence
  -> Keyword materialization
  -> Topic draft/patch/confirm
  -> reviewProjectAuditKeyword
  -> approved + Topic + new_asset
```

Assert one Keyword revision advance and one append-only decision. Then add
corrupt-state variants that cannot be represented by mocks, including missing
current decision or mirror-versus-ledger drift, and assert fail-closed typed
behavior with full rollback.

The implementation must not weaken triggers to make this test pass.

### 8.2 Safe database error classification

Known PostgreSQL constraint classes are classified at the service/repository
boundary:

- SitePage FK/scope loss -> customer-safe missing/stale Page response;
- Topic FK/confirmed-revision loss -> customer-safe invalid/stale Topic
  response;
- projection/revision/ledger guard failure -> dependency integrity response;
- duplicate/CAS conflict -> revision conflict;
- unknown database error -> internal error after sanitized structured logging.

Logs may include request ID, operation (`keyword_update` or `decision_insert`),
SQLSTATE, constraint name, workspace/project/Keyword IDs, and governance
revision. They must not include credentials, profile JSON, prompt text, Keyword
text, provider payloads, or raw SQL parameters.

The UI maps stale conflicts to a refresh action, invalid suggestions to the
expanded editor, and dependency failures to a retry/support message. It no
longer reduces every non-409 failure to the same unexplained copy.

No automatic production data repair is part of this code change. Any existing
production governance drift must be inspected read-only and repaired only under
separate, explicit production-write authorization.

## 9. Cache and projection consistency

After approval or edited review, the client must refresh:

- exact current review detail;
- current unpinned Keyword list pages;
- current Topic coverage/insights affected by the decision;
- selected right-hand rail;
- any duplicate-governance eligibility derived from the Keyword.

Published pinned generations remain unchanged. The UI must never combine a
pending current suggestion with a frozen historical Keyword decision and imply
they belong to the same generation.

## 10. Artifact implementation

The repository-owned Artifact source is extended before regenerating the HTML:

- `docs/artifact-src/workspace-data.js` adds a scenario Keyword with a pending
  ready suggestion and one needs-review exception;
- `docs/artifact-src/client-app.js` adds the compact suggestion card, one-click
  approval receipt, and expanded editor state;
- `docs/artifact-src/styles.css` reuses the existing rail/drawer hierarchy;
- deterministic build/verify tests prove regeneration has no drift.

The Artifact remains scenario-only. Its approval action updates only the
Artifact's in-memory scenario and generates an explicit scenario receipt; it
does not claim to call the authenticated API or write production data.

## 11. Test and acceptance matrix

### 11.1 Contract and authority

- strict Zod/OpenAPI shapes accept exactly the versioned suggestion states and
  reject extra/missing lineage fields;
- provider-observed and LLM-generated intent shapes cannot borrow each other's
  lineage;
- two OpenAPI copies remain byte-identical and generated types have no manual
  patch;
- migration/schema/lock/inventory/verifier updates are atomic.

### 11.2 Database

- one pending suggestion per Keyword/revision;
- suggestion payload immutable;
- only legal terminal transitions allowed;
- cross-project Keyword, Topic, Page, invocation, and decision references fail;
- approval advances revision exactly once and appends exactly one user decision;
- exact replay is idempotent;
- stale CAS rolls back;
- edited review links the suggestion without disguising it as automatic;
- generated output without a successful invocation fails closed;
- real CSV -> Topic -> new-asset review succeeds on disposable PostgreSQL;
- corrupt mirror/ledger and named constraint cases return typed failures with no
  partial write.

### 11.3 Worker/model

- candidate/unreviewed SearchQuery Keywords enter the suggestion inventory;
- GenerativeQuery rows do not;
- human-governed rows do not;
- deterministic ordering and 100-row bound are enforced;
- model call occurs outside transactions;
- prompt-local Topic/Page keys resolve only from the frozen allowlist;
- missing provider metrics remain null;
- provider intent is not overwritten by an LLM;
- invalid output, reserved/outcome-unknown retry, and partial batch insertion
  fail closed;
- Analysis Refresh completion is not delayed by suggestion generation.

### 11.4 UI and Artifact

- Chinese default review shows the compact suggestion and one primary approval
  button without any required checkbox/select/textarea;
- English copy has exact parity;
- `展开修改` reveals the full prefilled editor;
- accepting and edited approval both refresh the current row/rail;
- stale suggestion, Topic conflict, missing Page, generating, and unavailable
  states are distinct;
- keyboard focus, dialog disclosure, alert roles, and responsive layouts pass;
- Artifact E2E proves concise rail -> expanded detail -> scenario receipt;
- mock browser E2E proves API payloads contain no client-owned actor, lineage,
  or provider facts;
- real browser/PostgreSQL E2E proves one-click approval persists one canonical
  user decision.

## 12. Out of scope

- batch/page-wide approval;
- automatic approval without a human action;
- LLM-generated KD, volume, rank, URL, provider intent, or provider lineage;
- rewriting published Diagnostic generations;
- automatic regeneration over human governance;
- a public API for clients to choose model, prompt, batch size, or provider;
- production migration, production repair, paid provider/model canary, push, or
  deployment without separate explicit authorization.

## 13. Completion criteria

The feature is complete only when:

1. the repository-owned Artifact and authenticated UI both implement the
   approved one-click/default, expand-to-edit interaction;
2. a candidate CSV Keyword receives a durable pending suggestion without
   becoming approved;
3. one customer click appends one canonical user decision with exact lineage and
   revision safety;
4. provider facts remain unchanged and unavailable values remain null;
5. the advanced editor no longer exposes known database constraint failures as
   an opaque 500;
6. all relevant authority, real PostgreSQL, unit, integration, Artifact,
   browser, lint, typecheck, build, and secret gates pass;
7. Git, push, deployment, migration, and production status are reported
   separately and truthfully.
