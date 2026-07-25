# SEO/GEO Content Shadow — Slice 2 product stop gate (2026-07-25)

This is the Slice 2 product stop gate required by
`docs/plans/2026-07-25-slice2-content-shadow-execution-plan.md` (§4 Task 9, §5
Definition of Done). It follows the shape of the Slice 1 gate
(`docs/reviews/2026-07-21-growth-opportunity-slice1-stop-gate.md`): evidence for
each required decision, the residuals recorded in full, a gate decision, and a
non-normative Slice 3 re-entry brief. It adds no migration, no operation and no
task.

Branch `codex/unified-growth-opportunity-v03`; base `945be02` (Slice 1
accepted); product `0.3.0`; runtime contract `2026-07-21`; authority
`authority/implementation-spec-v0.3/`; rule set `mvp.rules.0.2.0` (11 canonical
rules). Machine surface after Slice 2: **49 API operations / 9 async operations
/ 44 PostgreSQL application tables / 11 frozen rules** (`pnpm verify:spec`,
`pnpm verify:authority`, `pnpm implementation:check` all agree).

**How to read the "Known simplifications" section.** It is written to be
unpleasant. Every entry states what happens now, who it affects, and where the
cost stops. Phrases like "future work", "later iteration" and "not yet
supported" are deliberately absent: they turn a limit a reader must act on into
a schedule note they can skip.

---

## 1. What was delivered

| Task | What landed | Commits |
|---|---|---|
| 1 | Authority narrative widened from "no content lifecycle / no CMS" to **Shadow-but-no-CMS**: an internal `english_blog_draft` and a Flow Shadow research/draft/QA lifecycle are permitted as internal writes; external CMS/publish writes and any "published" marking stay forbidden (`MVP-IMPLEMENTATION-SPEC.md:84-85`). Both verifiers stayed migration-aware. | folded into `94564a8`, `7b0f951`, `4025577` |
| 2 | `flow_shadow_runs` + `flow_shadow_research_packs` + `flow_shadow_qa_gates` (append-only children, frozen inputs, `content_hash`); tables 41 → 44; `ArtifactType` extended with `english_blog_draft` only. | `94564a8`, `7b0f951`, `4025577` |
| 3 | **Not done.** `CandidateOpportunity.supportingFindingIds` is still hardcoded `[]` (`opportunities-projection.ts:292`). See §4 residual E5. | — |
| 4 | `createContentShadowRun` async operation + pg-boss `content-shadow` queue + worker handler/module + pinned Flow adapter version (extraction, no runtime sibling-repo import). | `151fe73`, `c3d0174` |
| 4b | Brief → draft causal link: structured `contentBriefOutline` extraction into the frozen manifest, with a sanitised, closed-set injection surface. | `cf6ac6f`, `b327d7a` |
| 5 | Red line B upstream hardened: confirmed content Finding → **one** Action → **one** `content_brief`, reusing the existing Finding Review transaction. Includes a Slice 1 TOCTOU fix on `confirmFinding`'s `last_seen_run_id`. | `6a3c0b9` |
| 6 | SEO/GEO QA + factual-review gate: 26 deterministic claims, blocking set exactly three (`rl8` / `rl12` / `sc9b`), replay compares claims and not only the verdict. Four rework rounds. | `6332377`, `e0cf3bc`, `cd715e0`, `632ce64`, `d908ebb`, `fb0a133`, `c53c36f`, `a501b73`, `6b5512a`, plus `05b1282` (pre-existing prompt-redaction defect) |
| 6b | `listContentShadowRuns` (operations 48 → 49) so a run survives a page reload, and `severity` on every QA claim resolved from the gate package's own severity table. | `074ec7b` |
| 7 | Execution renders the deliverable itself: draft body at reading size, three-way quality rail, frozen records, and the honesty disclosures — with no run id, action id, finding id or rule id shown to a customer. | `87d3b74`, `0a01d75`, `66ce9ce` |
| 8 | `reviewContentShadowRevision`: side-by-side brief↔draft, revision-bound human review, a receipt whose `externalPublishingWrite: none` is a wire field rather than a sentence, and a permanently disabled publish control. | `5d2c897` |
| 9 | This document, plus the content vertical E2E (`e2e/content-shadow-vertical.mock.spec.ts` + `e2e/content-shadow-vertical-fixture.ts`) and the durable residual list (`docs/plans/2026-07-25-slice2-stop-gate-residuals.md`). | this commit |

---

## 2. Definition of Done, item by item

### 2.1 The content vertical runs end to end, with zero external write — **met**

`e2e/content-shadow-vertical.mock.spec.ts` walks the chain the execution plan
names, and every segment carries its own assertion. A walk-only test would pass
with a link cut, because the next screen is reachable by URL; so each segment
asserts the identity it received from the one before it.

| DoD segment | Assertion that proves it |
|---|---|
| URL + ICP | Four primary nav links in canonical order; "Run growth audit" is offered only with a confirmed ICP; the recorded request body is `scope.kind = "site"` + `capabilityContractVersion = "growth-audit.0.3.0"`. |
| → one content Finding | Opportunity Review shows exactly 3 separately reviewable Finding cards on one URL; the content card is `CONTENT-COVERAGE-001` and carries the same `code[title]` target and Evidence id as the audit evidence chain; confirming it records exactly **one** `PATCH /findings/{contentFindingId}`; the canonical and CTR Findings are asserted **not** in `confirmedFindingIds`. |
| → one Action | The confirmation response carried exactly one Action object, bound to the Finding that was confirmed (`contentActionsCreated` has length 1 and `findingId === contentFindingId`). |
| → one content_brief | Execution's queue has exactly **one** "Content brief" region containing exactly **one** card, it is the brief artifact id, and it names the single Action's title. |
| → Flow Shadow research | The quality rail states the frozen record count, the truncated `content_hash`, `Citable outside sources: 0 — no outside retrieval this run`, and the pack's own limitation string "no external source was retrieved or graded". |
| → Flow Shadow draft | `[data-shadow-body]` renders the draft's own prose; `[data-shadow-revision]` reads `Revision 1`; `[data-shadow-status='draft']` is present. |
| → Flow Shadow QA | `5 checks in this run` with a three-way tally asserted separately (`Passed 3` / `Not passed 1` / `Not judged 1`); the verdict is bound to a revision (`This conclusion covers revision 1.`); the red-line group reads `Passed · 1 not judged` rather than a tick, and expanding it shows the unjudged claim's stated reason. |
| → side-by-side human review | `[data-compare]` shows `Content brief · revision 3 (frozen)` with the brief body, and `English draft · revision 1` with the draft body; the recorded network read is asserted to have been `?revision=3` — the revision the run **froze**, not the brief's current text; exactly one committed topic is annotated `Not covered in draft`, quoting the gate. |
| → reviewed Revision | Passing a `needs_review` verdict requires the acknowledgement checkbox (`required`); the review request body is exactly `{baseRevision: 1, acknowledgeFindings: true}`; the receipt names the revision and the deliverable; afterwards `[data-shadow-status='ready']` reads **"Reviewed · not published"** and the human-review row is `passed`. |
| zero external write, throughout | Every non-GET request is recorded and the **exact set** is asserted after each segment: 1 write after the audit run, 2 after the confirmation, still 2 through the brief/research/draft/QA/compare reads, 3 after the review. The final set is exactly `POST /audit-runs`, `PATCH /findings/{id}`, `POST /content-shadow-runs/{id}/review`. |

Zero external write is asserted five ways, not one:

1. **The write set is exact and checked after every segment**, so a write
   introduced in the middle fails at the segment that made it rather than
   netting out at the end.
2. **`exportRequests` is `[]`** for the whole vertical.
3. **Every request of any method stayed on the app's own origin** — the set of
   distinct origins the browser contacted is asserted to be exactly the app
   origin. This is what "connects to no CMS, Git or third-party publishing
   target" means at the network layer instead of as a sentence on a screen.
4. **No published state exists.** Every `data-shadow-status` value on the screen
   is asserted to be one of `draft` / `ready`; the screen text is asserted to
   contain no capitalised state word `Published`, no `Published to`, no
   `Live at`. `"not published"` — the denial — is what the `ready` pill says.
5. **The publish control is inert.** It is natively `disabled`, its label
   carries the limit, a DOM-level click adds no request, and the block mints no
   anchor.

Both assertions were mutation-checked rather than assumed: adding a second
`content_brief` to the fixture turns the red-line-B assertion red
(`locator resolved to 2 elements`), and the first run of the vertical failed on
a real behavioural detail (a collapsed claim group) rather than passing
vacuously.

**Scope of this proof, stated plainly.** This is a mock-API E2E. It proves what
the product's *surfaces* do with the contracts. The transaction-level guarantee
— `countActionsForFinding === 1`, replay idempotence, archived/dismissed
handling — is proven against a real PostgreSQL by
`apps/web/src/lib/services/__tests__/content-opportunity-vertical.integration.test.ts`,
which runs in the `test:integration` gate below.

### 2.2 One measured content Finding → one Action → one content_brief (red line B) — **met**

Enforced at three layers, not one:

- **Database**: two UNIQUE constraints bound it from above ("no more than one").
- **Service**: `6a3c0b9` closed the lower bound ("there really is one, it is
  live, and it belongs to the current diagnosis"), which previously rested on
  operator habit and surfaced as three 5xx paths with no `problem+json`.
- **Surface**: the second test in `content-shadow-vertical.mock.spec.ts` asserts
  three Findings offer three Confirm controls, that clicking one leaves the
  other two still offering their own, that exactly one Action results, and that
  the queue holds exactly one `content_brief` and exactly one
  `english_blog_draft` — the Flow Shadow output, not a second brief.

No new approval-event, checkpoint or Opportunity table was added. The Flow
Shadow run consumes the confirmed brief revision; it does not open a parallel
content lifecycle.

### 2.3 QA gate blocks or flags unsupported claims — **met, within a boundary that must be read**

The blocking set is exactly three claims (`rl8` assertion with no traceable
source, `rl12` citation resolving to nothing, `sc9b` listed source not in the
frozen pack). Attribution must resolve to a real row in the research pack, and
the pack is assembled only from confirmed database rows — so a hallucinated
source has nowhere to resolve. This closed the two holes in the sibling repo's
original rule, whose ALLOW list accepted any four-digit year and any
`by [A-Z]\w+`, meaning `According to a 2024 Forrester study` passed.

The boundary this creates is not a defect and is not optional reading: see §4
group A. **`blocked` is the ordinary outcome of this stage, not an exception.**

### 2.4 The run is frozen by `content_hash` and deterministically re-renderable — **met**

`flow_shadow_runs` freezes a content-addressed tuple containing the confirmed
Opportunity evidence snapshot, `primaryFindingId`, the `content_brief` revision
id, the frozen competitor set, the frozen SearchQuery cluster, the independent
GenerativeQuery set, the frozen first-party identity (`sites.origin` plus the
ICP conversion URL), the extracted `contentBriefOutline`, and the pinned Flow
adapter version. QA thresholds are package constants inside `@sf/flow-shadow`,
not database rows, so changing a threshold **must** move the adapter version —
the forcing function red line C needs. `e0cf3bc` made gate replay compare the
claims and not only the verdict, closing a path where a reproducibility
divergence was silently swallowed as an idempotent pass.

Search and generative observations stay separate (invariant 8): they are two
frozen sets, they never collapse into a shared volume, and generative queries
are deliberately **not** merged into the outline field that shapes the prompt.

### 2.5 Full repository gate green — **met**

Every gate below was run at this commit's tree, in this worktree, on this
machine.

| Gate | Result |
|---|---|
| `pnpm verify:spec` | pass — 49 operations, 9 async, 44 tables, 11 rules |
| `pnpm verify:authority` | pass — same four counts |
| `pnpm implementation:check` | pass — 44 app tables, 11 rules, 9 async envelopes |
| `pnpm openapi:lint` | pass |
| `pnpm contracts:check` | pass — no diff |
| `pnpm lint` | pass (10 workspace projects + `e2e`) |
| `pnpm typecheck` | pass (10 workspace projects + `e2e`) |
| `pnpm build` | pass |
| `git diff --check` | clean |
| `pnpm test` (unit, no `DATABASE_URL`) | pass — 304 files, 3732 passed, 2 skipped |
| `pnpm db:migrate` | pass — 21 migration files applied |
| `pnpm db:smoke` | pass — fixtures rolled back |
| `pnpm db:migrate:check` | pass — 44 tables / 56 indexes / 69 triggers / 18 routines |
| `pnpm test:integration` | pass — 64 files, 465 tests |
| Content vertical E2E + the three sibling mock specs | pass — 18/18 (`content-shadow-vertical`, `content-shadow-execution`, `content-shadow-review`, `audit-technical-vertical`) |

The complete `pnpm test:e2e:mock` suite was **not** run green and is **not**
claimed green. See §4 residual D4.

### 2.6 Two DoD items that were **not** met

Both are recorded here in full rather than quietly dropped.

**(a) "Needs more evidence / send back to draft" as a clickable review outcome —
not met.**

*Reason.* The frozen artifact status machine forbids `ready → draft`
(`authority/implementation-spec-v0.3/MVP-IMPLEMENTATION-SPEC.md:383-390`:
`generating → draft → ready`, `draft | ready → archived`, `failed →
generating`). The real path back from `ready` is **editing**, which appends a
new immutable revision and returns the deliverable to `draft` automatically.

*Ruling (main agent).* Where the UX specification and the frozen authority
specification conflict, the authority specification wins. Shipping two buttons
that write nothing is exactly the simulated-control pattern ruling β rejected,
so they were not built. The blocker block's "Next:" sentence names the real
path — revise the draft, or send it back for more evidence, then check it
again — instead of offering a control that would look like a decision and
record none.

*What this costs.* A reviewer who wants to reject a draft has to use the editor
below rather than a control beside the verdict. Nothing is lost from the record;
the extra cost is one navigation and the absence of a named "rejected" state.

**(b) A free-text reviewer note on the review decision — not met.**

*Reason.* `artifact_revisions` carries an append-only trigger
(`packages/db/migrations/0001_init.sql:864`), and this slice added zero DDL.
There is nowhere to persist a note.

*Ruling.* A textarea that discards its input is the same simulated-control
pattern. Instead the confirmation dialog was changed to state the object being
reviewed, require an explicit tick when the verdict is `needs_review`, and state
the impact before the click; the receipt claims only what it actually records —
the revision marked reviewed and the timestamp on the deliverable.

*What this costs.* A reviewer's reasoning is not captured anywhere in the
product. Anyone who needs it must record it outside SignalFrame.

---

## 3. UX / UI deviations from the accepted baseline

The instruction for Task 7/8 was explicit: *Overview and Growth Map are already
accepted; keep UX and UI unified with them.* Constraint **N-1** forbade
modifying those accepted modules at all. Both were honoured, and the price is
recorded here.

**N-1 compliance evidence.** `git diff --stat 945be02..HEAD` over
`apps/web/src/app/p/[projectId]/overview`, `.../growth-map` and `.../sources`
returns **empty** — zero lines changed across the whole slice.
`git diff --name-only 945be02..HEAD | grep -iE "overview|growth-map|sources"`
returns only two new files under `execution/`
(`_connected-sources.ts` and its test). `studio.module.css` is likewise
unchanged; only `_studio.tsx` moved (74 insertions, 58 deletions), to render the
new deliverable type in the existing queue.

**D-1. The specification's §4 type-filter bar and §5 queue rewrite were not
built.** The content surface is rendered through the `afterHero` slot **above**
the existing Studio workspace, rather than as the unified three-column queue the
reference artifact uses. `grep -rn "filterBar" apps/web/src` returns nothing.
*Reason:* rewriting the queue breaks the existing green assertions in
`e2e/real-vertical-chains.spec.ts`. *What this means now:* Execution has two
queues on one page — the Content Shadow run rail and the Studio artifact queue —
which is not the shape either the reference design or the accepted modules use.
*Cost boundary:* visual and navigational only; no honesty claim and no data path
depends on it. **Unifying the queue is a task of its own, with its own visual
regression evidence.**

**D-2. The global `ScenarioNotice` banner was not built.** *Ruling (main
agent):* the reference artifact's banner says "this whole demo is offline and
resets on refresh". SignalFrame is a real product against a real database, so
the honest statement is narrower ("this stage performs no external publishing
write") and belongs **on the surface that is limited**, not on every screen. A
global banner would also require changing the app shell, which is shared with
Overview and Growth Map — a direct N-1 violation. *What this means now:* a user
who lands on Results or Growth Map sees no standing statement about the shadow
boundary; they see it on Execution, where the deliverable is.

**D-3. `studio.module.css`'s `.workspace` was not widened to the specification's
§1.4 `268-300px`.** It stays at `238px` because
`e2e/studio-workspace.mock.spec.ts:49-50` pins that number to within 1px. The
new column width applies only to the newly created
`execution.module.css:236` (`minmax(268px, 300px)`). *What this means now:* the
two rails on the Execution page are different widths.

**D-4. Brand axis unresolved.** The app is SignalFrame (cobalt `#315efb`,
Fraunces/Manrope); the reference artifact is GenGrowth (deep green, Source Serif
4 / IBM Plex Sans). Task 7/8 use only `var(--sf-*)` semantic tokens, so a brand
ruling can be applied by rebinding `:root`. `growth-map.module.css`'s private
`--gm-*` tokens belong to that same task and were not touched.

---

## 4. Known simplifications and residuals

Transcribed in full from `docs/plans/2026-07-25-slice2-stop-gate-residuals.md`,
which is committed alongside this document so the two cannot drift.

### A. What the QA judgement can and cannot decide (the most important group)

**A1. "Citable outside sources: 0" is a zero by construction.** The research pack
is assembled only from already-confirmed database rows; **no external retrieval
happens at all**. Therefore any *external* reference in a draft has nothing to
resolve against — at best `needs_review`, and `blocked` when the signal is
strong. `passed` requires a draft that contains **no unverifiable external
reference**. This is the honest consequence of Slice 2's scope, not a defect,
and it means **an Owner reviewing real drafts should expect `blocked` to be
common**.

**A2. A correctly attributed first-party link is blocked too.** The pack freezes
`site.origin` (and the ICP conversion URL when available), **not page content**.
So "According to [our own product page](our-site), X" is held back — we genuinely
cannot confirm that page says X. Logically right, and the single most likely
source of a false-positive complaint.

**A3. Name predicates consult no dictionary, so Title Case bullet lists are
downgraded.** `- Track Activation Milestones Weekly` and
`- Forrester Digital Experience Report` are indistinguishable without one. **This
is a measured regression**: that shape moved from `passed` to `needs_review`.
*Cost boundary:* such a claim can only ever be `unevaluated` and **can never
reach `blocked`** — blocking needs a second signal (a year, a quoted title,
`et al.`) — and the detail says in words that the name may be a product, a
feature or a section title and a reviewer has to decide.

**A4. The other measured edges of the judgement.**
- `U.S. Department of Labor` is **missed**, because the internal periods break
  the token run. The direction is conservative.
- A real external work of two tokens with no year (`- Forrester Wave`) **escapes
  to `passed`**: it does not reach the three-token unsupported floor.
- `According to Search Console, clicks fell 34%` is **blocked** even though the
  data is first-party; only the possessive form (`Our Search Console export…`)
  is exempt.
- Inside a located standard section (`## Further reading` and similar), a
  sentence that is neither an address nor a name phrase (`- Read the onboarding
  guide`) is **accepted silently**. That is the design intent (prose under a
  navigation heading), and it means **a fabrication written as a sentence is not
  seen there**.
- **Frontmatter-masked content is scanned by no rule at all.** A multi-word
  pseudo-key (`Bottom line:`) is not masked, but a **single-word pseudo-key
  (`Summary:` / `Evidence:`) is.** Harmless in Slice 2 because masked content
  does not go live. **In Slice 3 `description` / `summary` are exactly the
  content that does go live — this must be re-assessed before publishing.**

**A5. Three capability gaps.**
1. **No duplication detection.** RL3 needs a SERP corpus and SignalFrame has
   none. **A draft copied word for word from a competitor's page passes this
   gate.**
2. **No external fact checking.** The pack reads only our own database. **An
   assertion that is false about the outside world, written without research
   phrasing, is not detected.**
3. **No brand-voice check.** There is no author persona and `BANNED_AUTHOR_TOKENS`
   is empty. **A draft in the wrong voice passes.**

**A6. Rules not ported.** RL1 / RL2 / RL3 / RL6 / RL9, each with its cost
recorded in the source. Also the URL-equality half of SC8: the conversion target
is frozen and the blocker is gone, but asserting CTA-URL equality would fail
every draft that links to pricing or documentation, which is a product decision
rather than a technical one.

### B. Data and presentation limits

**B1. The research pack carries identity, not metrics.** It holds keyword,
competitor and generative-query **ids and names** — **no search volume, no
impressions, no clicks**. The Execution surface renders `limitations` verbatim
for exactly this reason; nothing on it may read as "measured demand".

**B2. `citableCount` keeps its name but has changed meaning** — it now counts
**external** citable sources only. The rename is a clean follow-on; the current
meaning is stated in the field comment.

**B3. Version history holds two points** (current revision / judged revision,
plus the frozen brief revision). There is no operation that lists an artifact's
revisions. The panel is therefore titled "Versions this screen holds" and says
so in its subtitle — **it must never be presented as a complete history.**

### C. Test and reachability gaps each task declared about itself

**C1 (Task 5).** The `countActionsForFinding === 0` branch in
`createContentShadowRun` is **unreachable by construction** (the admission path
already holds a non-dismissed Action); it is covered by mocks only, as a
defensive assertion.

**C2 (Task 5).** `brief_archived` is unreachable: `findLiveByActionType` filters
archived first, so an archived brief surfaces as `CONTEXT_INCOMPLETE`.

**C3 (Task 5).** `brief_not_live` has unit coverage but no integration test —
constructing a `failed`/`generating` brief means fighting the status-transition
trigger.

**C4 (Task 4b).** `sanitizeOutlineItem` is **not idempotent when the truncation
boundary lands immediately after a `key=`** (3 cases in 420 probes). Its
docstring previously claimed idempotence "for every input"; that claim was
identified as overstated and corrected.

**C5 (Task 6).** `FlowShadowResearchPacksRepository.insert` still compares only
`content_hash` on replay (the pack side does not do the strict Q8-style
comparison the gate side does). **This is deliberate**: `pack.limitations`
contains `unconfirmedMappingCount`, and ruling O-3 explicitly permits it to
drift.

### D. Pre-existing debt (**not introduced by this slice, recorded because it gates the merge**)

**D1. The CI branch-coverage gate is red**: 78.21% against an 80% threshold
(`.github/workflows/ci.yml`, the `--coverage` unit-test step). Proven unrelated
to Slice 2 file by file with `json-summary`: subtracting every file Slice 2
touched leaves 77.96%, with the shortfall concentrated in Slice 1's
`growth-map.ts` (9.26%), `context.ts` (6.25%), `recheck-results.ts`,
`diagnostics.ts`, `csv-import.ts`, `collection.ts`. **This gate will block the
merge and needs an Owner decision.**

**D2. `pnpm audit` is red**: 11 vulnerabilities (5 moderate / 6 high), chiefly
from `next` (GHSA-955p-x3mx-jcvp requires `>= 16.2.11`), plus `js-yaml` and
`sharp`. Upstream advisory drift, unrelated to this slice.

**D3. `authority/implementation-spec-v0.3/scripts/verify-spec.test.mjs` is a
935-line stale parallel copy wired into no gate.** It was already 4-red before
Slice 2 started (it asserts 41 tables / 38 operations / 6 async and its migration
list stops at 0019). CI never runs it; Vitest only collects `.ts`. **It needs its
own commit to fix or delete.**

**D4. The complete `pnpm test:e2e:mock` suite is broadly red**: 24 passed / 84
failed of 108, about 31.5 minutes. The root cause is that the mock config's
webServer runs `next dev --webpack` and compiles on demand, so a cold start plus
CPU saturation makes the first hit on each heavy route time out in blocks; a
small amount of genuine drift is layered on top. Proven unrelated to Slice 1 and
Slice 2 by comparison against the base commit. **There is no trustworthy local
full-E2E baseline** — restoring one needs an isolated, warm CI run. Slice 2 runs
its content vertical and the three sibling content/audit specs in isolation, and
they pass 18/18; this document claims nothing beyond that. Two of the persistent
failures (`studio-first-paint`, `studio-workspace`) are the locale-cookie defect:
`DEFAULT_LOCALE` is `zh-CN` and those specs assert English strings without
setting `sf_ui_locale`.

**D5. Five existing operations throw a 503 that OpenAPI does not declare**:
`createActionArtifact`, `listProjectFindings`, `listProjectArtifacts`,
`getProjectReport`, `createProjectExport`. **This is the repository's existing
convention** — only `growth-map`, `keyword` and `competitor` operations are
forced by the verifier to declare 503 — and Task 5 followed it.

**D6. Two live credential-redaction bypasses (identified, not fixed).**
- `finding-summary-client.ts:110` — measured to forward
  `Password<U+200B>=hunter2` verbatim to an external LLM.
- `product-profile-client.ts:390` — the same, with two entangled defects:
  `safeUrlText:411` leaks through `redactUrl`, and `hasUnsafeRawContent:712`
  uses `redactText(v) !== v` as a detector and inherits the same blind spot.
The sibling defect in `envelope.ts`'s `safePromptText` **was** fixed
(`05b1282`). These two remain, and **text crossing them leaves the system
boundary for a third-party model provider** — a real disclosure, not a duplicate
of data we already hold.

**D7. `product-profile-competitor-projection.test.ts` sits in the unit project
but is DB-backed** with a hardcoded database name; it fails when `DATABASE_URL`
is exported. `pnpm test` (the gate as defined) is unaffected.

### E. Product decisions left open for the Owner

- **E1. Brand axis.** SignalFrame (cobalt / Fraunces / Manrope) versus the
  reference artifact's GenGrowth (deep green / Source Serif 4 / IBM Plex Sans).
  Task 7/8 use `var(--sf-*)` throughout, so a ruling propagates by rebinding
  `:root`. `growth-map.module.css`'s private `--gm-*` tokens are part of that
  task.
- **E2. Whether to enable SC8's CTA-URL equality check.** The conversion target
  is frozen, so the technical blocker is gone; enabling it fails every draft that
  links to pricing or documentation.
- **E3. Renaming `citableCount`.**
- **E4. How to handle the two red gates D1 and D3** — fix separately, adjust the
  threshold, or accept.
- **E5. Task 3 was not done.** `CandidateOpportunity.supportingFindingIds` is
  still hardcoded `[]` and the projection still emits no Candidate branch
  (`opportunities-projection.ts:292`) — unchanged from Slice 1 simplification #2.
  TopicCluster / PageAssignment likewise remain a read model with no dedicated
  table. **What this means now:** an Observation without a measured Finding is
  invisible in Opportunity Review, and the "supporting Findings" field of the
  contract is populated for nothing.

---

## 5. Verification history

Recorded because the *strength* of verification is part of what an Owner is
accepting, and because this slice's failure mode was consistent enough to name.

| Task | Verification | Outcome |
|---|---|---|
| 4 | 45-agent adversarial verification | 14 confirmed / 23 falsified |
| 5 | adversarial verification | 0 confirmed / 24 falsified |
| 4b | adversarial verification | 7 confirmed, including a divergence between the frozen bytes and the bytes the model actually saw |
| 6 | **four rounds of verification and four rounds of rework** | 18 → 16 → 16 → converged |
| 7 / 8 | targeted verification plus the two mock specs | converged |
| 9 | this document; the content vertical E2E, with two mutation checks | 18/18 mock specs pass |

**How Task 6 was closed out matters more than the defect counts.** The stopping
criterion was **not** "no defects found". It was that the *character of the worst
case* had changed: in each of the first three rounds there existed a path where a
**fabricated citation silently obtained `passed`**. In the fourth round, no row
of the escape table reached `passed` — every remaining escape is either `blocked`
or handed to a human as `unevaluated`. That is the property the gate exists to
have. Rounds 2 and 3 both found 16 issues; the count did not improve, and the
gate was closed anyway, on the change in kind rather than in number.

**The most stable defect source in this slice was "claiming more than is
actually done"** — at least four separate instances:

1. a test whose **name** described the right property while its **assertion**
   checked something else;
2. a commit message that named a defect as fixed which measurement showed still
   present;
3. a claim `detail` that reported "**I did not scan this**" as "**it is not
   there**";
4. a docstring asserting idempotence for an input class that is not idempotent
   at the truncation boundary (C4).

Each was found by re-reading the artefact against what it asserts, not by
running more tests. Slice 3 should assume this failure mode is still present and
budget for it explicitly.

---

## 6. Decision

**Recommendation: `accepted-with-conditions`.** This is a recommendation only;
the Owner decides.

*Why accepted.* The Definition of Done's substantive claims are met and
evidenced: the content vertical runs URL + ICP → one content Finding → one Action
→ one `content_brief` → Flow Shadow research/draft/QA → side-by-side human review
→ a reviewed revision, with the write set asserted exactly at every segment and
every request confirmed to have stayed on the app's own origin. Red line B is
enforced at three layers rather than assumed. Red line C is frozen by a
content-addressed tuple whose thresholds cannot move without moving the adapter
version, and replay now compares claims and not only verdicts. Red line D holds:
no CMS, Git or third-party target is written, no state on any screen claims
publication, and the publish control is disabled rather than simulated. The
accepted Overview / Growth Map / Sources modules are provably untouched. The full
repository gate is green, including 3732 unit tests and 465 integration tests
against a real PostgreSQL.

*The conditions, which are the reason this is not a plain `accepted`.*

1. **D1 blocks the merge.** CI branch coverage is 78.21% against an 80%
   threshold. It is proven unrelated to Slice 2, and it still has to be decided
   before this branch can land.
2. **D6 is a live third-party disclosure.** Two credential-redaction bypasses
   forward zero-width-obfuscated secrets verbatim to an external model provider.
   They are pre-existing and out of Slice 2's scope, but they are not a
   cosmetic debt and should not travel further unfixed.
3. **There is no trustworthy full-E2E regression net (D4).** Eighteen specs pass
   in isolation; a suite that is 84-red cannot tell anyone whether something
   else broke. Slice 3 touching publish paths without that net is a materially
   worse bet than Slice 2 was.
4. **Section 2.6's two unmet DoD items are product-visible.** A reviewer cannot
   reject from the review surface and cannot record why. Both were refused on
   principle rather than skipped, and the Owner should confirm that the
   principle is worth the two gaps.
5. **§4 group A is not a footnote.** A draft copied verbatim from a competitor
   passes this gate; a false statement about the outside world without research
   phrasing passes; a first-party link that is correctly attributed is blocked.
   Accepting this slice means accepting that the gate's `passed` is a narrow
   claim about internal consistency, not a quality verdict.

---

## 7. Slice 3 re-entry brief (non-normative)

This names a future target story and its acceptance questions only. It adds no
migration and no task. A `2026-XX-XX-authorized-publish-*.md` implementation
plan may be written only after a product owner accepts this stop gate.

```text
one reviewed Revision
+ one site-level permission model
+ one rollback-capable adapter (CMS / Git / tracking)
→ authorized publish
→ Publish / Change Receipt with idempotency
→ page-level before-and-after
→ direct / assisted conversion attribution
```

**Slice 3 begins at authorized publish. Its entry threshold is: Slice 2 parity
accepted, AND a rollback-capable Canary approved.** Slice 2 stops at one reviewed
Artifact Revision with zero external write; nothing in this slice may be read as
partial delivery of publishing.

Three findings from Slice 2 that change what Slice 3 must verify:

1. **Frontmatter masking becomes a real bypass the moment content goes live.**
   Content inside frontmatter is scanned by **no rule**, and a single-word
   pseudo-key (`Summary:` / `Evidence:`) is treated as frontmatter and masked
   out. In Slice 2 this is harmless because masked content never leaves the
   product. **In Slice 3, `description` and `summary` are precisely the fields
   that do go live** — so an unsupported claim written as `Summary: …` reaches a
   public page having passed no check at all. **This must be re-assessed before
   the first publish, not after.**

2. **`passed` currently means "contains no unverifiable external reference".**
   That definition depends on `citableCount === 0` being true by construction. If
   Slice 3 introduces real retrieval, that premise disappears, and a large number
   of phrasings, thresholds and decision branches — including every
   `unevaluated` reason string a reviewer reads — stop being accurate. Plan to
   re-derive them, not to patch them.

3. **The three capability gaps in A5 become publication risks rather than
   review-queue noise.** With no duplication detection, no external fact
   checking and no brand-voice check, Slice 3 publishes text that has been
   checked for internal consistency only. Whatever gate stands in front of a
   real CMS write has to answer for those three, or the Canary has to be small
   enough that a bad page is cheap.

Acceptance questions to answer before Slice 3 implementation begins:

- What is the smallest rollback that returns a published page to its prior state,
  and is it provable without a second publish?
- Which single object carries publish authorization — the Revision, the Action,
  or a new site-membership row — and how is a second confirmation path avoided,
  given Slice 2 spent its largest design risk budget avoiding exactly that?
- With real retrieval available, what does a `passed` verdict claim, and who is
  accountable when a cited external source later changes?
- Does the queue unification deferred in §3 D-1 have to land before Publish adds
  a third surface to the same screen?
