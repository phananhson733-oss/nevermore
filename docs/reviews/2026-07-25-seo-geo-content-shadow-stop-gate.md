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
`authority/implementation-spec-v0.3/`; rule set `mvp.rules.0.2.1` (11 canonical
rules — this document said `0.2.0` until the fix round in §8; `registry.ts` has
always said `0.2.1`). Machine surface after Slice 2: **49 API operations / 9 async operations
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
| 3 | **Done, narrowly.** `supportingFindingIds` is populated for the content cluster only, from a TopicCluster / PageAssignment read model over `keyword_entities.cluster_key` + `mapped_site_page_id`. No new table, no migration, no contract change, no parallel Candidate card. The `candidate` readiness branch is still never emitted. See §4 residual E5. | this commit |
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
| `pnpm test` (unit, no `DATABASE_URL`) | pass — 305 files, 3738 passed, 0 skipped |
| `pnpm test` **with** `DATABASE_URL` exported | pass — identical 305 / 3738 (§8 L11) |
| `pnpm db:migrate` | pass — 21 migration files applied |
| `pnpm db:smoke` | pass — fixtures rolled back |
| `pnpm db:migrate:check` | pass — 44 tables / 56 indexes / 69 triggers / 18 routines |
| `pnpm test:integration` | pass — 65 files, 473 tests |
| Content vertical E2E + the three sibling mock specs | pass — 19/19 (`content-shadow-vertical` 2, `content-shadow-review` 10, `content-shadow-execution` 6, `audit-technical-vertical` 1) |

All numbers above were re-run in full at the §9 follow-up round's commit; they
were unchanged from the §8 round that first produced them.

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
so this slice built neither of them.

*Correction (§9).* The previous version of this paragraph ended "so they were
not built", which was **false as written**: the Studio editor already carried
one control of exactly that kind — "Back to draft" on a `ready` artifact, whose
only possible outcome was `VERSION_CONFLICT` — one screen below the surface that
refused to build a second. That control has now been removed (`ac38918`; §8.2 M5,
resolved in §9), and the statement above is narrowed to what this slice did:
**no control of this kind was built here, and the one that pre-existed is gone.**

The blocker block's "Next:" sentence names the real path — revise the draft, or
send it back for more evidence, then check it again — instead of offering a
control that would look like a decision and record none. In the Studio editor
the same path is now stated in words where the removed button used to sit
(`studio.readyEditPath`): editing a `ready` deliverable appends a new revision
and the service returns it to `draft`, so `ready` is not a dead end.

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
(`_connected-sources.ts` and its test). `studio.module.css` was likewise
unchanged up to §12; **§13 changed it**, and `_studio.tsx` with it, to build the
type filter bar and unify the queue. Neither file belongs to a frozen module.
The N-1 check was re-run at the end of §13 over the same three directories and
is **still empty**.

**D-1. PARTLY RESOLVED in §13.** The specification's §4 type-filter bar and §5
queue unification are now built; the deeper merge of the content surface into
the same document panel is not.

*Built (§13).* `studio.module.css` has `.filterBar` / `.filterTabs` /
`.filterTab` / `.filterCount`, and the queue is **one list** ordered by type
instead of a stack of per-type `<section>`s. Type moved to the chip row above the
queue and to the badge already on each row. The right-hand count reads
`N deliverables · M awaiting your review`, both numbers derived from the queue
itself: `N` carries a `+` when a further cursor page exists, so it is a floor and
not a claim, and `M` counts `draft` — the only status
`MANUAL_STATUS_TRANSITIONS` lets an operator act on — so it counts work actually
waiting on a person. Chips are `role="tab"` over the workspace `role="tabpanel"`,
with roving tabindex and Arrow/Home/End. Colour is `var(--sf-accent)` throughout;
no GenGrowth hex was copied.

*Two deliberate narrowings of the reference behaviour*, both in
`applyTypeFilter`: a chip never discards unsaved editor state, and a chip click
with nothing open leaves nothing open rather than silently opening a deliverable
and starting reads the operator did not ask for.

*Still open.* The Content Shadow surface is **still rendered through the
`afterHero` slot above the workspace**, so Execution still shows two queues on
one page — the Content Shadow run rail and the unified artifact queue. Folding
the content body, meta strip and quality rail into the workspace's own document
panel is specification §6-§8 and was not in §13's scope. *Cost boundary:*
unchanged — visual and navigational only; no honesty claim and no data path
depends on it.

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
boundary lands immediately after a `key=`** (3 cases in 420 probes): step 6 cuts
inside the `[redacted]` marker step 3 wrote, `password=[redact` is still a
credential shape, and the next pass redacts the remains.

*Corrected in §8 (M3).* This entry previously said the overstated docstring "was
identified as overstated and corrected". It had been identified; the code still
said "for every input". The docstring now states the condition, a test pins the
counterexample, and the consequence this entry never named is now named at
`safePromptContentBriefOutline`: **for those items the frozen manifest holds the
extractor's bytes and the model sees the boundary's second pass, differing by
the tail of a `[redacted]` marker.** The divergence is accepted — the
alternative is not re-sanitizing at the only place that runs on every path —
and red line C is unaffected, because both passes are deterministic functions of
the same frozen bytes.

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

**D2. `pnpm audit` is STILL RED, but narrowed 2026-07-26 (`ce6f8d1`): 14 -> 4.**
It had drifted from 11 to 14 (5 moderate / 9 high) by the time it was worked.
Ten are closed: `next` 16.2.10 -> 16.2.11, a patch bump inside the pinned minor
that clears all nine next advisories, and a scoped `js-yaml@<4.3.0 -> 4.3.0`
override following the `postcss@<8.5.10` precedent already in `package.json`.
The full gate set was re-run after the bump — 81/81 e2e, 4001 unit, 484
integration, branches 84.90%, build and every verifier — because a framework
upgrade has to prove itself.

Four findings (two advisories) remain, and neither is a mechanical fix:

- **`brace-expansion`**, three paths, all under eslint / typescript-eslint. The
  advisory is `patched: >=5.0.8` with no backport — the newest v1 and v2 are
  1.1.16 and 2.1.2, both below the line — and two of the three paths run those
  majors. An override would push eslint's `minimatch` across four majors of a
  package whose API changed. Dev-only; it reaches no shipped bundle.
- **`sharp` 0.34.5**, patched at `>=0.35.0`. `next@16.2.11` declares
  `optionalDependencies.sharp: "^0.34.5"`, so an override contradicts the
  framework's own range. Actual exposure is nil: `next/image` occurs once in
  `apps/web/src`, as an exclusion string in the proxy matcher (`proxy.ts:104`),
  and no module imports the component, so the Image Optimization API this
  advisory concerns is never reached.

**Owner decision, unchanged in kind:** accept these two as recorded, wait for
upstream, or take the compatibility risk of forcing them.

**D3. RESOLVED 2026-07-26 — fixed and gated, not deleted.**
`authority/implementation-spec-v0.3/scripts/verify-spec.test.mjs` was a 935-line
file wired into no gate and 4-red since before Slice 2 (41 tables / 38 operations
/ 6 async, migration list stopping at 0019).

Fourteen of its 29 tests really were a parallel copy of authority text the lock
already freezes by sha256. The other fifteen were not: they mutate fixture
migration sets to prove `verify-spec.mjs` rejects drift, and that verifier runs
in CI — `verify:spec` hash-pins it via `REQUIRED_AUTHORITY_FILES` and then
executes it. Nothing else in the repo proves it is not a no-op, so deleting them
would have been a net loss of guarding. Kept.

All four reds were stale snapshots: 41→44 tables, 38→49 operations, 6→9 async;
smoke markers 51→56 indexes, 63→69 triggers, 16→18 routines, terminal migration
0019→0021; and the fixture's `completeMigrations` stopped at 0019. That last one
mattered: with 0020/0021 absent the verifier failed unconditionally, so the
`status != 0` half of all fourteen negative tests was passing vacuously and only
the stderr regex half still did work. Fixed, plus two new drift tests for
0020/0021. 29 → 31 tests, green.

Gated by a new `pnpm verify:spec:test` running in CI next to `pnpm verify:spec`.
It also adopts `scripts/verify-spec-lock.test.mjs` (1-red, 45/8 against a 49/9
lock — fixed) and `scripts/verify-implementation-source.test.mjs` (green but
equally ungated). 66 tests. `deploy:check` now asserts CI contains the step, and
its existing `verify:spec` assertion gained an end-of-line anchor — unanchored,
`verify:spec:test` alone satisfied it, so the real gate could have been dropped
without turning anything red. Both assertions mutation-verified.

**D3e. RESOLVED 2026-07-26. `collection.ts:583`'s bare 409**, recorded after the
S3 fix as "still weaker than csv-import was before its fix, and next to the
N-1-frozen Sources surface". Both halves of that were wrong. The N-1 freeze
covers `apps/web/src/app/p/[projectId]/sources`, a UI surface, not
`lib/services/collection.ts`. And the right comparison is not pre-fix csv-import
but the bare 409 csv-import deliberately KEPT (`csv-import.ts:612`): the same
"the winner is no longer observable" branch.

That branch genuinely has no runId. `async_runs_one_active_key_idx` only aborts
an insert when a run was active, `findActive` only sees `queued`/`running`, and
our own reservation rolled back with the transaction — so reaching here means the
winner left both states in between. Inventing a runId would be worse than
admitting we have none, so there is still no `Location`. What changed is the
body: it now returns `activeConflict`'s shape with both pointers EXPLICITLY null,
so a client reads `current.runId` down one code path instead of distinguishing
"key absent" from "value null", plus the contended `activeKey` — the one
locatable fact that survives. The detail stops claiming a run is active, because
none is.

**No contract tax.** `Problem.current` is `type: [object,'null']` with
`additionalProperties: true`, so none of the seven contract sites move. Covered
by a new integration test that reproduces the branch by mocking both
`IdempotencyRepository.find` and `AsyncRunsRepository.findActive` to null;
mutation-verified by reverting the implementation to the bare throw.

**S6. RESOLVED 2026-07-26 (`269ce39`).** The same gap was open in three
siblings: the primary `activeConflict()` in `audit-runs.ts`, `content-shadow.ts`
and `action-recheck.ts` sent a `Location` header with no body pointer, and their
no-winner branches re-used the detail "a run is already active" for the one case
in which no run is observable. All five services now answer the same shape, and
the three race branches say the request is safe to retry while carrying both
pointers explicitly null plus the contended `activeKey`. Six sites, six tests,
six separate mutations each reddening exactly one test. No contract tax:
`Problem.current` is `additionalProperties: true`, and counts stay 49/9/44/11.

One correction to the finding that raised this. It reported that a client code
path reads `current.runId`. It does not, in this repository: the only consumer
of `Problem.current` is `growth-map/_growth-map-view-model.ts:541`, which reads
`executionRef`/`actionId`/`artifactIds`, and `_studio.tsx:1629` records the
absence of a run id as a deliberate design and fences around it. S6 is therefore
contract consistency across five sibling endpoints rather than the repair of a
live client defect, and it does **not** close the 409-fence item — that fence
turns on artifact identity, not run identity. The frozen Growth Map surface is
unchanged in behaviour as well as in bytes: `executionRefFromProblemCurrent`
returns null for a `current` carrying no `actionId`, exactly as it did when
`current` was absent altogether.

**D4. RESOLVED 2026-07-26, third pass. The suite is 79 passed / 0 failed in 1.8
minutes.** It was 77 passed / 2 failed of 79 at `939129a`, 4 failed / 75 passed
of 79 at `54cab8d`, and 74 failed / 55 passed of 129 in 28.5 minutes at
`2f2bd78`. Zero new red at any step; each failure set is a strict subset of the
one before it.

Read the count honestly: the suite went from 129 tests to 79 partly because
`bb659e9` deleted cases asserting screens the product no longer has. That is
less claimed, not more fixed. What was fixed is the rest, one by one:

| was red | closed by |
|---|---|
| `frontend-error-states.mock.spec.ts:615` "Studio releases a 409 recovery fence when the canonical run has already settled" | `c4c92a3` — the fence now releases once the projection proves the run ended, which was the ruling §14.7 asked for |
| `growth-map.mock.spec.ts:124` "reviews only the canonical Opportunity and delivers one technical ticket" | the anchor moved to the studio artifact queue, where the deliverable now lives after Task 7 deleted the `Delivery chain` panel to an a11y spec. Both counts stay exact and one of them gets stronger; verified by three mutations (0 artifacts, 2 tickets, 1 ticket + 1 brief) — §4 D3c. **The earlier read that this belonged with D8 and needed a two-platform visual baseline was wrong**: this spec contains zero `toHaveScreenshot` calls |

**Still not covered**: `test:e2e:real`. D8 (`real-vertical-chains`, 24 snapshots)
needs a two-platform baseline and this machine produces darwin only.

The paragraph below is this entry as it stood before any of these rounds.

**D4 (original entry). The complete `pnpm test:e2e:mock` suite is broadly red**:
24 passed / 84 failed of 108, about 31.5 minutes. The root cause is that the mock config's
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

**D6. RESOLVED in §10 (`2f715d4`). Two live credential-redaction bypasses.**
- `finding-summary-client.ts:110` — measured to forward
  `Password<U+200B>=hunter2` verbatim to an external LLM.
- `product-profile-client.ts:390` — the same, with two entangled defects:
  `safeUrlText:411` leaks through `redactUrl`, and `hasUnsafeRawContent:712`
  uses `redactText(v) !== v` as a detector and inherits the same blind spot.
Text crossing these left the system boundary for a third-party model provider —
a real disclosure, not a duplicate of data we already hold — so they were fixed
rather than carried. The sibling defect in `envelope.ts`'s `safePromptText` had
been fixed in `05b1282` and `sanitizeOutlineItem`'s in `b327d7a`; all four
sanitizers now normalize `\p{Cc}`/`\p{Cf}` before redacting and share one
character class. **Two narrower residuals of the same family survive and are
named in §10.4** — closing them needs format characters DELETED rather than
replaced, which would corrupt scripts whose `\p{Cf}` characters carry meaning.
The three redaction sites that write only to storage we already own
(`logger.ts`, `telemetry.ts`, `run-export.ts`) share the weakness and remain
open debt; §10.4 states why they were ranked below the boundary-crossing pair.

**D7. RESOLVED in §8 (L11).** `product-profile-competitor-projection.test.ts`
sat in the unit project while being DB-backed, behind a hardcoded database name
from one machine: `pnpm test` went red the moment `DATABASE_URL` was exported,
and when it was not exported its five assertions ran in no gate at all. It is
now `*.integration.test.ts`, guarded by the shared `requireSafeTestDatabaseUrl`
rather than a machine-local name, and its five tests run inside
`pnpm test:integration`. `pnpm test` is now green both with and without
`DATABASE_URL` (§2.5).

**D8. `e2e/real-vertical-chains.spec.ts` — the real (database-backed) E2E suite
— is red at HEAD, and was already red before this slice began.** Measured in §9
at an unmodified tree: it fails on its fourth step,
`expect(page.getByRole("heading", { name: "New project" }))`, because the app's
`DEFAULT_LOCALE` is `zh-CN` (`packages/i18n/src/config.ts`) and this spec asserts
English chrome without setting `sf_ui_locale` — the same defect §4 D4 already
records for `studio-first-paint` and `studio-workspace`. It was introduced by
`3c2ecc6`, which flipped the default **and** edited this spec without giving it a
cookie; `3c2ecc6` is an ancestor of the Slice 2 baseline `945be02`, and the spec
file is untouched since. Given an `sf_ui_locale=en` context the run gets further
and then fails again on `[data-overview-hero]` not containing the project name as
exact text — the Slice 1 customer Overview rewrite; that assertion is stale too,
and the surface it reads is inside the `overview` freeze this slice is under. So
the suite needs **its own** task: a locale decision for the real harness, several
re-aimed assertions on a frozen surface, and a re-baselined set of visual
snapshots. **Nothing in §8 or §9 made this worse, and neither round claims this
suite green.**

**§13 update — both named causes are fixed and proven; the suite is still red,
for causes this entry did not know about.**

*Fixed and separately proven.* (1) `createProjectInBrowser` now sets
`sf_ui_locale=en`, the same cookie `growth-map.real.spec.ts` already sets.
Mutation check: deleting the cookie again fails the very next line
(`getByRole('heading', { name: 'New project' })`). (2) The
`[data-overview-hero]` assertion is re-aimed at `[data-overview-page] > header p`
with `toHaveCount(1)` plus `toContainText(projectName)` — an empty match, the
failure mode that hid here, is now itself an assertion. Mutation check: asserting
a project name that is not this project's fails and prints the real hero copy,
so the line genuinely reads the surface. **The Overview implementation was not
touched.** With both fixes the suite advances four steps, past everything this
entry named.

*Newly measured, not previously recorded.* It then fails at
`runDiagnosisAndConfirmFinding`, which drives `/p/{id}/diagnosis`. That route is
now `redirect(growthMapCompatibilityRoute(...))`, and the whole
`app/p/[projectId]/diagnosis/_*.tsx` component tree is **orphaned** — nothing
imports it. Three further things in this suite therefore have no successor
surface:

- the Diagnosis hero, the `Run diagnosis` button, the
  `getByRole("article", { name: "HTTP status errors" })` finding, and its
  `Last run / Completed` and `Unreviewed` states;
- the evidence-drawer keyboard contract — Enter opens
  `role="dialog"` *Trace the finding back to its source*, Escape closes it, focus
  returns to the exact trigger, `aria-expanded` flips. **Growth Map has no modal
  disclosure at all**; it uses native `<details>`/`<summary>`, which has neither
  Escape handling nor focus management. Re-aiming this assertion at Growth Map
  would be **strictly weaker**, so it was not re-aimed. This is the one place
  where "keep the strength" and "re-aim at the current surface" cannot both hold,
  and it is reported rather than quietly relaxed;
- `assertCanonicalVisualRegression` waits on
  `getByRole("region", { name: "Signal rail" })` for the Overview screen. That
  region belonged to the pre-Slice-1 `overview.*` message namespace; the customer
  Overview uses `overview.customer.*` and renders no such region.

*Also stale and not addressed.* All 24 baselines under
`real-vertical-chains.spec.ts-snapshots/` are dated 2026-07-22, before the Slice 1
Overview rewrite. They need re-baselining on **two** platforms; only `darwin`
can be produced on this machine, so re-baselining here would leave CI's `linux`
set stale and would be a green local run over a still-red CI gate — the exact
pattern §12 (D9) was opened to stop. **No snapshot was regenerated.**

**Conclusion: D8 stays open.** Its two named causes are closed; what remains is a
different, larger job — re-authoring a browser-driven audit-and-confirm walk
against Growth Map, deciding what to do with an a11y contract whose surface was
deleted, and a two-platform snapshot re-baseline. **This round does not claim
`real-vertical-chains` green.**

**D8 addendum, 2026-07-26 — the suite was finally RUN, and the reading above is
wrong about what blocks it.** Every prior entry on D8, this one included,
reasoned from the snapshot inventory without executing the spec. It was executed
on 2026-07-26 against a local disposable Postgres (`E2E_DATABASE_URL`, the
config's own `next dev` server):

```
✘ AC-044 B2B fixture … (25.7s)
  Error: expect(locator).toBeVisible() failed
  Locator: getByRole('heading', { name: 'Every finding should stand up to scrutiny.' })
  at runDiagnosisAndConfirmFinding (real-vertical-chains.spec.ts:447)
```

It fails at line 447, **before any `toHaveScreenshot` executes**. Everything
earlier in the chain — project creation, sources, the offline provider seam —
passes; 25.7 seconds of the walk is green. The spec then navigates to
`/p/{projectId}/diagnosis` (line 442) and asks for the diagnosis hero and its
`Run diagnosis` button, and **neither exists in the shipped product**. The
second test never ran, because the suite is serial.

That is **R1** (§14.8), verified here rather than inferred: `diagnosis/page.tsx`
is a bare `redirect(growthMapCompatibilityRoute(...))`, the `runDiagnosis`
message key has exactly one consumer in the repository — `_diagnosis.tsx:159`,
inside the client no file imports — and the `heroTitle` string lives in the same
orphaned namespace.

Three things follow, and they change the shape of the Owner's decision:

1. **D8 is not, today, a visual-baseline problem.** Both platforms' baselines
   are present (24 files, 12 `darwin` and 12 `linux`); the run never reaches
   them. The two-platform re-baseline is real but it is the *second* obstacle,
   not the first.
2. **D8 is blocked on R1, not on CI.** No re-aiming can fix it: the assertion
   is not pointed at a moved control, it is pointed at a capability the product
   no longer has. Re-aiming it anyway would be moving a surface to an
   assertion, which §14.9 exists to forbid, and would convert a true red into a
   false green.
3. **R1 is therefore not a tidy-up.** A CI job is red *because* that decision is
   open. Whichever way it goes — the trigger returns to a shipped destination,
   or the capability, its hooks and its specs are removed together — this suite
   cannot go green until it is made.

**No assertion was weakened and no snapshot was regenerated.** The disposable
database was dropped.

**D9. `pnpm restore:drill` was red on every run, and a green unit gate hid it.
Resolved in §12.** It is a CI gate (`.github/workflows/ci.yml`, the `database`
job's "Run PostgreSQL backup and restore recovery drill" step) that §2.5 does
not name. Run for the first time in §11 against a disposable database, it failed
before the dump was even taken. The cause was in the drill's own inventory
query, not in the database: the integrity probe `capability_runs.input-manifest-hash`
(`scripts/backup-restore-drill.mjs`) built `... jsonb_build_object('id', "id",
...) ... order by id::text`, and `app.capability_runs` has **no `id` column** —
its primary key is deliberately `async_run_id`
(`packages/db/migrations/0010_growth_audit_slice1.sql:6-7`). PostgreSQL rejected
it at planning time, so the drill failed on every run regardless of data.

**Proven pre-existing, not introduced by this slice.** Both sides are
byte-identical to the Slice 1 acceptance baseline: `git diff 945be02..HEAD --
scripts/backup-restore-drill.mjs` and `... -- packages/db/migrations/0010_*.sql`
are both empty, and the probe was added by `b46999e`, an ancestor of `945be02`.

Two further facts a reader needs. First, the drill's **unit** gate
(`pnpm restore:drill:test`, also a CI step, also never run by this slice) was
**green at 29/29** — it stubs the Postgres tools, so it could not see this. A
green unit gate over a red real gate is why this went unnoticed. Second, the
drill's `APP_TABLES` list had **33 entries against 44 live application tables**,
so 11 tables were never inventory-verified by a restore drill at all:
`competitor_entities`, `competitor_origin_occurrences`, `finding_targets`,
`keyword_entities`, `keyword_entity_sources`, `keyword_occurrences`,
`product_profile_invocation_attempts`, `product_profile_runs` (Slice 1), and
`flow_shadow_runs`, `flow_shadow_research_packs`, `flow_shadow_qa_gates`
(**Slice 2's own three** — this slice widened the gap by three even though it did
not cause the red).

**Now fixed, and the pattern behind it is fixed structurally.** §12 records the
round. The probe orders by the primary key the schema actually declares, and all
44 tables are inventoried with no exclusions. Behind that first failure was a
**second, independent** one that only a data-bearing source database shows and
that CI would therefore have hit every time: the drill replayed all 21
migrations over a restored copy that is already at head, and 0014 re-narrowed
`async_runs_kind_check` against the `content_shadow` rows 0020 admits. It is now
forward-only on the same rule the application's own migration runner documents.
And — the part that matters beyond either bug — the unit gate can now see schema
errors at all: it checks the SQL the drill *emits* against a catalog parsed from
the checked-in migration chain, so a probe naming a table or column PostgreSQL
does not have fails `pnpm restore:drill:test` **without a database**. Four
independent mutations prove it, including replaying this exact defect.
`pnpm restore:drill` exits 0 against a database holding integration-test data.

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
- **E5. Task 3 landed only its narrow half.** `supportingFindingIds` is no
  longer a hardcoded `[]`: an Opportunity whose primary target is a keyword
  cluster now lists the other active Findings of the same frozen run that are
  attached to a page the cluster's keywords are mapped to
  (`topic-cluster-projection.ts`, `TopicClusterReadRepository`). Decision F's
  other half is deliberately still not done, and an Owner should read it as a
  standing limit rather than an oversight:
  - **The `candidate` readiness branch is still never emitted.** An Observation
    without a measured Finding remains invisible in Opportunity Review. This is
    Slice 1 simplification #2 and it is unchanged.
  - **There is no TopicCluster or PageAssignment table** and none was justified:
    the cluster is the reviewed `cluster_key` label and the assignment is the
    operator's `mapped_site_page_id`, both already versioned by
    `mapping_revision`. A table would only be a second copy that can drift.
  - **Nothing new renders.** No parallel Candidate card exists; the Finding card
    stays the single confirmable object. The field is honest on the wire, and
    the customer-facing surfaces are untouched.
  - **The derivation is a projection, not a rule result**, and every Opportunity
    that carries it says so in `coverageAndLimitations`. Where the chain is
    missing, the Opportunity says which half is missing — an unmapped cluster
    and a mapped cluster whose pages carry no Finding produce *different*
    sentences, so an empty list never reads as "we checked and found none".
    An unconfirmed keyword-to-page mapping is disclosed rather than excluded.

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
| — | **final 45-agent cross-seam verification** | **22 confirmed**, each with a file:line and most reproduced by running the code |
| — | the fix round for those 22 (§8) | 20 fixed, 1 refused on an existing assertion, 1 out of scope; 19/19 mock specs pass |

**How Task 6 was closed out matters more than the defect counts.** The stopping
criterion was **not** "no defects found". It was that the *character of the worst
case* had changed: in each of the first three rounds there existed a path where a
**fabricated citation silently obtained `passed`**. In the fourth round, no row
of the escape table reached `passed` — every remaining escape is either `blocked`
or handed to a human as `unevaluated`. That is the property the gate exists to
have. Rounds 2 and 3 both found 16 issues; the count did not improve, and the
gate was closed anyway, on the change in kind rather than in number.

**The most stable defect source in this slice was "claiming more than is
actually done"** — at least four separate instances during the tasks, and the
final verification round found the same failure mode in six more places (§8:
H2, M1, M3, L1, L5, L7). It did not decay as the slice went on; it moved from
the code into the documents and the guards, where nothing was reading. Instances
from the tasks themselves:

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
2. **D6 was a live third-party disclosure. It is now fixed — §10, `2f715d4`.**
   Two credential-redaction bypasses forwarded zero-width-obfuscated secrets
   verbatim to an external model provider. They were pre-existing and outside
   Slice 2's original scope, and they were not cosmetic debt, so they were not
   allowed to travel further unfixed. Two narrower residuals of the same family
   survive and are named in §10.4 rather than quietly closed.
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

---

## 8. Final cross-seam fix round (2026-07-26)

A 45-agent cross-seam verification over the finished slice confirmed **22**
defects, each with a file and line and most of them reproduced by running the
code rather than by reading it. This section records what was done with each,
and — the part that matters more — what was **found and not fixed**.

The round changed no operation, no async operation, no table and no rule:
**49 / 9 / 44 / 11** before and after. It added one migration-free repository
method, one service module, one shared E2E fixture module and one gate check.

### 8.1 What was fixed

| # | Defect | Fix, and how it was verified |
|---|---|---|
| **H1** | **`blocked` could be bypassed by the generic artifact status PATCH.** The `/review` endpoint refused a `blocked` verdict; `PATCH /artifacts/{id}` performed the identical `draft -> ready` write and never asked. Execution renders the Studio editor directly below the quality rail, so an operator who could not pass review could scroll down and mark the same draft reviewed while the rail still read "references that cannot be verified". | One module (`content-shadow-adoption.ts`) owns the predicate, the reason text and the problem code; both doors import it. An integration test asserts the two refusals are the **same** code, status, message and machine reason, differing only in the field they point at — a comparison, because the failure mode is the two drifting apart. Mutation-checked: removing the new guard turns it red. |
| **H2** | Spec §10.2 stated a property the code does not have (partial brief-outline loss leaves the verdict `unevaluated`). After the O-6 correction, coverage is judged against `targetKeywords`, so a draft covering them reads `passed` with 17 of 19 sections dropped — and `unevaluated` is a claim status no verdict can take. | The paragraph now describes a measured run, including which cap overrun reaches the claim detail and which only reaches the pack limitation. Two other statements in the same paragraph were re-derived at the same time. |
| **H3** | The brief↔draft comparison had **no keyboard path at all**: a `tablist` with roving `tabIndex` and no `onKeyDown`, so the unselected tab was in neither the Tab sequence nor any arrow handler. | Arrow/Home/End with focus following selection, same shape as the Evidence drawer's tablist. New E2E test, mutation-checked. |
| **M1** | The authority narrative said **47 operations in four places** while the lock, both verifiers and the marker registry all said 49 — since the commit that moved the lock to 48 and left the text alone. Nothing read the prose, so the project's own freezing criterion was literally false through a green gate. | Four corrections, plus a `verify:spec` check that reads the counts out of the authority's sentences and compares them to the lock — and fails if it finds nothing to compare. Verified by reintroducing the historical drift: the gate names the file and the sentence. |
| **M2** | `sanitizeOutlineItem` still cut by UTF-16 code unit, the same defect already fixed in `truncateExcerpt` and `boundedDetail`. Its output goes into `flow_shadow_runs.frozen_input_manifest` (`jsonb`), which rejects the orphaned surrogate. | Fixed behind one primitive in `@sf/artifacts`, applied at all five truncations there, and at the crawl projection bounds in `@sf/sources` (web-sourced strings landing in `observations.value_json`). Vendor manifest hashes and adaptation notes updated for the two vendored crawl files. |
| **M3** | The docstring still claimed idempotence "for every input" while this document recorded the claim as corrected. | See §4 C4. The condition is stated, a test pins the counterexample, and the consequence — frozen bytes versus prompt bytes — is now named where it happens. |
| **M4** | The blocker block listed blocking claims by label, and the labels are mixed in polarity: `sc9b` reads "Listed sources match the frozen records", so a sentence that reads like a pass appeared under "Cannot pass review yet". | Every row carries its state word, in the rail's own vocabulary, structurally rather than by rewording one label. E2E asserts the exact composed string. |
| **M6** | `.qaCountsStale` dimmed three 12px labels to **2.70:1** — under WCAG AA and under the 3:1 floor §13.2 sets for this project's own dimmed controls. | Staleness is a dashed amber surface instead. Measured after: 5.52:1 light / 6.26:1 dark for the labels, 16.6:1 / 14.9:1 for the digits. |
| **L1** | The purity guard's re-export check matched one export syntax. Four others and `export *` walked past it while the gate printed that every scanned file was clean. | The identifier may not appear at all outside its owner and the tests, and `export *` chains are resolved and followed transitively. All five shapes verified to fail the gate; the printed summary now describes exactly what is checked, including its single self-exemption. |
| **L2** | Red line D's sibling-repo grep covered three directories where the blueprint asked for the repository. | Widened to `packages`, `apps/web`, `apps/worker`, `e2e`, `scripts` (801 → 857 files). Verified by planting a reference in an `e2e/` fixture. |
| **L3** | `FLOW_SHADOW_QA_GATE_REPLAY_CONFLICT` — defined so a reproducibility divergence is identifiable — was recorded as `UNAVAILABLE`, the same code a dead database gets, with the field naming which half diverged dropped. | Both preserved. Integration test, mutation-checked. |
| **L4** | Side by side labelled the **frozen** draft body with the deliverable's **live** revision, so after any edit a reviewer read revision N under the heading "revision N+1". | The pane names the revision its bytes are, and says which revision is live when they differ. E2E asserts both. |
| **L5** | The review spec's default fixture paired `verdict: passed` with a `failed` coverage claim — a state `clampVerdictToFailedClaims` makes unreachable. The one-click pass path, the receipt and the comparison panel were only ever proven against it. | Claim sets moved to one module; the verdict is **computed** from the claims. Each spec now exercises a distinct reachable state (`passed` / `needs_review` / `blocked`). Every previously-green assertion still passes. |
| **L6** | `sc9_sources_section` was written `review` in two fixtures while the gate's table says `advisory` — inside the specs that exist to prove wire severity is derived. | Corrected, and a vitest guard (`e2e/content-shadow-claims.vitest.ts`, collected by the unit project) compares **every** fixture claim's severity and kind against `qaSeverityForClaimId` / `qaRuleKind`, and the verdict mirror against `evaluateQaRules` + `clampVerdictToFailedClaims` themselves. |
| **L7** | The DoD's "→ one Action" segment asserted a fixture constant against itself and repeated a write count asserted twenty lines earlier. A `reviewProjectFinding` creating two Actions for one Finding would not have turned it red. | The recorder parses the Actions out of the confirmation **response body**, reading both the singular and plural wire shapes; the spec asserts the Action's identity and carries that identity into the brief segment. |
| **L8** | `.overlayScrim` hardcoded `rgb(10 25 21 / 56%)` — a green ink from the GenGrowth reference palette, which ruling γ and N-1 both forbid — making this document's "colour comes from `var(--sf-*)` only" false. | `color-mix(in srgb, var(--sf-ink-950) 56%, transparent)`. |
| **L9** | `--sf-shadow-lg` does not exist, so the review dialog and the version drawer silently fell back to the flat card shadow. | `--sf-shadow-md`, the token the app's other overlays use. |
| **L10** | The compare checklist heading skipped h3 → h5. | h4. |
| **L11** | See §4 D7. |

Two more were folded in while their files were open: the vendor manifest gained
an honest adaptation note for the crawl code-point change, and this document's
own rule-set version (`0.2.0`) was corrected to the `0.2.1` the registry has
always carried.

### 8.2 Found and **not** fixed — read this part

**M5. RESOLVED in §9.** *(Original entry kept verbatim below; the reason it was
held is part of the record.)* **The Studio editor offers a button that can only
fail.** On a `ready`
artifact the editor renders "Back to draft", which calls the status PATCH with
`draft`. `MANUAL_STATUS_TRANSITIONS.ready` is `["archived"]`, so the request can
only ever return `VERSION_CONFLICT`. This is the simulated-control pattern §2.6
says was refused on principle — and §2.6 states that "shipping two buttons that
write nothing … so they were not built", which is **false as written**: one such
button already exists, one screen below the surface that refused to build it.

*Why it was not fixed.* `e2e/real-vertical-chains.spec.ts:540-542` asserts that
button is visible after marking an artifact ready, and the instruction for this
round was to stop and report rather than weaken an existing assertion. Removing
the control turns that assertion red. **The fix is one edit plus re-aiming that
assertion at the `Ready` status pill, and it needs an owner's go-ahead because
it touches the real-vertical E2E.**

*What the ruling was, and what §9 found while carrying it out.* The Owner ruled:
remove the button, re-aim the assertion at the `Ready` status pill, keep its
strength, and say in the test why the anchor moved. That was done. While doing
it, §9 also established that `real-vertical-chains.spec.ts` **does not currently
reach line 540 at all** — it is red at its fourth line for a pre-existing reason
(§4 D8), so "removing the control turns that assertion red" was true of the
assertion as written and untrue of any run this repository can perform today.
The re-aimed assertion was therefore mutation-verified on an equivalent harness
instead; see §9.

**N-1. RESOLVED in §11.** *(Original entry kept verbatim below.)* **The Studio
"Mark ready" control does not know a draft is blocked.** H1
closed the write path: the server now refuses. The control itself is not
blocked-aware, because the artifacts list carries no gate verdict, so an
operator learns the refusal **after** clicking rather than from a disabled
control with a reason beside it — the opposite of the pattern Task 8 used on the
review surface. Closing this needs a verdict on the artifact wire shape, which
is a contract change and therefore its own task.

*Outcome.* The contract change was made: `Artifact.adoption` carries the
server's own judgement, produced by the same module both write paths consult, so
the control refuses before it is used instead of after. No operation was added —
still 49 / 9 / 44 / 11. See §11.

**N-2. RESOLVED in §9.** *(Original entry kept verbatim.)* **`.blocker` is
painted coral.** The Task 7/8 ruling says a `blocked`
verdict must "never use red or failure wording". The verdict *pill* honours that
(`verdictTone` returns `warning`), but the blocker block itself uses
`--sf-coral-text` / `--sf-coral-soft`, which is the product's red family. It was
left alone deliberately: changing it is a visual decision with E2E colour
assertions nearby, and it deserves a ruling rather than a drive-by edit.

*Ruling and outcome.* Layered: the block's **surface, border and title** are the
verdict and are now amber; the **state word beside one failed claim inside it**
is item level and keeps the status matrix's coral. Both halves are asserted and
measured — see §9.

**N-3. Branch coverage was not re-measured.** §4 D1 records 78.21% against an
80% threshold, proven unrelated to Slice 2. This round added tests and moved one
DB-backed file out of the unit project; the effect on that number is unknown and
is **not** claimed to be an improvement.

**N-4. The full `pnpm test:e2e:mock` suite is still not a trustworthy baseline.**
§4 D4 is unchanged. The four content/audit specs pass 19/19 in isolation and
nothing beyond that is claimed.

### 8.3 What did not change

Constraint **N-1** held: `git diff --stat 945be02..HEAD` over `overview`,
`growth-map` and `sources` is still **empty**, and this round touched none of
them (`git diff --stat bfd7523..HEAD` over the same three paths is empty too).
No existing assertion was weakened. Two previously-green tests in
`scripts/verify-spec-lock.test.mjs` — a file that was already 1-red at `bfd7523`
and is wired into no gate — went red against the new prose check because their
fixture authority is a one-line stub; the fixture now states its own counts,
derived from the fixture lock, and the file is back to exactly its pre-existing
single failure.

---

## 9. Ruling follow-up round (2026-07-26)

§8.2 stopped on two items rather than deciding them alone. The Owner ruled on
both. This section records what the rulings were, how they were carried out, and
what carrying them out uncovered.

The round changed no operation, no async operation, no table and no rule:
**49 / 9 / 44 / 11** before and after. No migration, no contract change.

Code commit: `ac38918`.

### 9.1 M5 — the control that could only fail was removed

*Ruling.* Remove the button. Re-aim `e2e/real-vertical-chains.spec.ts:540-542`
at the `Ready` status pill. Do not weaken the assertion, say in the test why the
anchor moved, mutation-check the result, and make sure `ready` is not left as a
state with no forward path.

*What was done.*

- `apps/web/src/app/p/[projectId]/studio/_studio.tsx` no longer renders "Back to
  draft". The `ready` branch renders no status control at all, and the comment in
  its place states the reason with the file that decides it
  (`MANUAL_STATUS_TRANSITIONS.ready === ["archived"]`).
- `ready` is **not** a dead end and the screen now says so. Where the button
  stood, the editor states the real path: edit the content above and save a
  revision — `artifact-update.ts` marks that write `status: "draft"`
  unconditionally ("editing always returns to draft"). New message key
  `studio.readyEditPath` in both locales; `studio.backToDraft` deleted from both.
  Locale key parity is enforced by `packages/i18n/src/__tests__/parity.test.ts`.
- The E2E assertion now reads `[data-studio-editor]`'s own `Ready` pill. Strength
  is unchanged: `getByText(..., { exact: true })` under Playwright strict mode
  must resolve **exactly one** element and it must be visible, which is precisely
  what the previous `getByRole("button", ...)` required. Two assertions were
  **added**, not removed: the withdrawn control must have count 0 anywhere on the
  page, and the stated path back must be visible.

*Mutation self-verification.* `real-vertical-chains.spec.ts` cannot execute today
(§4 D8), so the re-aimed trio was copied verbatim into a throwaway spec driven by
the same mock API that the committed Studio specs use, and run three ways:

| Condition | Result |
|---|---|
| artifact `ready` (the change took) | **passes** |
| artifact stays `draft` — "mark ready" failed / status did not move | **fails**: `locator('[data-studio-editor]').getByText('Ready', { exact: true })` — *element(s) not found* |
| the removed control re-added to the component | **fails**: `getByRole('button', { name: 'Back to draft' })` — *Expected: 0, Received: 1* |

The probe spec was deleted after measuring; it is not in the commit. The first
row is the guarantee the original assertion carried, the second is proof it still
discriminates, the third is proof the removal is now guarded rather than assumed.

### 9.2 N-2 — the blocker block is amber; the failed claim inside it is still coral

*Ruling.* Layered. The block's surface, border and title carry the **verdict**,
so they take the amber the verdict pill already takes. The state word beside a
single failed claim inside the list is **item level** — `claim failed` is coral
everywhere else in the rail — and keeps its colour.

*What was done.* `.blocker` moved from `--sf-coral-*` to `--sf-amber-*`, using
the exact shape `.briefLinkBroken` and `.staleBanner` already use for a held-back
state (`color-mix(in srgb, var(--sf-amber) 32%, var(--sf-border))`). No hex was
introduced; every value is a `var(--sf-*)` token or a `color-mix` of tokens
(ruling γ). `.blockerItemState` now takes the same per-status tone class
`QaClaimRow` uses, so a `failed` word is coral, `unevaluated` amber, `passed`
mint — stated structurally rather than by hard-coding one state.

*Contrast, measured in the browser* on the painted surface (`--sf-amber-soft`),
both themes, via `getComputedStyle` with the `opacity` composited in:

| Element | Size | Light | Dark |
|---|---|---|---|
| title (`.blocker strong`) | 15px | **6.14:1** | **9.28:1** |
| body / list rows (`.blocker p`, `li`) | 12px | **6.14:1** | **9.28:1** |
| `.blockerNote` (at its 0.92 opacity) | 12px | **5.15:1** | **8.07:1** |
| failed state word (coral, item level) | 12px | **5.89:1** | **7.74:1** |

Every value clears WCAG AA 4.5:1, the 12px labels included, in light and dark.
The 0.92 opacity was kept rather than replaced (unlike M6's `.qaCountsStale`,
which measured 2.70:1) because measurement says it passes.

*Test.* `e2e/content-shadow-execution.mock.spec.ts`'s "a blocked verdict reads as
a held-back citation, never as a failure" now also asserts the colour, not just
the wording: the block's `backgroundColor`, `color` and border **equal** the
amber family and therefore cannot be the coral family, and every `failed` state
word inside it **equals** `--sf-coral-text`. Tokens are resolved through a probe
element so both sides are compared as the same `rgb()` bytes — comparing a
computed `rgb()` against a raw `#rrggbb` token can only ever be "not equal",
which would let a colour assertion pass without checking anything. The comparison
itself is guarded: the amber and coral values are asserted to differ first.

*Mutation-checked.* Restoring `.blocker` to coral turns that test red:
`Expected: "rgb(255, 241, 216)"` / `Received: "rgb(255, 240, 236)"`.

### 9.3 The stop gate was corrected where this round made it false

- **§2.6(a)** said "shipping two buttons that write nothing … so they were not
  built". §8.2 M5 had already recorded that as false. It now states the fact:
  this slice built no such control, and the one that pre-existed has been removed.
  It also names the replacement wording that keeps `ready` from reading as a dead
  end.
- **§8.2 M5 and N-2** are marked `RESOLVED in §9`, with their original entries
  kept verbatim — the reason each was held is part of the record.
- **§2.5**'s provenance line now says the gate numbers were re-run at this round's
  commit, because they were.
- **§4 D8** is new: the real E2E suite is red at HEAD for reasons that predate the
  slice. It was found by running the suite before touching anything.

Re-read of the neighbouring claims: §3's UX deviation list, §2.6(b), §8.3 and
§4 D1–D7 are unaffected by this round and were left alone.

### 9.4 Gates

Every gate below was run at this round's tree, in this worktree, on this machine.

| Gate | Result |
|---|---|
| `pnpm verify:spec` | pass — 49 operations, 9 async, 44 tables, 11 rules; prose counts match the lock |
| `pnpm verify:authority` | pass — same four counts |
| `pnpm implementation:check` | pass — 49 operations, 9 async envelopes, 44 tables, 11 rules |
| `pnpm openapi:lint` | pass |
| `pnpm contracts:check` | pass — no diff |
| `pnpm lint` | pass (10 workspace projects + `e2e`) |
| `pnpm typecheck` | pass (10 workspace projects + `e2e`) |
| `pnpm build` | pass |
| `git diff --check` | clean |
| `pnpm test` (unit, no `DATABASE_URL`) | pass — 305 files, 3738 tests |
| `pnpm test` **with** `DATABASE_URL` exported | pass — identical 305 / 3738 |
| `pnpm db:migrate` | pass — 21 migration files |
| `pnpm db:smoke` | pass — fixtures rolled back |
| `pnpm db:migrate:check` | pass — 44 tables / 56 indexes / 69 triggers / 18 routines |
| `pnpm test:integration` | pass — 65 files, 473 tests |
| `content-shadow-vertical` / `-review` / `-execution` / `audit-technical-vertical` | pass — 19/19 |
| `real-vertical-chains` | **fail — and it failed identically before this round's first edit.** §4 D8 |

`real-vertical-chains` was run first, at an unmodified tree, precisely so that
its failure could be attributed. It fails at `createProjectInBrowser`, four steps
before the assertion this round re-aimed.

### 9.5 What did not change

Constraint **N-1** held. `git diff --stat 945be02..HEAD` over
`apps/web/src/app/p/[projectId]/overview`, `.../growth-map` and `.../sources` is
still **empty**, and this round touched none of the three. `studio.module.css`
and `execution.module.css`'s non-`.blocker` rules are untouched apart from the
two colour lines and their comments.

No existing assertion was weakened. Exactly one assertion changed anchor — the
one the Owner authorised — and it gained two neighbours rather than losing
strength. Every other test that was green stayed green.

### 9.6 Still open after this round

- **§8.2 N-1** (Studio "Mark ready" is not blocked-aware) — unchanged; closing it
  needs a contract change and is its own task.
- **§8.2 N-3** (branch coverage not re-measured) — unchanged. This round added
  E2E assertions only; the number is still not claimed.
- **§8.2 N-4** / **§4 D4** (no trustworthy full `test:e2e:mock` baseline) —
  unchanged.
- **§4 D8** (the real E2E suite is red) — recorded here for the first time, not
  fixed, and out of this round's scope in two directions at once: it needs a
  locale decision for the real harness and edits to assertions that read the
  frozen `overview` surface.
- §4 D1, D2, D3, D5, D6 — untouched pre-existing debt.

---

## 10. Credential-redaction fix round (2026-07-26)

One commit, `2f715d4`, closing **§4 D6** — the last live security defect this
slice registered. No migration, no operation, no contract shape change; the
machine surface is still **49 / 9 / 44 / 11**.

### 10.1 What was fixed

Both remaining LLM clients ran `redactText` BEFORE normalizing `\p{Cc}`/`\p{Cf}`
and never took a second pass. `redactText`'s labelled-assignment patterns
require `\s*` between a key and its `=`/`:`, and U+200B / U+00AD / U+200D /
U+2060 are not `\s`, so `Password<U+200B>=hunter2` walked through both and
`hunter2` reached the outgoing request body of an EXTERNAL model provider
verbatim.

| Defect | Site | Fix |
|---|---|---|
| S1 | `finding-summary-client.ts:110` `safeDataText` | normalize + collapse FIRST, then `redactText`, then escape `&`/`<`/`>`, re-collapse, truncate by code point |
| S2 | `product-profile-client.ts:390` `safeDataText` | same order; `stripUnsafeTextControls` deleted and replaced by the shared `NON_TEXT_CHARACTER` |
| S2a | `product-profile-client.ts:411` `safeUrlText` | the same normalization now runs BEFORE `redactUrl`, not only inside `safeDataText` after it |
| S2b | `product-profile-client.ts:712` `hasUnsafeRawContent` | the redaction detector now reads BOTH the raw string and its normalized form |

`stripUnsafeTextControls` was wrong twice over: it ran after the redactor, and
its hand-written ranges were NARROWER than `\p{Cc}\p{Cf}` — U+200B / U+00AD /
U+200D / U+2060 were in none of them — so the client also forwarded the
invisible characters themselves. `NON_TEXT_CHARACTER` (exported from
`brief/outline.ts` since `05b1282`) is a strict superset of those ranges,
verified code point by code point. All four sanitizers in the package now read
ONE character class instead of four.

The escape step stays AFTER redaction in both clients. Escaping first would let
`&lt;/UNTRUSTED_…&gt;` be absorbed into a credential value's `[^\s,;]+` match and
carry the escape off into `[redacted]`.

### 10.2 The detector semantics, and why the union

`hasUnsafeRawContent` used `redactText(v) !== v` as its evidence that a model
response carried something unsafe. That inherited the prompt sanitizer's blind
spot exactly: a payload that could walk past the redactor walked past the
RESPONSE gate too, so a model persuaded to echo `Password<U+200B>=hunter2` had
it stored rather than rejected.

It now asks the question of **both readings** — the raw string AND its
control/format-normalized form — and rejects if **either** would be redacted.
The union was chosen over replacing the raw reading with the normalized one, and
the reason is measurable rather than stylistic: normalization collapses
whitespace, which can bring a string back under `redactText`'s 4096-BYTE gate,
so a normalized-ONLY detector would have started ACCEPTING a class of response
it used to reject. A safety gate must not get more permissive as a side effect
of a security fix.

The control-character clause deliberately keeps its narrower
`isUnsafeTextControl` ranges. Widening it to all of `\p{Cc}\p{Cf}` would reject
legitimate model output: U+200C/U+200D carry meaning in Persian, Arabic and
Indic scripts and in emoji ZWJ sequences, and `\n` is `\p{Cc}`.

### 10.3 Well-formed inputs keep their bytes — measured, not asserted

Normalization is a no-op on text whose only `\p{Cc}`/`\p{Cf}` characters are
ordinary whitespace, so this is a SANITIZER defect fix and not a prompt-template
change. Neither `PROMPT_SET_VERSION` (pinned by the `diagnostic_runs` CHECK at
`packages/db/migrations/0001_init.sql:436`) nor
`PRODUCT_PROFILE_PROMPT_SET_VERSION` moves.

Each client's suite now pins the sha256 of its outgoing **user message** for
well-formed fixtures — 26 for `finding_summary`, 30 for
`product_profile_synthesis` — captured from the implementation BEFORE the change
and hardcoded rather than derived, so the assertion cannot re-learn whatever the
builder started emitting. All 56 pass unchanged. A separate 60-fixture probe
across both clients (27 well-formed payload shapes: CJK, RTL, Thai, emoji,
astral-plane, markdown, JSON, URLs with query strings, tab/CR/LF mixtures,
multi-page inputs) found **58/60 byte-identical**.

**The 2 that moved are one class, and it is named rather than hidden.**
`redactText` answers the sentinel `[truncated]` for any string above 4096 UTF-8
BYTES. A field whose RAW bytes exceed that gate while its whitespace-collapsed
form does not used to reach the model as the literal `[truncated]` and now
reaches it as real content. The direction is strictly better — the model sees
the operator's or the crawl's actual text instead of a sentinel — but the bytes
do change, so both suites carry a test that says so by name instead of a pin
that would have hidden it. This is the same class `05b1282` reported for
`safePromptText`.

One more property is recorded rather than discovered: both sanitizers escape
`&` to `&amp;`, so neither is idempotent on text containing `&`, `<` or `>`.
That is OLDER than this fix and is left exactly as it was, because changing it
would change the bytes of every well-formed prompt containing an ampersand. The
idempotence property tests are scoped to markup-free text and a second test pins
the entity behaviour.

### 10.4 Every `redactText` / `redactUrl` / `redact` call site, re-counted

The §8-era inventory was re-derived from scratch (excluding `node_modules` and
the untracked `.next-*` build outputs) rather than trusted:

| Site | Verdict |
|---|---|
| `packages/artifacts/src/brief/outline.ts:198` | fixed earlier (`b327d7a`) |
| `packages/artifacts/src/llm/envelope.ts:193` | fixed earlier (`05b1282`) |
| `packages/artifacts/src/llm/finding-summary-client.ts:111` | **fixed here** |
| `packages/artifacts/src/llm/product-profile-client.ts:391` | **fixed here** |
| `packages/artifacts/src/llm/product-profile-client.ts:411` (`redactUrl`) | **fixed here** |
| `packages/artifacts/src/llm/product-profile-client.ts:712` (detector) | **fixed here** |
| `packages/observability/src/logger.ts:49`, `:110` | to our own process log |
| `packages/db/src/repositories/telemetry.ts:174` | to our own database |
| `apps/worker/src/export/run-export.ts:811` | to an export bundle we store |

There is no third prompt-boundary site. The last three share the same weakness
and are **not** fixed here, for one stated reason: they write to storage we
already own, so an obfuscated credential that reaches them is a duplicate of
data the operator already gave us, not a disclosure across the system boundary.
That is a priority argument, not an absolution — they remain open debt.

**Two residuals of the same family survive and are named in the code**, both
because closing them requires DELETING format characters rather than replacing
them with a space, which would corrupt scripts whose `\p{Cf}` characters carry
meaning:

- an invisible character INSIDE a key (`Pass<U+200B>word=…`) still defeats a
  keyword-driven redactor — normalization turns the key into two words rather
  than restoring it;
- a query parameter that only `redactUrl` knows (`key`, and the
  `?state=`/`?code=` pair whose `redactText` rule has no `\s*`) is still missed
  when an invisible character sits before its `=`, because substituting a SPACE
  cannot restore the exact parameter name. The same is true of a
  percent-ENCODED invisible character, which nothing in this pipeline decodes.

Both are unchanged by this round, not introduced by it.

### 10.5 Gates

Written first as failing tests: 26 red in the finding-summary suite and 32 red
in the product-profile suite before the fix, all green after, with the
byte-identity pins green in BOTH states.

| Gate | Result |
|---|---|
| `pnpm verify:spec` | 49 / 9 / 44 / 11 |
| `pnpm verify:authority` | pass |
| `pnpm implementation:check` | pass — 30 files in the QA gate's import closure still pure |
| `pnpm openapi:lint` | valid |
| `pnpm contracts:check` | no diff |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm build` | pass |
| `git diff --check` | clean |
| `pnpm db:migrate` | 21 files |
| `pnpm db:smoke` | pass, rolled back |
| `pnpm db:migrate:check` | 44 tables / 56 indexes / 69 triggers / 18 routines |
| `pnpm test` (no `DATABASE_URL`) | 305 files, 3863 tests |
| `pnpm test` (with `DATABASE_URL`) | 305 files, 3863 tests |
| `pnpm test:integration` | 65 files, 473 tests |
| E2E `content-shadow-vertical` / `-review` / `-execution` / `audit-technical-vertical` | 19/19 |

`pnpm secrets:scan` was red at 5 findings at this round. **RESOLVED in §11**
(`dbeae89`): the five fixtures now assemble their credential-shaped strings at
runtime, and the gate exits 0.

**This paragraph originally read "was red at 5 findings before this round",
which invited the reading that it was pre-existing debt. It was not.** All five
findings are literal credential-shaped strings in the fixtures of
`outline.test.ts` and `envelope.test.ts`, and both files were written **by Slice
2 itself** — `cf6ac6f` (Task 4b) and `05b1282` (Task 6). The gate was green
before this slice began. "Red before this round" was true of the round; it was
never true of the slice. Recorded here because §2.5 does not name this gate at
all, and a reader should not have to discover a CI gate by tripping it (§11.4
re-derives the full CI step list so this cannot recur).

### 10.6 What did not change

Constraint **N-1** held: this round's diff touches four files, all under
`packages/artifacts/src/llm/`, and no path matching `overview`, `growth-map` or
`sources` at all.

No existing assertion was weakened. No existing test changed. Every gate that
was green stayed green, and the two gates that were red at this round
(`§4 D1` branch coverage, `pnpm secrets:scan`) were red by exactly the same
amount. `pnpm secrets:scan` was closed afterwards in §11 and was Slice 2's own
regression rather than inherited debt — see the correction in §10.5.

---

## 11. Blocked-aware adoption round (2026-07-26)

Two items closed here, and one CI gate discovered red. §8.2 N-1 (the Studio
"Mark ready" control did not know a draft was blocked) and the `pnpm
secrets:scan` failure recorded at §10.5. The round changed **no operation, no
async operation, no table and no rule**: 49 / 9 / 44 / 11 before and after.

### 11.1 What was fixed

**`pnpm secrets:scan` (`dbeae89`).** The gate exits 0. Five fixtures in
`outline.test.ts` and `envelope.test.ts` carried literal credential-shaped
strings and now assemble them at runtime, so the fixtures that exist to defend
the secret boundary stop failing it. The correction to §10.5's framing matters
more than the fix: this was **Slice 2's own regression** (`cf6ac6f`, `05b1282`),
not inherited debt.

**N-1 — the control refuses before it is used, not after.** H1 (`158be67`) had
already made the server correct: the generic artifact status PATCH refuses to
move a `blocked` `english_blog_draft` from `draft` to `ready`, using the same
module `/review` consults. What it did not do was tell the control. The
artifacts list carried no verdict, so the Studio editor rendered an enabled
"Mark ready" and an operator learned the refusal by being refused — the opposite
of the pattern Task 8 established one screen up.

The judgement is now **returned as well as thrown**. `content-shadow-adoption.ts`
gained `readContentShadowAdoption`, and `assertContentShadowAdoptionAllowed` was
rewritten to call it: the refusal and the read model are not two implementations
that agree today, they are one function used twice. The result reaches the wire
as `Artifact.adoption`.

Three properties of the shape, each chosen against a specific failure:

- **`adoption: null` is not `blocked: false`.** A `content_brief` is judged by no
  Content Shadow gate at all, and reporting "not blocked" for it would invite a
  reader to render a cleared-by-the-gate affordance for a deliverable no gate
  ever saw. The OpenAPI description says so, and so does the DTO comment.
- **`adoption` is a required positional parameter of `toArtifactDto`**, not an
  optional one. A future producer of this DTO cannot quietly answer "no gate
  applies" for a deliverable a gate has judged; it has to state an answer.
- **`blockingClaimIds` carries identifiers, not sentences,** and severity is
  resolved through `@sf/flow-shadow`'s own table (`qaSeverityForClaimId`). A
  literal list of "the blocking three" in the reader would be a copy of a
  backend invariant, and it drifts in the expensive direction: a blocking check
  believed advisory reads to an operator as safe to adopt. Unreadable claims
  yield **no** reasons rather than a guessed one — the verdict is a column and
  stays authoritative on its own.

**The reason is stated in place, in the Execution screen's own words.**
`AdoptionBlockedHint` renders `studio.qa.blocker.body` / `.next` and the same
`studio.qa.claimLabels.*` / `claimStatus.*` keys the Execution blocked block
renders — not a paraphrase, the same strings. So it reads "these references
cannot be checked against the frozen records", explicitly "this is not a run
failure", and each cause is named separately (a citation matching none of our
records, versus a listed source that does not resolve to the pack) with the
state word beside it, because a claim label names a **property** and the
properties are mixed in polarity. There is deliberately **no `title`** on the
disabled button for this reason: the sentence is a sibling element the control
points at with `aria-describedby`, and duplicating it into a hover would teach a
reader that hovering is where reasons live. It keeps `.readyHint`'s muted
colour and touches no danger token — the Task 7/8 ruling (§9.2) that a `blocked`
verdict is never painted red applies wherever the verdict is stated.

**No second rule was added to the client.** `markReadyBlock` in
`_artifact-editor-state.ts` chooses a *sentence*; it never decides whether a
draft is adoptable. It takes `adoptionBlocked` already decided. There is no
`"blocked"` literal, no verdict enum and no claim-id list anywhere in
`apps/web/src/app/`. The precedence is the pre-existing one —
`unsaved_edits` → `validation` → `adoption_blocked` — so every screen state
asserted before the read model carried a verdict still shows the sentence it
showed then.

### 11.2 The single source, proven by breaking it

Code review cannot show that two paths share an implementation; deleting the
implementation can. Every mutation below was applied to the tree, run, and
reverted.

| Mutation | Result |
|---|---|
| `readContentShadowAdoption` forced to never block | **2 red** in `content-shadow.integration.test.ts`: the *pre-existing* write-path test ("refuses a blocked draft identically through the generic artifact status PATCH") **and** the new read-model test, from one edit. This is the single-source proof — one function, both answers. |
| `markReadyBlock` drops its adoption branch | `_artifact-editor-state.test.ts` red ("expected null to be 'adoption_blocked'"); E2E "both doors into ready refuse…" red at `expect(markReady).toBeDisabled()` — *unexpected value "enabled"*. The companion test "both doors open on a draft the gate did not block" stayed **green**, which is what makes the pair meaningful. |
| `[data-studio-ready-blocked]` painted `--sf-coral-text` | E2E red at `expect(painted).not.toBe(coralText)`. The assertion resolves both tokens through the page and first asserts they differ, so "is not coral" cannot pass for free. |
| `aria-describedby` dropped for the adoption reason | E2E red at `expect(await markReady.getAttribute("aria-describedby")).toBe(await reason.getAttribute("id"))`. |
| the reason also duplicated into `title` | E2E red at `expect(await markReady.getAttribute("title")).toBeNull()`. |

Both new E2E tests assert **the two doors together** rather than each
separately: separate assertions stay green while the two answers drift apart,
which is the failure worth catching. The same shape is used in the integration
test, which compares the read model against both write paths in one expectation
chain rather than asserting three facts independently.

### 11.3 Contract tax

A field was added to an existing schema. No operation was added, and the four
counts did not move.

| Sync point | State |
|---|---|
| `openapi/mvp.yaml` | `ArtifactAdoption` schema added; `adoption` added to `Artifact.required` and `Artifact.properties` |
| `authority/implementation-spec-v0.3/openapi.yaml` | byte-identical — `cmp` clean |
| `packages/contracts/src/generated/openapi.ts` | regenerated; `pnpm contracts:check` reports no diff |
| `scripts/spec-v0.3-lock.json` | four sha256 refreshed: authority `openapi.yaml`, `MVP-IMPLEMENTATION-SPEC.md`, `openapi/mvp.yaml`, generated `openapi.ts` |
| `scripts/verify-implementation.mjs` | unchanged; re-run — 49 operations, 9 async, 44 tables, 11 rules, 30 QA-closure files still pure |
| `authority/…/scripts/verify-spec.mjs` | unchanged; re-run — same four counts |
| `MVP-IMPLEMENTATION-SPEC.md` §10 | **updated.** Its guard sentence named only the review endpoint (`所有守卫在此端重算…`), which is now less than the code does: it states that the `blocked` judgement is held by one module shared with the generic status PATCH, that `Artifact.adoption` carries it, that `null` is not "adoption is allowed", and that the field adds no operation |

`pnpm verify:spec` — **49 operations / 9 async / 44 tables / 11 rules**, prose
counts matching the lock, after the spec edit.

### 11.4 Every CI step, against every gate this slice ran

§10.5 recorded `pnpm secrets:scan` as a gate "§2.5 does not name" — discovered by
tripping it. That is a symptom: **the slice ran a hand-maintained gate list that
nobody had ever compared to `.github/workflows/ci.yml`.** The comparison is done
here, step by step. Infrastructure steps (checkout, Node/Corepack pinning, store
cache, `pnpm install --frozen-lockfile`, `playwright install`, `createdb`/`dropdb`,
artifact upload) are omitted.

| CI job | CI step | Ran by this slice before? | Result now |
|---|---|---|---|
| contracts-and-unit | `pnpm verify:spec` | yes (§2.5) | 49 / 9 / 44 / 11 |
| contracts-and-unit | `pnpm implementation:check` | yes (§2.5) | pass |
| contracts-and-unit | `pnpm restore:drill:test` | **no — never** | **pass, 29/29** (94.36% line / 88.53% branch, over its own 80% thresholds) |
| contracts-and-unit | `pnpm contracts:check` | yes (§2.5) | no diff |
| contracts-and-unit | `pnpm openapi:lint` | yes (§2.5) | valid |
| contracts-and-unit | `pnpm secrets:scan` | not until §10.5 | **pass, exit 0** (was 5 findings) |
| contracts-and-unit | `pnpm audit --audit-level moderate` | yes | **red — §4 D2**, narrowed 14 -> 4; the two left are upstream-blocked |
| contracts-and-unit | `pnpm deploy:check` | **no — never** | **pass** |
| contracts-and-unit | `pnpm lint` | yes (§2.5) | pass |
| contracts-and-unit | `pnpm typecheck` | yes (§2.5) | pass |
| contracts-and-unit | `vitest run --project unit --coverage` | tests yes, **threshold no** | **red — §4 D1**, 78.21% branch against 80%. §2.5 runs `pnpm test`, which has no `--coverage`; the *threshold* is a separate gate |
| database | `pnpm db:migrate` | yes (§2.5) | 21 files |
| database | `pnpm db:migrate` again (idempotency replay) | **no — never run as a gate** | **pass, 0 files applied** |
| database | `pnpm db:migrate:check` | yes (§2.5) | 44 tables / 56 indexes / 69 triggers / 18 routines |
| database | `pnpm db:smoke` | yes (§2.5) | pass, rolled back |
| database | `pnpm test:integration` | yes (§2.5) | 65 files, 475 tests |
| database | `pnpm restore:drill` | **no — never** | red when first run; **pass, exit 0** after §12. See §4 D9. |
| database | `pnpm test:e2e:real` | measured red in §9 | **red — §4 D8** |
| build-and-mock-e2e | `pnpm build` | yes (§2.5) | pass |
| build-and-mock-e2e | `docker build --file Dockerfile.worker` | **no — never** | **pass**, image built |
| build-and-mock-e2e | worker image entrypoint smoke | **no — never** | **pass** — nonzero exit and exactly `{"event":"worker_boot_failed","code":"WORKER_BOOT_FAILED","type":"internal"}`, no configuration leaked |
| build-and-mock-e2e | `pnpm test:e2e:mock` (full suite) | never green | **red — §4 D4**, unchanged |

**Five CI steps had never been run by any round of this slice.** Four were green
on first run. One was red: `pnpm restore:drill`, recorded in full as **§4 D9** —
a backup and restore recovery drill that failed before it took a dump, because
one integrity probe read a column `app.capability_runs` does not have. It was
proven pre-existing (both sides byte-identical to `945be02`), and its unit gate
was green because it stubs Postgres. **§12 fixed it; the drill now exits 0 and
its unit gate can see schema errors without a database.**

The reverse direction is smaller and worth stating: two scripts this repository
has are **not** CI steps — `pnpm verify:authority` (subsumed by `verify:spec`,
which spawns the same authority verifier at `verify-spec-lock.mjs:444` and
reports the same four counts) and `pnpm vendor:check`. Both were run here and
both pass.

**§11.4b. `vendor:check` cannot become a CI step, and AC-048 is therefore
enforced on one machine only.** This was swept for on 2026-07-26 rather than
assumed. `scripts/check-vendor-baseline.mjs` resolves the repository it guards
from `docs/vendor/old-repo-baseline.json`, whose `oldRepoPath` is the absolute
local path `/Users/wzb/Code/signalframe`. A GitHub runner has no such path.
Measured, not read: pointing the baseline at a non-existent directory makes the
script exit 1 with `Cannot read old repo at …`, so it is fail-closed and cannot
silently pass — but that also means adding it to `ci.yml` would turn CI
permanently red.

The consequence is worth stating plainly, because `CLAUDE.md` calls it a gate
(「`pnpm vendor:check` 门禁,AC-048」) and this document has listed it among
passing gates five times: **the red line "never modify the old SignalFrame
repo" has no enforcement outside this workstation.** A contributor on another
machine could modify that repository and no automated check anywhere would
notice. The honest classification is a local pre-flight, not a gate, and the
tables below now say so.

**The rest of the sweep came back clean**, which is the reason to trust the one
finding above. Every test-shaped file in the repository was enumerated and
matched against what each gate actually collects: **404 files, zero orphans** —
311 collected by `vitest --project unit`, 66 by `--project integration`, 23 by
the two Playwright configs (`testMatch: "**/*.mock.spec.ts"` and its exact
complement `testIgnore: ["**/*.mock.spec.ts"]`, which partition `e2e/` with no
gap), and 4 by the two `node --test` gates. Of the 28 package scripts, the five
others CI does not invoke are convenience wrappers or are subsumed
(`test` and `test:integration` by `test:coverage`, `test:e2e` by the two
configs CI runs separately, plus `test:watch` and `contracts:generate`). D3d
found three orphaned verifier suites because it was pointed at two; this sweep
confirms there is no fourth.

### 11.5 Gates

| Gate | Result |
|---|---|
| `pnpm secrets:scan` | **exit 0** |
| `pnpm verify:spec` | 49 / 9 / 44 / 11 |
| `pnpm verify:authority` | pass — same four counts |
| `pnpm implementation:check` | pass — 30 QA-closure files still pure |
| `pnpm openapi:lint` | valid |
| `pnpm contracts:check` | no diff |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm build` | pass |
| `git diff --check` | clean |
| `pnpm deploy:check` | pass |
| `pnpm vendor:check` | pass — **local pre-flight, not a CI step; see §11.4b** |
| `pnpm restore:drill:test` | pass — 29/29 |
| `docker build` + worker entrypoint smoke | pass |
| `pnpm db:migrate` | 21 files; replay applies 0 |
| `pnpm db:smoke` | pass, rolled back |
| `pnpm db:migrate:check` | 44 tables / 56 indexes / 69 triggers / 18 routines |
| `pnpm test` (no `DATABASE_URL`) | 305 files, **3872** tests (was 3863) |
| `pnpm test` (with `DATABASE_URL`) | 305 files, **3872** tests — identical |
| `pnpm test:integration` | 65 files, **475** tests (was 473) |
| E2E `content-shadow-vertical` / `-review` / `-execution` / `audit-technical-vertical` | **21/21** (was 19/19; the two new tests are the additions) |
| `pnpm restore:drill` | **RED — §4 D9**, never run before, pre-existing. **Fixed in §12: exit 0.** |
| `pnpm audit` | red — §4 D2, narrowed 14 -> 4 (`ce6f8d1`) |
| unit `--coverage` branch threshold | red — §4 D1, unchanged and **not re-measured** |

### 11.6 What did not change

Constraint **N-1** held. `git diff --stat 945be02..HEAD` restricted to
`apps/web/src/app/p/[projectId]/overview`, `…/growth-map` and `…/sources` is
**empty**, and so is this round's own diff over the same three paths. `studio` is
not in the freeze.

No existing assertion was weakened and no existing test was deleted or made
laxer. Four fixture files gained an `adoption` field because `toArtifactDto` now
requires one and `ArtifactDto` now carries one; every added value is `null` with
a comment stating why (no Content Shadow gate judges a `technical_ticket` or a
`content_brief`), and no assertion in those files moved. Zero migrations.

### 11.7 Still open after this round

- **§4 D9** — `pnpm restore:drill`, newly discovered red. **Closed in §12**, in
  its own round: it exits 0, and the green-unit-gate-over-red-real-gate pattern
  that hid it is fixed structurally.
- **§4 D1** branch coverage, **D2** `pnpm audit`, **D3** the stale parallel
  verifier test, **D4** the full mock E2E suite, **D8** `real-vertical-chains`,
  **D5** five undeclared 503s, **§10.4** the three remaining redaction-to-storage
  weaknesses — all unchanged.
- **§8.2 N-3** stands: branch coverage was not re-measured this round either.
  This round added 9 unit tests and 2 integration tests; the effect on 78.21% is
  unknown and no improvement is claimed.
- The Studio hint lists **every** blocking claim, while the Execution blocker
  block shows three and then "and N more". The wire field is capped at 25 ids.
  With the blocking set at exactly three (`rl8` / `rl12` / `sc9b`) the two
  surfaces cannot differ today; if the blocking set grows, the Studio hint gets
  longer where the Execution block truncates. Recorded, not fixed.

---

## 12. D9 fix round: the restore drill, and the gate that could not see it

The drill was red for **two** independent reasons. Only the first was known
when the round started; the second was behind it, and would have kept CI red.
Then there is the reason neither was caught, which is the part that outlives
both.

### 12.1 The probe read a column that does not exist

Every integrity probe now declares `key`, the table's real primary key, and the
generated statement selects and orders by it. `capability_runs` is keyed by
`async_run_id`; the nine other probed tables are keyed by `id`. The statement
the drill now sends for the probe that was broken:

```sql
copy (select jsonb_build_object('async_run_id', "async_run_id",
  'input_manifest_hash', "input_manifest_hash")::text
  from app."capability_runs" order by "async_run_id"::text) to stdout
```

**Every other probe was audited, not just the one that was hit.** All ten probes
were checked reference by reference against the schema: ten tables and 23 column
references, all present. So were the 45 statements the inventory itself sends —
one 44-table count query and one canonical checksum per table. The audit is not
a one-time reading: it is the gate described in §12.4, which re-runs on every
`pnpm restore:drill:test`.

### 12.2 The inventory counted 33 of 44 tables

`APP_TABLES` goes from 33 to **44** and now equals `db:migrate:check`'s table
set exactly. The eleven that were missing are all added; **none is excluded**,
so there is no exclusion to justify:

| Added | Migration | Why it was missing |
|---|---|---|
| `finding_targets` | 0017 | the list was last updated at 0010 |
| `product_profile_runs`, `product_profile_invocation_attempts` | 0011 / 0014 | same |
| `keyword_occurrences`, `keyword_entities`, `keyword_entity_sources` | 0018 | same |
| `competitor_entities`, `competitor_origin_occurrences` | 0019 | same |
| `flow_shadow_runs`, `flow_shadow_research_packs`, `flow_shadow_qa_gates` | 0020 | **Slice 2's own three** |

There was no curation to recover: the 33 entries were exactly the tables that
existed at migration 0010, and nothing added since had ever been appended. Two
integrity probes were added with them — `flow_shadow_runs.content_hash` and
`flow_shadow_research_packs.content_hash` — because every other content hash in
the schema is probed and Slice 2's should not be the exception.

One thing is genuinely out of scope and now says so in the code: `pgboss` owns
its own schema and is queue state, not tenant data. `pg_dump`/`pg_restore` still
carry it; its row counts are transient by construction and would make the
inventory comparison flap, so it is verified by restore succeeding rather than
by count.

The list is no longer maintained by hand. `pnpm restore:drill:test` asserts it
equals the table set parsed out of the migration chain, so a future migration
that adds a table and forgets the drill fails the unit gate.

### 12.3 The second red, which was hiding behind the first

With the probe fixed the drill got past the inventory, took its dump, restored
it — and failed again, this time only on a source database that holds rows:

```
psql:packages/db/migrations/0014_product_profile_synthesis.sql:15: ERROR:
check constraint "async_runs_kind_check" of relation "async_runs"
is violated by some row
```

The drill replayed **all 21 migrations** against the restored copy. A restored
dump is already at head, so 0014 re-narrowed `async_runs_kind_check` to its five
historical values against rows using `content_shadow`, the sixth value **0020**
admits. This is not a hypothesis about the code: `packages/db/src/migrate.ts`
documents this exact hazard in its own header and is forward-only *because* of
it — "Skipping is required for correctness, not only speed". The drill was doing
by hand what the application runner refuses to do.

**This matters for the gate as it is actually wired.** `.github/workflows/ci.yml`
runs `restore:drill` **after** `pnpm test:integration` on the same
`signalframe_ci` database, so CI always sees a data-bearing source. Fixing only
the probe would have moved the red one step later, not removed it.

The drill is now forward-only on the same rule as the application: it reads the
migration version the restored copy declares and replays only what is newer.
Nothing is skipped that the database has not already recorded as applied. And
because "Migration replay: passed" now covers a smaller action than it used to,
the report says exactly how much ran:

```
- Migration replay: passed
- Migrations applied to the restored copy: 0 of 21
  (restored copy already declared 0021_content_shadow_invocation_task)
```

**Attribution.** Unlike the probe, this one is not purely inherited. Before
0020 the only migration touching `async_runs_kind_check` was 0014, so replaying
it was harmless; **Slice 2's own 0020 is what made the replay unsound**, and the
probe defect kept it invisible.

### 12.4 The green gate that covered a red one

This is the part that outlives both bugs. `pnpm restore:drill:test` was green at
29/29 while `pnpm restore:drill` failed every run, because the unit gate stubs
the PostgreSQL client tools: it saw the probe SQL as a string and never as a
query. A gate that claims to verify something and does not, while staying green,
is the failure mode this slice produced repeatedly.

The fix is not an assertion about `id`. `scripts/schema-catalog.mjs` parses the
checked-in migration chain into `{table -> columns, primary key}`, and the unit
gate pulls the table and column names back out of the SQL the drill **emits**
and rejects any the schema does not have. Checking the emitted string rather
than the probe declaration means a typo in either one is caught. It needs no
database, so it cannot be skipped in any environment.

The parser is deliberately narrow: it models exactly the DDL the chain uses
(`CREATE TABLE`, `ALTER TABLE ... ADD COLUMN`) and **throws** on anything that
could invalidate the catalog (`DROP COLUMN`, `RENAME`, `DROP TABLE`,
`CREATE TABLE ... AS`), including inside `DO $$ ... $$` bodies. A migration that
needs one of those has to teach the parser first; it can never silently leave a
stale over-approximation that lets bad SQL through.

Because a static parser is itself something that can quietly drift, it is
checked against reality too.
`packages/db/src/__tests__/restore-drill-schema.integration.test.ts` runs under
`pnpm test:integration` against a real PostgreSQL and asserts three things: the
parsed catalog equals `information_schema` **exactly** (44 base tables, every
column), every probe's `key` equals the primary key `pg_constraint` reports, and
the statements the drill actually sends execute against a live server. The
offline guard is guarded by a database, and the database gate is guarded by
something that runs without one.

**Mutation self-verification.** Each mutation was applied alone and reverted;
each turned `pnpm restore:drill:test` red (exit 1) from 38/38.

| Mutation | Result |
|---|---|
| `page_snapshots` probe column `content_hash` → `content_hashh` | **2 failed / 36 passed** — `restore drill SQL names schema objects that do not exist: column app.page_snapshots.content_hashh` |
| `capability_runs` probe key `async_run_id` → `id` (**replays the defect exactly**) | **2 failed / 36 passed** — `integrity probe capability_runs.input-manifest-hash does not order by the primary key of capability_runs`; `column app.capability_runs.id` |
| `export_bundles` probe column `checksum` → `checksum_v2` | **1 failed / 37 passed** — `column app.export_bundles.checksum_v2` |
| `flow_shadow_qa_gates` dropped from `APP_TABLES` | **4 failed / 34 passed** — `the restore inventory and the migration chain must name the same tables` |

The integration half was mutation-checked the same way: the same
`async_run_id` → `id` mutation turns it red against a real server, and breaking
the parser itself (dropping its `ALTER TABLE ADD COLUMN` handling, so the
catalog loses `artifact_revisions.output_locale`) turns **only** the integration
half red — which is exactly the drift the pairing exists to catch.

### 12.5 Gates run for this round

| Gate | Result |
|---|---|
| `pnpm restore:drill` | **pass, exit 0** against a **data-bearing** database (the CI condition): 44 tables, row counts and both checksum families match |
| `pnpm restore:drill:test` | **38/38** (was 29/29); coverage 94.67 line / 90.48 branch / 98.88 function, up from 93.95 / 88.57 / 97.22 |
| `pnpm verify:spec` | 49 operations / 9 async / 44 tables / 11 rules |
| `pnpm verify:authority`, `pnpm implementation:check` | pass, same four counts |
| `pnpm openapi:lint`, `pnpm contracts:check` | valid; no generated drift |
| `pnpm secrets:scan` | pass, exit 0 (75 tests) |
| `pnpm deploy:check` | pass |
| `pnpm lint`, `pnpm typecheck`, `git diff --check` | pass |
| `pnpm build` | pass |
| `docker build -f Dockerfile.worker .` | pass, image built |
| `pnpm db:migrate` / `db:smoke` / `db:migrate:check` | 21 files; rolled back; **44 / 56 / 69 / 18** |
| `pnpm test` (no `DATABASE_URL`) | 305 files, **3872** tests |
| `pnpm test` (with `DATABASE_URL`) | 305 files, **3872** tests — identical |
| `pnpm test:integration` | **66 files, 478 tests** (was 65 / 475; +1 file, +3 tests) |
| E2E `content-shadow-vertical` / `-review` / `-execution` / `audit-technical-vertical` | **21/21** |

**Zero migrations, zero contract change.** Constraint **N-1** held: this round
touches no path under `overview`, `growth-map` or `sources` — its entire diff is
`scripts/` plus one `packages/db` integration test. **No existing assertion was
weakened.** The three `restore:drill:test` assertions that changed all tightened:
`APP_TABLES.length` 33 → 44 and two `appTableCount` 33 → 44. The forward-only
replay does not relax the replay gate either: it stops re-running statements the
restored database has already recorded, and the count it now reports makes the
narrower claim legible instead of implied.

### 12.6 Known residual from this round

`pnpm restore:drill` needs PostgreSQL client tools whose major version matches
the server. On a machine where `PATH` resolves to client 18 against a server 16,
`pg_restore` fails with `unrecognized configuration parameter
"transaction_timeout"`, and the drill reports only
`code=PG_TOOL_EXIT_NONZERO tool=pg_restore` because it discards child stderr on
purpose. The pass recorded above used `RESTORE_DRILL_PG_BIN` pointed at matching
client binaries; CI does not have this problem, because it installs
`postgresql-client` against a `postgres:16` service. This is an environment
mismatch and not a defect in the drill, but the evidence it emits does not say
so, and diagnosing it costs a manual reproduction. Recorded, not fixed: a
version preflight would need its own tests and this round is already at the edge
of its scope.

---

## 13. Queue unification round: the type filter bar, and D8's two named causes

Two pieces of work, committed separately: the D8 spec repair the previous round
recorded but did not attempt, and the §4/§5 UX deviation **D-1** recorded above.

### 13.1 D8 — what was fixed, and what it uncovered

Both named causes are closed and each is separately proven by mutation; the suite
is nonetheless **still red**, for causes the D8 entry did not know about. The
full account, including the one assertion that cannot be re-aimed without being
weakened, is written into **§4 D8** rather than duplicated here. `real-vertical-chains`
is **not** claimed green by this round.

### 13.2 D-1 — the type filter bar and the unified queue

Built to specification §4/§5. What landed, the two deliberate narrowings, and
what is still open is written into **§3 D-1** rather than duplicated here.

**What the reference gives, and what it does not.** The chip row, the
hover-equals-selected filled chip, the right-hand `N · M` count, and one queue
carrying type as a per-row badge are all taken from the reference workbench.
Three things deliberately differ:

- **Four type chips, not seven.** `ArtifactType` has four values. The reference's
  seven are a property of its mock data; adding types is a contract change.
- **Chips follow the queue's own canonical order** (`content_brief`,
  `metadata_rewrite`, `technical_ticket`, `english_blog_draft`), not the
  reference's listing order, so a chip and the rows it reveals never disagree.
- **`M` counts `draft`, not `ready`.** The specification's `M` was written for a
  surface where `ready` means "automated checks done, human next". In this queue
  `ready` is the state a human has **already** decided; `draft` is the one whose
  only legal manual moves are `ready` and `archived`. Counting `ready` here would
  label finished work as pending.

### 13.3 Re-aimed assertions

Four specs asserted the queue's per-type `<section>` regions, which no longer
exist. Each was re-aimed to count the same thing over the **whole** queue, keyed
on the new `data-studio-artifact-type` attribute — strictly stronger, because a
duplicate filed outside the scoped section used to be invisible to these lines.
No assertion was weakened; every re-aim carries its reasoning in the spec itself.

Mutation evidence, run against the two specs that are green in this environment
(`audit-technical-vertical`, `content-shadow-vertical`):

| mutation | result |
|---|---|
| every queue row rendered twice | 3 tests red at the re-aimed lines — `Expected: 1, Received: 2` |
| every row hardcoded to `data-studio-artifact-type="content_brief"` | 3 tests red — ticket count `Received: 0`, brief count `Received: 2` |
| both reverted | 3/3 green again |

`cursor-pagination` and `real-vertical-chains` also carry re-aims. Neither can be
run green in this environment — the first is D4 locale-red, the second D8-red —
so their re-aims are typechecked and structurally identical to the proven two,
and **no green is claimed for them**.

### 13.4 Gate results

| gate | result |
|---|---|
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | pass |
| `git diff --check` | clean |
| `pnpm verify:spec` | pass — **49 operations / 9 async / 44 tables / 11 rules** |
| `pnpm verify:authority` / `implementation:check` | pass |
| `pnpm openapi:lint` / `contracts:check` | pass — no generated diff |
| `pnpm deploy:check` / `vendor:check`<sup>†</sup> / `secrets:scan` | pass |

<sup>†</sup> `vendor:check` is a local pre-flight, not a CI step, and structurally cannot be one — see §11.4b.
| `pnpm test` (no `DATABASE_URL`) | pass — 305 files / 3872 tests |
| `pnpm test` **with** `DATABASE_URL` | pass — identical 305 / 3872 |
| `pnpm db:migrate` / `db:smoke` | pass — 21 files; fixtures rolled back |
| `pnpm db:migrate:check` | pass — **44 / 56 / 69 / 18** |
| `pnpm test:integration` | pass — 66 files / 478 tests |
| `pnpm restore:drill` | pass (with `RESTORE_DRILL_PG_BIN`, §12.6) |
| `pnpm restore:drill:test` | pass — 38/38, coverage above thresholds |
| E2E `content-shadow-vertical` / `-review` / `-execution` / `audit-technical-vertical` | **21/21 green** |
| E2E `real-vertical-chains` | **red — §4 D8**, advanced four steps, not claimed green |

**Zero migrations, zero contract change.** Counts are unchanged at 49/9/44/11.

### 13.5 No new red

The seven studio-adjacent mock specs that touch the queue
(`cursor-pagination`, `studio-first-paint`, `studio-workspace`,
`studio-multi-run`, `critical-flows`, `report-artifact-convergence`,
`mobile-shell`) were run **twice**: once with this round's changes stashed, once
with them applied. Both runs produced the **same 28 failures and the same 2
passes**, test for test. Every failure is the §4 D4 locale-cookie defect or
pre-Slice-1 copy, none is the queue. This round introduced **no new red**.

### 13.6 N-1

`git diff --stat 945be02..HEAD` and the same command against the working tree,
both over `apps/web/src/app/p/[projectId]/overview`, `.../growth-map` and
`.../sources`: **both empty**. The Overview assertion in `real-vertical-chains`
was re-aimed at the surface; the surface was not moved to the assertion.

### 13.7 Still open after this round

- **§4 D8** — open, and now understood: see §4 D8 for the three assertions with
  no successor surface and the 24 stale two-platform snapshots.
- **§3 D-1 residual** — the Content Shadow surface still renders above the
  workspace through `afterHero`; folding it into the workspace's document panel
  is specification §6-§8.
- **§3 D-2 / D-3 / D-4**, **§4 D1 / D2 / D3 / D4 / D5**, **§10.4** — all
  unchanged.
- **§8.2 N-3** — branch coverage was not re-measured this round either. No
  improvement is claimed.

## 14. E2E health round: the retired-screen and default-locale specs (2026-07-26)

D4 has never had a measured full-suite baseline in this worktree. This round
took one, diagnosed every failure in it, and repaired the two families it turned
out to be made of. Nothing outside `e2e/` was modified: **not one line of
product code changed in this round.**

### 14.1 The measured baseline

`pnpm test:e2e:mock` at `2f2bd78`, cold, one worker: **74 failed / 55 passed of
129, 28.5 minutes.** The failure list is reproduced in §14.6.

It is not one defect. It is two, plus four residuals:

| cause | failures |
|---|---|
| the spec's subject is a screen the product retired | 42 |
| the spec reads English chrome without selecting a locale | 24 |
| stale anchors on surfaces that moved (nav href, queue affordance, page `<h1>`) | 4 |
| the Growth Map walkthrough rewrite (out of scope, §4 D8's family) | 2 |
| the N-1 frozen `sources-readiness` spec | 2 |

### 14.2 Family one — assertions with no surface left

Slice 1 collapsed the shell onto four destinations (`_nav-model.ts:25`).
`/diagnosis`, `/plan`, `/studio` and `/report` survive only as redirects, and of
the four clients behind them **exactly one is still mounted**: `StudioClient`,
which `/execution` renders (`execution/_execution.tsx:29`). Studio assertions
are therefore live and were left alone — that is why the Studio half of
`cursor-pagination` and `frontend-error-states` needed nothing but a locale.

`DiagnosisClient` (`diagnosis/_diagnosis.tsx:722`), `PlanClient`
(`plan/_plan.tsx:1042`), `ReportClient` (`report/_report.tsx:1244`) and
`ContextForm` (`context/_context-form.tsx:596`) are **imported by nothing**.
`/context` renders `ProductProfilePage` instead (`context/page.tsx:8`).

**Capabilities the product lost with them, and did not replace.** This is the
part that matters more than the test count:

- **Re-running a diagnosis.** `useCreateDiagnosticRun` is referenced only by
  `_diagnosis.tsx:730`. There is no "Re-run diagnosis" control anywhere in the
  shipped shell, and Growth Map has no run trigger.
- **Overriding an Action's status, priority or lane.** `useUpdateAction` is
  referenced only by `_plan.tsx:206`, and `allowedActionStatusTargets`
  (`plan/_action-status-transitions.ts:16`, the frozen MVP status graph) only by
  `_plan.tsx:67`. The server-side transition guard in `actions-service.ts:16`
  is still live and still integration-tested; nothing in the UI can reach it.
- **The client report and its export.** `hooks-report.ts` — the report read, the
  `outputLocale` deep link, `useCreateExport`, the manifest and the download
  link — is imported only by `_report.tsx`. `/results` replaced the route with a
  read-only recheck comparison (`results/_results.tsx`) that has no locale,
  export or manifest affordance.

Those three are recorded as a product finding, not as a test problem. The specs
that guarded them are deleted because a permanently red test guards nothing;
the capability gap is what needs an owner decision.

**Deleted in full** (only subject is a retired screen): `diagnosis-evidence`
(11), `diagnosis-nonblocking-snapshots` (3), `plan-lane-layout` (5),
`plan-status-transitions` (4), `report-workspace` (4),
`report-artifact-convergence` (5), `context-localization-guard` (9).

**Deleted individually**, each with its reason left in the file where the test
stood: `cursor-pagination` (2 Diagnosis pagination, 1 Plan pagination),
`critical-flows` (Diagnosis review, 2 Report export/locale),
`frontend-error-states` (zh-CN Diagnosis review, 2 Report export).

**Where a deleted assertion's guarantee still lives, that is written into the
file next to the deletion**: findings-page merge and snapshot selection in
`lib/api/hooks-diagnosis-pagination.test.ts:95/:123/:166`; finding confirmation
on Growth Map in `growth-map.mock.spec.ts:181`; export error mapping in
`p/[projectId]/frontend-error-states.test.ts:105`; action cursor pagination in
`cursor-pagination`'s own surviving Execution test.

**Ported, not dropped.** The Context editor's unsaved-work fence still exists —
`setUnsavedContextChanges` has one writer left, `_product-profile.tsx:312` — so
its `beforeunload` half moved to `product-profile.mock.spec.ts` against the
surface that owns it now. The **nav-link half was not ported and was not
asserted away**: it cannot fire. The editor is a modal that marks every
background element `inert` while open (`_product-profile.tsx:207`), and the flag
is only ever true while that modal is open, so the confirm in `_nav.tsx:97` is
unreachable from the product. Second finding, same character as the three above.

### 14.3 Family two — specs that never chose a locale

`DEFAULT_LOCALE` is `zh-CN` (`packages/i18n/src/config.ts:6`). Five specs
asserted English chrome without setting `sf_ui_locale`, so each died at its
first English locator. They now set the cookie in `beforeEach`, the same
mechanism `studio-first-paint`, `studio-workspace`, `studio-multi-run`,
`mobile-shell`, `growth-map` and `audit-technical-vertical` already use.

The bilingual halves were **not** collapsed to one language. Every test that
asserts Chinese chrome already clicks the in-app locale switch, whose button
labels are locale-independent `aria-label`s (`components/ui/LocaleSwitch.tsx:9`),
so it still works from an English page. After this round no assertion in these
files depends on the default: `critical-flows`, `dataforseo-source` and
`frontend-error-states` still prove both languages, each selected on purpose.

`sources-layout` was not on the reported list and is the same defect; it is
fixed. `sources-readiness` has the identical defect and is **deliberately left
red** — it is inside the N-1 freeze this round was told not to touch. The fix
is the same six lines whenever the freeze lifts.

### 14.4 Re-aimed, at equal or greater strength

| spec | what moved | how it is read now |
|---|---|---|
| `critical-flows` "project navigation exposes live destinations" | the Overview rewrite deleted its "Preview report" and "Review diagnosis" links (`overview.previewReport` / `overview.reviewDiagnosis` are now referenced by no component) and moved the stage pill to the topbar | all four shell destinations, their exact hrefs, **and that there are exactly four**; stage localization on the topbar pill. Strictly more than the two links it read |
| `cursor-pagination` "Studio protects unsaved content and notes" | Plan/Studio/Report are no longer sidebar links; Execution round-trips editor state through `?actionId=&artifactId=` | same fence, same count of link navigations and browser traversals, retargeted Plan→Results, Studio→Execution, Report→Overview; URL assertions compare the pathname exactly and stay silent about the screen's own query |
| `frontend-error-states` 409 recovery fence | the unified queue withholds a fenced row's regenerate handler instead of disabling it (`_studio.tsx:3089`, `:711`, `:705`) | the control's **absence** plus a disabled Open — two observables where there was one |
| `frontend-error-states` axe loop | `plan` and `studio` both redirect to `/execution`, so it scanned one page twice under two retired names | it names that page |
| `sources-layout` diagnosis CTA | the href moved to `/growth-map?object=pages` | still an exact href |
| `csp-development` | anchored on `overview.heroTitle`, which no component renders; and the Overview's three new reads are answered by the fixture's 501 tripwire, which Chromium logs as console errors — so `browserErrors` was reading the fixture, not the runtime | runs on Sources, a canonical screen the same fixture serves completely. **No assertion changed** |

### 14.5 Mutation evidence

Every repaired spec was proven by breaking the product guarantee it guards and
watching it go red. All seven mutations were reverted; `git status` over
`apps/` and `packages/` is clean.

| mutation | file | spec | result |
|---|---|---|---|
| `shouldConfirmArtifactNavigation` always false | `studio/_artifact-editor-state.ts:29` | `cursor-pagination` | **red** — "Studio protects unsaved content and notes" (1 failed / 4 passed) |
| Results nav item points at `report` | `_nav-model.ts:44` | `critical-flows` | **red** — "project navigation exposes live destinations" (1 / 5) |
| problem display drops `requestId` | `_problem-display.tsx:25` | `frontend-error-states` | **red** — 3 tests (Sources query errors, Studio generation errors, the 409 fence) (3 / 9) |
| enabled DataForSEO slot renders no controls | `sources/_sources.tsx:1392` | `dataforseo-source` | **red** — "enabled DataForSEO slot collects…" (1 / 1) |
| development `style-src` gains a nonce | `apps/web/security-headers.ts:22` | `csp-development` | **red** (1 / 0) |
| editor `beforeunload` never fences | `context/_product-profile.tsx:313` | `product-profile` | **red** — the ported "only a dirty open Product Profile editor fences the browser unload" (1 / 7) |
| diagnosis CTA href → `object=keywords` | `sources/_sources.tsx:1793` | `sources-layout` | **red** — "Sources exposes the diagnosis CTA…" (1 / 1) |

The locale family needs no separate mutation: **the §14.1 baseline is that
mutation.** Without the cookie every one of those tests is red at its first
English locator, which is exactly what the pre-change run records.

### 14.6 Before / after, and the proof of zero new red

`pnpm test:e2e:mock`, full suite, cold, one worker, both runs in this worktree:

| | tests | passed | failed | wall |
|---|---|---|---|---|
| before (`2f2bd78`) | 129 | 55 | **74** | 28.5m |
| after (`54cab8d`) | 79 | 75 | **4** | 2.6m |

**The after-failure set is a strict subset of the before-failure set. New red: 0.**

Every one of the 74 baseline failures is accounted for: 70 no longer fail, 4
still do. Nothing that passed before fails now.

| still red | why | in scope? |
|---|---|---|
| `frontend-error-states:615` "Studio releases a 409 recovery fence when the canonical run has already settled" | **genuine disagreement — see §14.7.** Not masked | in scope, deliberately left red |
| `growth-map.mock.spec.ts:124` "reviews only the canonical Opportunity…" | the Growth Map walkthrough rewrite | out of scope by instruction |
| `sources-readiness.mock.spec.ts:105` and `:163` | the same default-locale defect as §14.3 | out of scope: N-1 freeze |

One baseline failure was neither of the two families:
`audit-technical-vertical` "proves the technical opportunity vertical without
any lift claim" failed the cold 28.5-minute baseline waiting for
`[data-growth-map-page]` and **passes in the 2.6-minute after run, unchanged**.
That is the §4 D4 cold-compile-under-saturation cause, now visible for what it
is: the suite that used to take 28.5 minutes takes 2.6, because the specs that
timed out in 45-second blocks were the ones asserting screens that no longer
render anything they were waiting for.

### 14.7 The one genuine defect this round found and did not fix

> **Fixed in §16, same day.** Read this section as history. §15 measured that the
> manual "Retry generation status" control fires but never releases the fence,
> which turned the "disagreement" below into a defect; §16 repairs it. The fence
> now releases when a complete artifact projection names no live run for the
> action/type, and stays closed on everything less than that. The spec named
> below was never edited and now passes as written.

`frontend-error-states:615` asserts that a `RUN_ALREADY_ACTIVE` (409) recovery
fence **releases automatically** once the canonical artifact projection shows
the conflicting run has settled. It does not. Measured behaviour at HEAD:
the recovery entry stays in `activeGenerationRecoveries`, the row keeps no
regenerate control, `Open` stays disabled, and the
`[data-studio-conflict-recovery]` banner stays on screen with an enabled
"Retry generation status" button. The operator must click it — and §15
measures what happens when they do.

That is deliberate, not accidental. `resolveActiveGenerationRecovery`
(`execution/_execution-deep-link.ts:236`) is documented fail-closed — "Other
action/type matches are stale candidates, not evidence that the unknown winner
settled" — because a 409 does not name the winning run
(`_studio.tsx:1795`). When the refetch finds no live run it takes the
`leaveRecoveryPending` branch (`_studio.tsx:2716`), which clears `refreshing`
but keeps the fence.

So the spec and the implementation encode two different contracts, and both are
defensible: release-on-settled is more usable, hold-until-proven is safer
against a duplicate generation. **This needs an owner decision, not a test
edit**, so the test was left red rather than rewritten to whichever contract is
cheaper to assert. Its first half was re-aimed (§14.4) precisely so that it now
fails at the disagreement itself instead of at a stale locator.

**How it was settled.** The framing above — two defensible contracts — did not
survive §15's measurement. Fail-closed is only a safety position while there is
something unproven; a complete projection showing no live run proves the
conflicting run ended, so holding past that point protects nothing and traps the
operator. §16 releases exactly there and keeps the fence everywhere else.

### 14.8 Four product regressions the red suite was hiding

None of these is a test problem, and none is fixed here — this round was told to
record them, not repair them. Each entry names the product change that removed
the capability, what an operator can no longer do, and whether the server-side
capability is still there.

**Attribution is identical for all four: the removal is Slice 1's, the discovery
is Slice 2's.** Slice 1 collapsed the project shell onto four destinations and
turned the old ones into redirects (`3c2ecc6 feat(workspace): ship traceable
customer growth map`, `_nav-model.ts:25`), and replaced the Context editor with a
modal (`235a2fd feat(profile): ship traceable product profile workflow`,
`context/page.tsx:8`). Neither commit removed the server side of anything. Slice
2 found all four, and only because §14.1 was the first measured full-suite run
this worktree has ever had.

**Why they stayed hidden for a whole slice.** Every one of these capabilities had
E2E coverage, and every one of those specs was **already red, for an unrelated
reason, at the moment the capability was removed**. Two causes had the suite
pinned: `DEFAULT_LOCALE` flipped to `zh-CN` in `3c2ecc6`, so specs asserting
English chrome died at their first locator (§14.3), and the routes those specs
navigated to became redirects (§14.2). **A test that is already red cannot go red
again.** The full suite stood at 74 failed of 129 in 28.5 minutes with no
baseline anyone trusted (§4 D4, original entry), so the signal these four
regressions would have raised was indistinguishable from the noise the suite
produced anyway. That is the mechanism, and it is why the measured baseline in
§14.1 had to come before any repair.

#### R1 — nothing in the shipped product can run a diagnosis

- **Removed by:** `3c2ecc6`. `/p/[projectId]/diagnosis` is now a redirect into
  the Growth Map (`diagnosis/page.tsx:19`), and `DiagnosisClient`
  (`diagnosis/_diagnosis.tsx:722`) is imported by no file in `apps/web/src`.
- **What the operator lost:** the ability to ask for a diagnostic run at all.
  `useCreateDiagnosticRun` (`lib/api/hooks-diagnosis.ts:457`) has exactly one
  caller in the repository — `_diagnosis.tsx:730`, inside the unmounted client.
  Growth Map renders the output of a run and carries no trigger. When a project's
  inputs change, the shipped UI offers no way to re-diagnose.
- **Server side: live.** `POST /api/mvp/projects/{projectId}/diagnostic-runs`
  (`diagnostic-runs/route.ts:13`) still routes and still runs. The gap is
  entirely in the UI.

#### R2 — nothing in the shipped product can override an Action's status, priority or lane

- **Removed by:** `3c2ecc6`. `/p/[projectId]/plan` is now a redirect to
  `/execution` (`plan/page.tsx:16`), and `PlanClient` (`plan/_plan.tsx:1042`) is
  imported by no file in `apps/web/src`.
- **What the operator lost:** moving an Action through the MVP status graph,
  changing its priority, moving it between the 30/60/90 lanes, and recording the
  reason each override requires. `useUpdateAction` (`lib/api/hooks-plan.ts:109`)
  has one caller, `_plan.tsx:206`; `allowedActionStatusTargets`
  (`plan/_action-status-transitions.ts:16`) has one caller, `_plan.tsx:67`. The
  unified Execution queue that took over the route generates and opens
  deliverables; it does not edit Action state.
- **Server side: live, fully tested, and unreachable.** `PATCH
  /api/mvp/projects/{projectId}/actions/{actionId}`
  (`actions/[actionId]/route.ts:12`) still routes; `ACTION_STATUS_TRANSITIONS`
  and `isAllowedActionStatusTransition` (`lib/services/actions-service.ts:16`
  and `:28`) still enforce the frozen graph; `baseRevision` still answers 409
  `VERSION_CONFLICT`; overrides are still appended to `action_override_audit`.
  `lib/services/__tests__/actions-service.test.ts` and
  `lib/services/__tests__/action-override.integration.test.ts` are green.
  **That guard is being tested against a caller that no longer exists.** The
  green test proves the rule is correct, not that anyone can invoke it.

#### R3 — nothing in the shipped product produces the client report or its export

- **Removed by:** `3c2ecc6`. `/p/[projectId]/report` is now a redirect to
  `/results` (`report/page.tsx:16`), and `ReportClient`
  (`report/_report.tsx:1244`) is imported by no file in `apps/web/src`.
- **What the operator lost:** the client-facing report, its `outputLocale` deep
  link, export creation, the export manifest, and the download link. Every symbol
  in `lib/api/hooks-report.ts` — `useCreateExport` (`:267`) included — has
  exactly one importer, `_report.tsx:50`. The destination that took over the
  route, `/results` (`results/_results.tsx`), is a read-only prior-vs-new recheck
  comparison: that file contains no occurrence of `useCreateExport`,
  `outputLocale`, `manifest` or `download`. There is no path through the shipped
  UI to a deliverable an operator could hand to a client.
- **Server side: live.** `GET /api/mvp/projects/{projectId}/report`
  (`report/route.ts:13`), `POST /api/mvp/projects/{projectId}/exports`
  (`exports/route.ts:12`) and `GET .../exports/{exportId}`
  (`exports/[exportId]/route.ts:10`) all still route, and
  `lib/services/__tests__/report-projection.integration.test.ts` still covers the
  projection.

#### R4 — both unsaved-work navigation confirms are unreachable

Smaller than R1-R3, and recorded at its real size rather than inflated to match
them.

- **Removed by:** `235a2fd`. `/p/[projectId]/context` renders
  `ProductProfilePage` (`context/page.tsx:8`), and `ContextForm`
  (`context/_context-form.tsx:596`) — which set the dirty flag from a full page —
  is imported by no file in `apps/web/src`.
- **What is now dead:** the one surviving writer, `_product-profile.tsx:312`,
  sets the flag to `open && dirty`, true only while the editor modal is open. On
  open, that modal sets `aria-hidden` and `inert` on every `document.body` child
  except its own backdrop (`_product-profile.tsx:166-179`), so no shell link can
  be clicked during the only window in which the flag can be true. Both readers
  are therefore unreachable from the product: `_nav.tsx:93` (the four shell
  destinations) and `_project-switcher.tsx:87` (the project switcher). §14.2
  named only the first; the second has the same defect and is recorded here.
- **What the operator actually lost:** in the ordinary case, nothing. The modal
  runs its own discard confirmation on close (`_product-profile.tsx:324`) and
  keeps the `beforeunload` fence (`:313`, asserted in
  `product-profile.mock.spec.ts`). One real hole is left: **browser Back with a
  dirty editor open discards the edits with no prompt.** `inert` does not disable
  the back button, the modal registers no `popstate` handler, and `beforeunload`
  does not fire on a client-side history pop.
- **Server side:** not applicable; this guard is client-only.
- **Why it is on this list anyway:** two code paths read as though they protect
  unsaved work and cannot. If the Product Profile editor ever stops being a
  modal, they will still be there, still wired, and still silent.

**What each of these needs.** R1-R3 are Owner decisions, not engineering
estimates: either the capability returns on one of the four shipped
destinations, or the API surface, its hooks and its tests are deleted along with
the screens. Leaving them as they stand keeps three tested server capabilities
that no user of the product can reach. R4 is an engineering task once R1-R3 are
settled: delete the two dead readers, or give the editor a `popstate` guard and
keep them.

### 14.9 N-1

`git diff 2f2bd78..HEAD` over `apps/web/src/app/p/[projectId]/overview`,
`.../growth-map` and `.../sources`: **empty**. This round changed no product
code at all — the whole diff is `e2e/` plus this document. Every drifted
assertion was moved to the shipped surface; no surface was moved to an
assertion. `sources-readiness.mock.spec.ts` was not touched.

### 14.10 Gate results

| gate | result |
|---|---|
| `pnpm test:e2e:mock` (full suite) | **4 failed / 75 passed of 79**, from 74/55 of 129. Zero new red |
| `pnpm lint` / `typecheck` / `build` | pass |
| `git diff --check` | clean |
| `pnpm verify:spec` | pass — **49 operations / 9 async / 44 tables / 11 rules** |
| `pnpm verify:authority` / `implementation:check` | pass |
| `pnpm openapi:lint` / `contracts:check` | pass — no generated diff |
| `pnpm deploy:check` / `vendor:check`<sup>†</sup> / `secrets:scan` | pass |
| `pnpm db:migrate` / `db:smoke` | pass |
| `pnpm db:migrate:check` | pass — **44 / 56 / 69 / 18** |
| `pnpm test:integration` | pass — 66 files / 482 tests |
| unit + integration `--coverage` | pass — 377 files / 4480 tests; **91.02 stmts / 84.81 branch / 94.71 funcs / 92.64 lines**, branch unchanged at 84.8% |
| `pnpm restore:drill` / `restore:drill:test` | pass (with `RESTORE_DRILL_PG_BIN`) — 38/38, coverage above thresholds |

**Zero migrations, zero contract change, zero product-code change.**

### 14.11 Still open after this round

- **§4 D4 is no longer "no trustworthy baseline"** — there is one, it is in
  §14.6, and it is reproducible in under three minutes. What remains is the
  four failures named there. **Two of the four are since closed**: `939129a`
  selected the UI locale in `sources-readiness.mock.spec.ts`, which the N-1
  freeze does not cover, and the suite now stands at 77 passed / 2 failed of 79
  (§4 D4, updated entry).
- **§14.7** — **closed by §16.** Measured as a defect in §15, repaired in §16;
  `frontend-error-states.mock.spec.ts:615` passes without ever being edited.
- **§14.8** — four product regressions, unrelated to tests: no UI can run a
  diagnosis (R1), override an Action's status/priority/lane (R2), or produce the
  client report and its export (R3); both unsaved-work navigation confirms are
  unreachable (R4). Removal is Slice 1's, discovery is Slice 2's, and each entry
  records whether the server-side capability is still live.
- **§4 D8 / `growth-map.mock.spec.ts:124`** — unchanged; the Growth Map
  walkthrough rewrite is still its own task. The walkthrough coverage deleted in
  §14.2 (evidence provenance and the focus-restoring drawer, qualitative
  coverage states, domain/severity filter intersection, the not-run coverage
  band, and the three-viewport a11y sweep) was written against the retired
  Diagnosis screen; if Growth Map is meant to carry those guarantees, that task
  is where they belong, and this list is its checklist.

## 15. The 409 fence has no working escape hatch (2026-07-26)

> **Fixed in §16, same day.** Everything measured below stood at `9f55e8d` and
> is accurate for that commit. Repair (1) of the two put in front of the owner in
> §15.3 was taken. One correction to §15.1's third reading, measured in §16.4: a
> full page reload is not the only exit — an in-app client-side navigation away
> and back clears the fence too, because it remounts the component. The product
> tells the operator about neither.

§14.7 left `frontend-error-states.mock.spec.ts:615` red and asked for an owner
ruling. The ruling came back: **keep the fail-closed implementation and rewrite
the spec to the real contract** — a lagging projection is a bad reason to let a
second generation through, and the product already gives the operator a manual
way out, so nobody gets stuck. The rewrite was required to assert that way out,
not just the fence: the control exists, it is interactive, and **clicking it
releases the fence**.

**The third assertion cannot be written, because it is not true. The manual
control does not release the fence.** The premise the ruling rested on is false,
so the spec was left exactly as it is and this section reports instead.

### 15.1 What was measured

A throwaway Playwright spec reproduced §14.7's scenario — a 409
`RUN_ALREADY_ACTIVE` on generate, then an artifacts projection showing
`status: "ready"` with `activeRun: null`, i.e. the conflicting run has
demonstrably settled — then clicked the banner's "Retry generation status"
button three times and finally reloaded the page. Counters are the mock's
artifact-read count, the number of `[data-studio-conflict-recovery]` banners,
and the number of `Regenerate` controls on the fenced row:

```
PROBE reads before retry: 2
PROBE attempt=1 reads=3 panels=1 regenerateButtons=0
PROBE attempt=2 reads=4 panels=1 regenerateButtons=0
PROBE attempt=3 reads=5 panels=1 regenerateButtons=0
PROBE afterReload panels=0 regenerateButtons=1
```

Three readings, in order of how much they matter:

1. **The control is real and it does fire.** It is present, it is enabled once
   the first refetch returns, and every click issues a fresh artifacts read
   (2 → 3 → 4 → 5). This is not a dead button or a disabled one.
2. **It never releases the fence.** After three clicks the banner is still on
   screen and the row still has no `Regenerate` control. Nothing about the
   operator's situation changes, and nothing tells them that.
3. **Only a full page reload clears it** — `activeGenerationRecoveries` is
   component state (`_studio.tsx:1797`), so it does not survive a remount. The
   product never suggests reloading, and the banner it does show says the run
   status is unavailable and offers the retry that cannot help.

### 15.2 Why it cannot release, by construction

The retry button calls `recoverAlreadyActive` (`_studio.tsx:2694`) — the same
function the 409 handler calls. It refetches, then asks
`resolveActiveGenerationRecovery` (`execution/_execution-deep-link.ts:236`) what
the projection proves. That resolver returns `active` only when it finds exactly
one non-archived artifact for the action/type **whose `activeRun` is live**
(`liveRunId !== null`). In the settled case there is by definition no live run,
so it returns `pending`, and the caller takes the `leaveRecoveryPending` branch
(`_studio.tsx:2715`), which clears `refreshing` and keeps the recovery entry.

A recovery key leaves `activeGenerationRecoveries` on exactly two paths: the
`kind === "active"` success path (`_studio.tsx:2795`), and `onQueued`
(`_studio.tsx:2650`). `onQueued` is unreachable from this state — `openGenerate`
(`_studio.tsx:2593`) returns early while a recovery names the action, and the
fenced row is rendered without a regenerate handler (`_studio.tsx:3089`, `:711`).

So the only affordance the banner offers can succeed **only while the
conflicting run is still running**. In the exact state the banner exists to
handle — a run that has already settled — clicking it can never work. The button
is not broken; it is wired to a resolver that is structurally incapable of
answering yes for this case.

This also corrects §14.7's last sentence on the point. "The operator must click
it" reads as though clicking is the way out. It is not; there is no way out from
inside the page.

### 15.3 What this changes for the ruling

The ruling was conditioned on the operator not being trapped. Measured, the
operator is trapped: the affordance shown to them is a no-op for their state, it
reports nothing about that, and the only exit is a browser reload nothing tells
them to perform. That makes this a defect rather than a contract disagreement,
so the open question is no longer "which contract should the spec assert" but
"which repair lands":

1. **Release when the projection is complete and shows no live run.**
   `resolveActiveGenerationRecovery` already takes `projectionComplete`. A
   complete cursor set with no live match is positive evidence that the
   conflicting run settled, not absence of evidence, and the fence has nothing
   left to protect. This makes `frontend-error-states.mock.spec.ts:615` pass as
   written, and it keeps fail-closed behaviour for the incomplete-projection
   case the resolver's docstring is actually about.
2. **Keep fail-closed and make the manual control genuinely escape.** The button
   would have to drop the recovery entry outright instead of re-running the
   resolver, and the banner copy would have to say what the operator is choosing
   — to proceed without proof the other run finished, accepting a possible
   duplicate generation.

(1) is the smaller change and restores the guarantee the spec was written for.
(2) preserves the safety argument but needs new copy in both locales and makes
duplicate generation an operator decision. **Either is an owner call.** What is
not available is leaving the behaviour as it stands and calling the test wrong:
that would be writing down a working escape hatch that was measured not to work.

### 15.4 Reproduction

The probe was deleted after measuring; `git status` over `apps/`, `packages/`
and `e2e/` is clean. To rebuild it: copy the body of
`frontend-error-states.mock.spec.ts:615` and drop the `settledProjectionGate`
promise so the artifacts route answers immediately; after
`expect.poll(() => createAttempts).toBe(1)`, locate
`[data-studio-conflict-recovery]`, assert its button is enabled, click it in a
loop, and log the banner and `Regenerate` counts each pass. It runs in about ten
seconds under `pnpm test:e2e:mock -g`.

### 15.5 Scope of this round

Two commits, both documentation. **Zero product code, zero spec code.**

- `git diff 939129a..HEAD -- apps packages e2e` is empty.
- N-1 per path — `git diff 939129a..HEAD` over
  `apps/web/src/app/p/[projectId]/overview`, `.../sources` and `.../growth-map`:
  empty, all three.
- `frontend-error-states.mock.spec.ts` is byte-for-byte unchanged. The test that
  this round was sent to rewrite is still red, still failing at the
  disagreement, and is now backed by a measurement instead of a reading.
- No visual baseline snapshot was regenerated.

### 15.6 Gate results

Both commits in this round are documentation. The gates were run anyway, on the
principle that a round which claims a measurement should also prove it changed
nothing else.

| gate | result |
|---|---|
| `pnpm test:e2e:mock` (full suite) | **77 passed / 2 failed of 79, 2.3m** — before and after are the same run set, because this round changed no spec. Failures: `frontend-error-states.mock.spec.ts:615` (§15) and `growth-map.mock.spec.ts:124` (§4 D8). Down from 4 failed at `54cab8d` |
| `pnpm lint` / `typecheck` / `build` | pass |
| `git diff --check` | clean |
| `pnpm verify:spec` | pass — **49 operations / 9 async / 44 tables / 11 rules** |
| `pnpm verify:authority` / `implementation:check` | pass |
| `pnpm openapi:lint` | pass — description valid |
| `pnpm contracts:check` | pass — no generated diff |
| `pnpm deploy:check` / `vendor:check`<sup>†</sup> | pass |
| `pnpm secrets:scan` | pass — 4 files / 75 tests |
| `pnpm db:migrate` | pass — 21 migrations applied to a disposable loopback database |
| `pnpm db:smoke` | pass — fixtures rolled back |
| `pnpm db:migrate:check` | pass — **44 tables / 56 indexes / 69 triggers / 18 routines** |
| `pnpm test:integration` | pass — 66 files / 482 tests |
| unit + integration `--coverage` | pass — **91.02 stmts / 84.8 branch / 94.71 funcs / 92.64 lines**, unchanged from `54cab8d` |
| `pnpm restore:drill` / `restore:drill:test` | pass — 38 tests / 38 passed, coverage above thresholds |

**Zero migrations, zero contract change, zero product-code change, zero spec
change.** No visual baseline snapshot was regenerated.
## 16. The 409 fence releases when the projection proves the run ended (2026-07-26)

§15 measured that the fence's only affordance cannot release it, which turned
the §14.7 "contract disagreement" into a defect: an operator who hits
`RUN_ALREADY_ACTIVE` after the conflicting run has already settled cannot
regenerate that artifact from the page they are on. **Repair (1) of §15.3 was
taken.** The fence now releases when a complete artifact projection names no
live run for the fenced action/type, and stays closed on everything less.

### 16.1 The repair

One new pure predicate, one branch at the single call site.

`activeGenerationRecoveryReleased` (`execution/_execution-deep-link.ts`) answers
one question — *does the projection positively prove there is no live run for
this action/type?* — and answers it `false` unless the cursor set is complete:

```ts
if (!projectionComplete) return false;
return !artifacts.some(
  (candidate) =>
    candidate.actionId === actionId &&
    candidate.artifactType === artifactType &&
    candidate.liveRunId !== null,
);
```

`recoverAlreadyActive` (`studio/_studio.tsx`) consults it only on the branch
that used to be unconditional. When `resolveActiveGenerationRecovery` does not
answer `active` **and** the predicate proves the run ended, the recovery key is
dropped outright (`releaseRecoveryFence`); otherwise the pre-existing
`leaveRecoveryPending` runs exactly as before. Both the 409 handler and the
banner's "Retry generation status" button enter through this function, so the
manual control §15 measured as a no-op now works for the same reason the
automatic path does.

**Why this is not a weakening of fail-closed.** The resolver's docstring justifies
holding the fence on the ground that a partial projection is *absence of
evidence*. A complete bounded cursor set with no live run is not absence of
evidence — it is evidence of absence, from the same canonical projection the
fence was waiting for. The three states that keep the fence closed are unchanged:
an incomplete cursor set, a failed refetch (`!refreshed.isSuccess`, untouched),
and any live run still named for the action/type — including one carried by an
**archived** artifact, which `resolveActiveGenerationRecovery` deliberately
refuses to adopt and which the predicate deliberately refuses to release.

`resolveActiveGenerationRecovery` itself was **not modified**. It still answers
`pending` for the settled case, and its existing unit assertions (`…test.ts:296`,
`:345`) pass untouched. The release decision is a separate predicate rather than
a fourth resolution kind precisely so that no existing assertion had to move.

### 16.2 What is pinned, and the mutations that prove it

New unit test: *"releases the fence only when a complete projection names no live
run"* (`_execution-deep-link.test.ts`). It pins release for three shapes (a
complete projection whose only matches have no live run, an empty complete
projection, a different artifact type on the same action) and fail-closed for
four (incomplete projection with the settled shape, incomplete and empty, a live
run on a live artifact, a live run on an archived artifact).

| mutation | expected | measured |
|---|---|---|
| release ignores `projectionComplete` (`void projectionComplete`) | new test red | **red** — `…test.ts:404`, `expected true to be false`, on the incomplete-projection case |
| release ignores the live-run match (`return true` once complete) | new test red | **red** — `…test.ts:425`, `expected true to be false`, on the live-run-on-a-live-artifact case |
| release branch deleted from `recoverAlreadyActive` | `frontend-error-states:615` red | **red** — `…:719 expect(regenerate).toBeEnabled()`, *element(s) not found*, i.e. the withheld control, exactly the §15 symptom |

Each mutation was reverted immediately and the file restored byte-for-byte.

### 16.3 `frontend-error-states.mock.spec.ts:615` passes as written

The spec was **not edited**: `git diff -- e2e` is empty for this round, and the
file has not changed since `54cab8d` re-aimed its first half. It now passes:

```
✓ 1 [chromium-mock] › e2e/frontend-error-states.mock.spec.ts:615:1 ›
    Studio releases a 409 recovery fence when the canonical run has already settled (6.2s)
```

Its second half is the part that was unreachable before — after
`releaseSettledProjection()`, `Regenerate` becomes enabled, the
`[data-studio-conflict-recovery]` banner drops to zero, and a second generate
attempt goes through (`createAttempts` 1 → 2). Its first half is unchanged and
still proves the fence holds while the projection is in flight.

### 16.4 The measurement §15 owed: client-side navigation also clears the fence

§15 tested a full page reload and inferred nothing about in-app navigation. It
was measured this round, at `9f55e8d` — **before** the fix, so it describes the
trap as §15 left it. A window marker set before leaving and read after returning
proves each round trip was a soft navigation, not a document load:

```
NAVPROBE fenced                 reads=2 panels=1 regenerateButtons=0
NAVPROBE afterNavLinkRoundTrip  softNav=true reads=2 panels=0 regenerateButtons=1
NAVPROBE refenced               createAttempts=2 panels=1 regenerateButtons=0
NAVPROBE afterBackRoundTrip     softNav=true reads=3 panels=0 regenerateButtons=1
```

Both round trips — Execution → Overview → Execution through the nav links, and
Execution → Overview → browser Back — clear the fence, with no document load.
`activeGenerationRecoveries` is component state, and a route change unmounts
`StudioClient`.

Two consequences, and they point in opposite directions:

1. **The trap was narrower than §15 implied.** Two exits existed, not one. It
   remains a trap in the sense that mattered: the product names neither, the
   banner offers only the control that cannot work, and an operator who stays on
   the page — the expected behaviour when a banner says "retry" — is stuck.
2. **The fence was already weaker than it looked, and this was not a decision.**
   Any nav round trip dropped it, including while a conflicting run was genuinely
   still live, letting a duplicate generation through. The `refenced` line above
   is that path being exercised: after the fence cleared, a second `POST` was
   accepted. So "fail-closed" was never enforced across navigation, only within a
   mount. §16 does not change this and does not claim to (§16.7).

### 16.5 Scope and N-1

Three files, all in the fenced-generation path.

- `apps/web/src/app/p/[projectId]/execution/_execution-deep-link.ts` — +24, −0
- `apps/web/src/app/p/[projectId]/studio/_studio.tsx` — +36, −12 (12 are the
  refactor that hoists the projection identities so both callees share them)
- `apps/web/src/app/p/[projectId]/execution/_execution-deep-link.test.ts` — +99, −0

N-1, per path, `git diff` against `9f55e8d`:

- `apps/web/src/app/p/[projectId]/overview` — **0 files changed**
- `apps/web/src/app/p/[projectId]/sources` — **0 files changed**
- `apps/web/src/app/p/[projectId]/growth-map` — **0 files changed**

`growth-map.mock.spec.ts` was not touched, `e2e/` has no diff at all, and no
visual baseline snapshot was regenerated. Zero migrations, zero contract change.

### 16.6 Gate results

| gate | result |
|---|---|
| `pnpm test:e2e:mock` (full suite) | **before 77 passed / 2 failed of 79 (2.1m); after 78 passed / 1 failed of 79 (1.9m)**. The failure that cleared is `frontend-error-states.mock.spec.ts:615`. The one that remains is `growth-map.mock.spec.ts:124` (§4 D8), unchanged and untouched. **No test moved from green to red.** |
| `pnpm lint` / `typecheck` / `build` | pass |
| `git diff --check` | clean |
| `pnpm verify:spec` | pass — **49 operations / 9 async / 44 tables / 11 rules** |
| `pnpm verify:authority` / `implementation:check` | pass |
| `pnpm openapi:lint` | pass — description valid |
| `pnpm contracts:check` | pass — no generated diff |
| `pnpm deploy:check` / `vendor:check`<sup>†</sup> | pass |
| `pnpm secrets:scan` | pass — 4 files / 75 tests |
| `pnpm db:migrate` | pass — 21 migrations on a disposable local database |
| `pnpm db:smoke` | pass — fixtures rolled back |
| `pnpm db:migrate:check` | pass — **44 tables / 56 indexes / 69 triggers / 18 routines** |
| `pnpm test:integration` | pass — 66 files / 482 tests |
| unit + integration `--coverage` | pass — **91.02 stmts / 84.82 branch / 94.71 funcs / 92.64 lines** (branch 84.8 → 84.82) |
| `pnpm restore:drill` / `restore:drill:test` | pass — 38 tests / 38 passed, coverage above thresholds |

### 16.7 Known residuals from this round

- **The fence still does not survive a route change** — but the consequence was
  overstated, and is corrected here (2026-07-26). The original wording said an
  operator "can start a duplicate generation". They cannot. `activeGenerationRecoveries`
  is component state and is lost on remount, so during the new mount's projection
  refetch the control is briefly live again — but the request that follows is
  refused by the server: `artifacts.ts:263` scopes the run to
  `activeKey = artifact:${artifactId}`, `:466` handles the
  `async_runs_one_active_key_idx` violation, `:488` resolves the winner and `:162`
  raises `RUN_ALREADY_ACTIVE`, with the unique index itself declared at
  `0001_init.sql:318`. **The integrity boundary is the database and the service,
  not the fence.**

  So the real behaviour is: one doomed POST inside the remount window, answered
  409, which re-arms the fence. The operator sees a transient error instead of a
  suppressed control. That is a UX defect, not a correctness one, and it does not
  produce a second run.

  **RESOLVED in `119cbf9`.** The reproduction came first and is the part that
  needed care: it pins `artifactsQuery.hasNextPage === true` by holding the
  second artifact page open forever, so `projectionComplete` stays false — the
  one state in which the fence must hold — and then walks the shell Execution →
  Overview → Execution through the real nav links. A test built on a settled
  projection would have proven nothing, since §16 releases the fence there by
  design.

  The fix is the mechanism `_context-navigation-guard.ts` already uses for the
  Context dirty flag: a module-scoped store (`studio/_active-generation-fence.ts`),
  seeded into `useState` and written back from an effect, scoped by project, and
  cleared by a reload. The three existing fence tests are untouched and green —
  including `:615`, the one that would go red if this had turned the fence into
  something that never releases, which is the failure mode worth fearing and the
  one §16 already had to repair once. Two mutations, each reddening the new test
  alone out of thirteen: seeding from `[]`, and disabling the write-back.
- **Nothing re-resolves the fence on its own after an incomplete projection.**
  When the cursor set is incomplete the fence correctly stays, the auto-pagination
  effect fetches more pages, and no code re-runs `recoverAlreadyActive` when they
  land. The operator has to click "Retry generation status" — which, after this
  round, does work. Pre-existing; unchanged.
- **The banner copy is still `runStatusUnavailable`.** It says the run status is
  unavailable, which is accurate while the fence is held but tells the operator
  nothing about what they are waiting for or that retrying is the way through.
  No copy was changed in this round, in either locale.
- **The incomplete-projection half of fail-closed is pinned at unit level only.**
  §16.2's mutations kill it there. There is no `.mock.spec.ts` that drives the
  studio with a deliberately incomplete cursor set behind a 409; the e2e level
  covers the live-run half (the test above `:615`) and the release half (`:615`).

---

## 17. `test:e2e:real` has a measured baseline for the first time

§14.1 did this for the mock suite and it is what made §14.8 possible. The real,
database-backed suite — a CI step in the `database` job — had never been run in
this worktree; §11.4 and §14.6 both say so. It was run on 2026-07-26 against a
local disposable Postgres, using the config's own `next dev` server, and the
database was dropped afterwards. **43 tests, one worker, serial.**

| run | passed | failed | did not run |
|---|---|---|---|
| 1 | 30 | 12 | 1 |
| 2 | 29 | 13 | 1 |

The two runs differ in exactly one test, recorded below as a flake. The single
"did not run" is `real-vertical-chains`' second fixture, which the serial
ordering skips once the first fails.

**Twelve failures reduce to five causes, and only one of them was a test
problem.**

### 17.1 Overview renders a second `<main>` inside the shell's — 8 failures

`layout.tsx:187` renders the project shell's `<main id="main-content">`.
`_overview.tsx:933` renders another `<main className={styles.page}
data-overview-page="">` inside it — and so do the loading and error states at
`:898` and `:907`, so every Overview render has two nested `main` landmarks.
No other destination does this; `<main>` appears in only three other files, all
of them page roots outside the project shell.

Everything in `a11y.spec.ts` funnels through a helper whose first line is
`await expect(page.getByRole("main")).toBeVisible()` (`:39`), which is a strict
locator, so this takes out the Overview axe scan, the sidebar contrast check,
the keyboard-focus check and the reduced-motion check. `responsive.spec.ts:47`
has the same line, which takes out Overview at all four viewports.

This is a product defect, not test drift: a screen-reader user gets two "main"
regions and an ambiguous skip-to-content target. What made the suite red was the
**strict `getByRole("main")` locator**, not axe — see the measurement in §17.6c,
which corrects an earlier claim in this document that axe reports it.

**RESOLVED in `c73b621`, under an N-1 exception the Owner granted for this
defect.** Six tags, `<main>` -> `<div>`, keeping `role="status"` on the loading
state and `data-overview-page` on the ready one. Zero visual change was proven
by **byte equality**, not by a pixel threshold: full-page screenshots at 390 /
768 / 1024 / 1440 against the deterministic mock fixture are sha256-identical
before and after. That was the expected outcome — `overview.module.css` has no
element selectors at all and `globals.css` has no `main` selector, so the tag
name was never load-bearing for style.

The a11y effect was **predicted before the change and measured after**:
`a11y.spec.ts` and `responsive.spec.ts` together went 10 failures -> 2, and the
two survivors are exactly the two this section attributed elsewhere (§17.2 and
§17.4).

### 17.2 Sources has a `definition-list (serious)` axe violation — 1 failure

`axe` reports `definition-list (serious)` on Sources, and the node is
`.readinessMetrics` — a **third** `<dl>` in `_sources.tsx` (`:1668`), not either
of the two an initial reading found. Each of its `<div className=readinessMetric>`
wrappers holds `<dt>`, `<dd>` **and a `<progress>`**, and axe requires a `<div>`
inside a `<dl>` to hold only `<dt>`/`<dd>`.

It is state-dependent, which is why it hides: run `a11y.spec.ts` alone against a
fresh project and Sources **passes**; the readiness block only renders once
source data exists, so only the full serial suite reaches it.

**Not fixed, and — unlike §17.1 — it cannot be fixed under the same terms.**
The Owner's exception was granted for changes that touch no CSS, copy or
layout, and no such change exists here:

- `.readinessMetric` is `display: flex; flex-direction: column; gap: 7px`, so
  `<dt>`, `<dd>` and `<progress>` are three flex items in a column. Moving
  `<progress>` inside `<dd>` makes it an inline child of a block instead of its
  own flex item — the 7px gap disappears and the bar reflows next to the number.
- Replacing `<dl>`/`<dt>`/`<dd>` with generic elements breaks the two element
  selectors `.readinessMetric dt` and `.readinessMetric dd`, and loses the
  term/definition association a screen reader uses.

Either route needs a CSS change (a few lines: give `<dd>` the same column flex
and gap, then nest the bar inside it). That was put to the Owner as a separate
decision rather than slipped in under a no-CSS exception.

**RESOLVED in `a538fe3` with that approval.** The bar moved inside the `<dd>`
whose value it visualises, and `.readinessMetric dd` gained exactly three
declarations reproducing the column it had as a sibling. `.readinessMetric
progress` and its `:nth-child` colour variants are descendant selectors and keep
matching through the new nesting. Zero visual change was again proven by
**sha256 equality** of full-page screenshots at four viewports — the standard
the no-CSS rule was a proxy for, met directly.

### 17.3 R1 — 1 failure and the 1 skip

`real-vertical-chains` at `:447`, covered in full in the D8 addendum in §4. The
suite's serial ordering means the B2C fixture never runs at all.

### 17.4 R3 — 2 failures, one of which is a live product defect

The `report print media` test fails because `globals.css:199` scopes the print
rule with `body:has([data-report-page])`, and that attribute now exists only at
`_report.tsx:1141` — inside the client no file imports. `/p/{id}/report`
redirects to `/results`, which does not carry it. **So the print stylesheet can
no longer fire on any screen, and printing carries the sidebar and the sticky
toolbar into the output.** That is a user-visible consequence of R3 that §14.8
did not name, because §14.8 was reasoning about screens rather than about the
CSS keyed to them.

`project-isolation`'s tail fails for the same reason: it correctly expects the
`/results` redirect and then requires `[data-report-page]` and a
`/api/mvp/projects/{id}/report` request, neither of which a recheck comparison
produces.

**The printing half is fixed (`776b24c`); the R3 half is not, and the two were
separable.** Removing the `body:has([data-report-page])` gate makes the rule
unconditional, which restores its own stated intent rather than choosing a new
screen to privilege — nothing wants navigation chrome in a printout whichever
way R3 goes, and `overview.module.css:1342` already ships a print stylesheet the
gate was quietly defeating. Measured afterwards: the `a11y.spec.ts` print test
now clears **both** shell assertions and fails only on `[data-report-page]`
being visible, which is the Owner decision itself. A mock-suite regression net
covers the fixed half without needing a database, and asserts the page heading
survives print media as well — a rule that hid everything would satisfy the two
shell assertions and be worse than the defect.

### 17.5 The one test-side cause — fixed in `dbdf826`

`project-isolation` asserted English chrome under a `zh-CN` default, and used
`[data-overview-hero]`, an anchor Slice 1 deleted. Both were repaired the way
§14 requires — locale selected by cookie, assertion followed to where the
identity actually lives — and mutation-checked. The spec still fails, on §17.4.

### 17.6 Not a flake — the suite exhausts its own rate-limit budget

Recorded first as an undiagnosed flake: passed in run 1, failed in run 2,
unchanged in between. **It is deterministic.** Diagnosed 2026-07-26 (`59aa41e`).

`csv_import_confirm` allows **10 attempts per 15 minutes per workspace**
(`import/route.ts:61`, `maxAttempts: 10` — not the 20 the neighbouring scopes
use), and the real suite runs against a **single shared dev-auth workspace**,
which `playwright.config.ts` states in its own comment. Each full-suite run
spends two of those attempts — `growth-map.real` and `real-vertical-chains`
AC-044 — so around the fifth run inside one window the CSV confirm answers 429
and this test fails. The assertion printed `Expected: 202 / Received: 429` and
nothing more, which is why four earlier hypotheses were entertained.

The chain was measured at every step:

| step | result |
|---|---|
| five isolated runs, fresh database | 5/5 pass — rules out an intra-test race |
| `a11y` then `growth-map.real`, same run | pass — rules out that spec's residue |
| full suite on an accumulated database | pass — rules out generic DB residue |
| `getByRole("main")` in this spec or its fixtures | absent — rules out §17.1 |
| repeat runs under CPU saturation | **fails** |
| repeat run with no load, budget already spent | **also fails** |
| `app.idempotency_keys`, `rate_limit:csv_import_confirm`, in window | **exactly 10** |
| delete only those rows, change nothing else, re-run | **passes (33.4s)** |

**An earlier reading of this attributing it to CPU contention was wrong and is
retracted**: the no-load control fails identically, and the load run only
appeared decisive because the budget was already gone by then.

Nothing about the rate limit is a defect — 10 confirms per quarter hour is a
sensible policy for an expensive import. What was wrong is that the harness had
no way to say so. Four bare status assertions across the two specs now carry the
response body, so the same failure reads `CSV confirm failed:
{"code":"RATE_LIMITED",...}`. The assertions themselves are unchanged.

**Correction, checked rather than assumed: CI is the safe side, not the sharp
one.** The first version of this entry said the hazard was worse in CI because
the real job sets `retries: 1`. That is backwards. The `database` job starts a
fresh `postgres:16` service container and runs `createdb signalframe_e2e_ci`
before the suite (`ci.yml`), so the rate-limit ledger is empty at the start of
every run; a whole job spends two attempts, four if both specs retry, against a
budget of ten. **CI cannot reach the limit.**

The exposure is entirely local, and it is the ordinary way this suite gets
used: iterating on it, re-running it a few times in a row against a database you
keep. That is exactly how it was hit here — and, being invisible in CI, it is
precisely the kind of thing that would have gone on wasting time indefinitely
had the assertion not been made to name it.

**One fix was considered and deliberately not made.** A `globalSetup` could
delete the `rate_limit:*` rows before each local run and the trap would be gone
entirely — the database is disposable and the config already refuses any name
outside `signalframe_(codex|e2e|ci)`. It was rejected: a harness that wipes the
limiter's ledger before every run is a harness that can never observe rate
limiting, so the day someone writes an E2E assertion about it, the assertion
passes for the wrong reason. That is the same shape as D9, where a unit gate
stubbed Postgres and stayed green over a red drill. The message fix is the
right size — it tells the truth and hides nothing — and this paragraph exists so
the convenience is not added later by someone who only sees the annoyance.

### 17.6b Both fixes are now guarded by the cheap suite (`fde119d`)

Fixing the two defects did not stop them recurring: the only thing that could
see either was `test:e2e:real`, which needs a database, and the Sources one
additionally needs the **full serial** run, since its block renders only once
source data exists. That is the same shape as the finding — they survived a
slice because nothing looked.

- **Overview** now asserts exactly one `main` landmark, at desktop and at 390px.
  It is asserted directly rather than through any axe scan, for the reason
  measured in §17.6c: **no axe scan in this repository can report it.**
- **Sources** gains an axe scan of the readiness region — `sources-readiness.mock.spec.ts`
  had none at all — scoped to `[aria-label="Source readiness"]`.

Both were mutation-checked against the real pre-fix code, not a stand-in:
restoring the nested `<main>` fails the count with `Received: 2`, and checking
`_sources.tsx` out at `a538fe3^` reproduces
`definition-list (serious) @ .sources_readinessMetrics__…`.

**A cheaper version of this was tried, and reverted, because it would have been
a lie (`23138ef`).** Widening the scan loop in `frontend-error-states.mock.spec.ts`
from `["execution"]` to all six shipped destinations made all six pass — and
then a mutation survived: restoring Overview's nested `<main>` did not redden
the Overview case. Probing what each destination renders under
`installCriticalFlowApi` explains it:

| destination | h1 | renders |
|---|---|---|
| growth-map | "Find the next growth opportunity…" | the screen |
| execution | "Turn actions into client-ready work." | hero, body still loading |
| overview | none | loading skeleton |
| sources | none | loading skeleton |
| context | "Loading Product Profile" | loading skeleton |
| results | none | not the screen |

**Correction, 2026-07-27, after measuring rather than inferring.** The table
above was read at page load and is a mid-load snapshot, not what the screens
settle to. Waited out, Overview under the base installer renders its full
scaffold — `h1` plus all four section headings — and only the panels fed by the
501 endpoints show error states. `critical-flows.mock.spec.ts` and
`mobile-shell.mock.spec.ts` both assert against that scaffold today and are
sound.

So "four of six scan a spinner" was wrong. **The real reason the loop protected
nothing is the assertion it used**: `await expect(page.getByRole("main")).toBeVisible()`.
Measured directly with a second `<main>` present, that assertion **passes** — it
is a readiness wait, not a landmark check, and it was never going to catch a
duplicate on `execution` either, the one destination the loop had always
covered. Only `toHaveCount(1)` fails, which is what every placement below uses.

The revert therefore still stands, for a better reason than the one first
recorded: widening a loop whose landmark line cannot fail would have added five
tests that read as landmark coverage and were not.

The assertion therefore goes where a real fixture already exists: Overview
(`fde119d`, via `openOverview(page, readyScenario())`) and Growth Map
(`23138ef`, which renders in full under the shared fixture and is
mutation-verified by turning its page root into a `<main>`). All six shipped destinations now carry the check in the suite a pull request
runs: Overview (`fde119d`), Growth Map (`23138ef`), Sources, Context and
Execution (`19f01ca`, each placed after its own fixture has rendered rather than
after the `goto`, because the defect lives in the ready state), and Results
(`9a15daf`).

Results took one more correction. It was recorded as having no mock fixture;
in fact `recheckResultsFixture()` is complete, but its route lives in
`installGrowthVerticalApi`, layered over the critical-flow installer on purpose
(`mock-api.ts:1060`). A spec on the base installer gets **501** for that
endpoint and renders an error state — which is exactly what the probe saw.
Reading that as "no fixture exists" would have led to duplicating a route the
layering deliberately keeps in one place; the assertion went to
`audit-technical-vertical.mock.spec.ts` instead, which installs the vertical and
walks to the comparison.

`a11y.spec.ts:39` continues to cover all six in the database-backed suite with
the same strict locator.

### 17.6d Which mock installer actually renders which destination

The Results correction above is an instance of something worth stating once, in
a form the next person can use, because it is what made the reverted loop scan
error states rather than screens. Measured by listening for `/api/mvp/**`
responses at or above 400 on a bare page load of each destination:

| destination | `installCriticalFlowApi` alone | with `installGrowthVerticalApi` |
|---|---|---|
| sources | clean | clean |
| overview | **501** `audit/urls`, `product-profile` | clean |
| growth-map | **501** `audit/urls` | clean |
| results | **501** `results` | clean |
| context | **501** `product-profile` | clean |
| execution | **501** `content-shadow-runs` | not served here either |

Both columns are measured. The `execution` row's remedy is **located, not
measured**: `content-shadow-runs` appears in no `mock-api.ts` route — it is
registered by `e2e/content-shadow-vertical-fixture.ts`.

So the base installer alone renders exactly one of the six destinations without
a failed request. That is by design — `mock-api.ts:1060` documents the vertical
installer as layering "the specific audit/opportunity/results routes" over it —
but it means **a spec that installs only the critical-flow API and then visits
one of the other five is asserting against an error or empty state**, however
its name reads. Per-destination coverage has to pick the installer that serves
that destination, which is what §17.6b's placements do.

### 17.6c Measured: no axe scan here could ever have caught the duplicate landmark

An earlier draft of §17.1 called the duplicate `main` "an axe `landmark-one-main`
violation", and §17.6b blamed the miss on the Overview scan being
`.include("#main-content")`-scoped. Both were checked against a real run and both
were wrong — the second one understates the problem badly.

With the defect restored and axe run **unscoped** on Overview:

| tag set | violations reported |
|---|---|
| `wcag2a, wcag2aa, wcag21a, wcag21aa` — what every scan here uses | `color-contrast:serious` only. **No landmark rule at all.** |
| the same plus `best-practice` | `landmark-no-duplicate-main:moderate`, `landmark-unique:moderate`, `landmark-main-is-top-level:moderate` |

So the rule is `landmark-no-duplicate-main`, not `landmark-one-main`, and **two
independent filters each exclude it**: this repository's scans select WCAG tags,
which the rule does not carry, and then keep only `critical`/`serious`, which it
is not. Re-scoping any of the six scans would change nothing; adding more axe
would change nothing.

**The only thing that catches a duplicate landmark here is a strict
`getByRole("main")` locator** — which is what made `test:e2e:real` red
(`a11y.spec.ts:39` resolving to 2 elements) and what `fde119d` asserts. That is
worth knowing before anyone reaches for axe the next time a landmark question
comes up.

(The `color-contrast:serious` in the WCAG column is the known sidebar
false-positive `a11y.spec.ts` documents and filters — axe cannot composite a
background through the sticky dark sidebar. It is not new and not related.)

### 17.7 Where the suite stands after this round

| | first measured | after §17.1 and §17.2 |
|---|---|---|
| passed | 30 | **39** |
| failed | 12 | **3** |
| did not run | 1 | 1 |

The three that remain are `a11y` print media and `project-isolation` (both R3)
and `real-vertical-chains` (R1). **Every failure that engineering could close is
closed; what is left is exactly the two open Owner decisions.**

### 17.8 What this changes for the Owner

Two of the five causes (§17.1, §17.2) are accessibility defects on **Overview
and Sources — the two surfaces N-1 freezes as the accepted house standard**.
They were invisible because the suite that catches them had never been run. Two
more (§17.3, §17.4) are R1 and R3, which were already open but were understood
as missing capabilities; §17.4 shows R3 also left a live defect on every
screen's print output. Only one was a test problem, and it is fixed.

**No product file was changed in this section's work, and no assertion was
weakened.**

---

## 18. `restore:drill` is red on this workstation, and the reason is not the code

The final gate sweep on 2026-07-26 had `pnpm restore:drill` fail with
`type=postgres_process code=PG_TOOL_EXIT_NONZERO tool=pg_restore exit_code=1`
and nothing else. It is **not** a regression from anything in this branch, and
the diagnosis is recorded here so the next person does not repeat it.

**Cause: client/server version skew.** Reproduced by hand outside the script —
`pg_dump --format=custom` then `pg_restore --exit-on-error` — which prints what
the drill does not:

```
pg_restore: error: could not execute query: ERROR:  unrecognized configuration
parameter "transaction_timeout"
Command was: SET transaction_timeout = 0;
```

`transaction_timeout` arrived in PostgreSQL 17. This machine resolves
`pg_dump`/`pg_restore` from `/opt/homebrew/opt/libpq/bin` at **18.3**, while the
server is **16.12**, so the dump carries a `SET` the server cannot parse.
Nothing in the repository is involved.

**Confirmed by fixing only the environment**: re-running with
`/opt/homebrew/opt/postgresql@16/bin` ahead on `PATH` gives `Restore drill
passed`. The script also already supports pinning the client directly —
`RESTORE_DRILL_PG_BIN` takes an absolute bin directory (`:581`). CI is unaffected:
its `database` job pairs the `postgres:16` service with the client its own step
installs.

### 18.1 A fix was written for the silence, and the script's own tests were right to reject it

The obvious complaint is that the gate failed without saying why. That was
acted on — stderr captured, bounded, redacted, surfaced in both the evidence
file and the console — and `pnpm restore:drill:test` immediately went red on
`scripts/backup-restore-drill.test.mjs:1220`, "CLI failure output contains only
fixed process classification", whose sentinel is literally
`CLI_RAW_STDERR_MUST_NOT_ESCAPE`.

**The change was reverted in full rather than the test adjusted.** Discarding
raw tool stderr is not an oversight in this script, it is a deliberate hardening
with four sentinels guarding it, and `:992` shows what against — that test feeds
in `# hostile markdown` and ANSI escapes alongside its sentinel. The drill's
evidence is Markdown and JSON **uploaded as a CI artifact**; letting an external
tool's stderr through would let it forge headings and inject control characters
into that artifact. The fixed classification vocabulary is the point.

The generalisable lesson, and the reason this subsection exists: **before
treating silence as a defect, check whether the silence is guarded.** Four tests
said it was, in under a minute, and they were correct.

If the diagnosis gap is ever worth closing, the design-respecting shape is a
new *enumerated* classification — a preflight comparing client and server
versions that fails as, say, `PG_CLIENT_SERVER_SKEW` — never raw text. That is
recorded as an option, not a recommendation; the gate is not red in CI.

---

## 19. Two reports that could not see what they were for

Both found by the same question — *what would this check fail to notice?* — and
both are the shape §12 (D9) opened: a green surface over an unmeasured one.

### 19.1 `coverage:unit-gaps` was blind to files no unit test imports

The script's own header says the merged branch gate "hides 'this file has no
unit test at all'" and that the files it lists "are that hidden fact". They were
not. Vitest 4 reports only the files a run loads unless `coverage.include`
declares the universe, so a module **no unit test imports** was absent from the
report's input rather than present at 0%. The one case the report exists to
surface was the one case it structurally could not.

Measured before and after declaring the universe (`6e8bf7b`):

| | before | after |
|---|---|---|
| files at or below 30% unit branch coverage | 17 | **36** |
| of those, never reached by any unit test | 2 | **21** |

Newly visible and worth naming: `apps/worker/src/content-shadow/run-content-shadow.ts`
at **0/151** — Slice 2's own worker entry point — `source-connect.ts` at 0/125,
and `opportunities.ts` at 0/49. Integration and e2e reach several of these; the
report's question is narrower and now answerable.

`**/*.tsx` is deliberately out of the universe: Playwright covers client
components by design, and listing each at 0% would bury the modules where a
missing unit test is a real gap. **The gate is untouched** — only the flags of
the separate non-blocking run changed, so `test:coverage` measures what it did
before.

Two traps here, one of which caught this round first: a CLI `--coverage.exclude`
**replaces** the config array rather than merging, so the first attempt admitted
`__tests__` helper modules — test code counted as untested product code. And the
printed list is capped at 30 rows with the cap **stated**, because a truncated
list that reads as complete is a smaller version of the same defect.

### 19.2 `_compatibility-route.ts` had no test of any kind (`ea23797`)

The four compatibility routes — `/plan`, `/studio`, `/diagnosis`, `/report` —
do nothing but call this module and `redirect()`. It appeared in no `*.test.ts`
in the repository, and its failure mode is silent: a dropped query parameter or
an untranslated legacy vocabulary value still redirects to a real screen, just
not the one the link named. Nobody sees an error; the operator arrives somewhere
else.

Sixteen cases now cover the three exported functions, including the rule its
docstring states outright — the canonical key wins when a client supplied both
spellings, and the legacy one does not survive alongside it. Mutation-checked
three ways, each reddening exactly one case.

**This is also why §17.5's SCREENS correction mattered beyond naming**: coverage
of Growth Map, Execution and Results ran *through* these redirects, so a silent
break here would have moved the a11y scans to the wrong screens without a single
test going red.

### 19.3 The first thing §19.1 made visible was a query that had never run (`f8d860a`)

`TopicClusterReadRepository` came out of Task 3 with **no caller anywhere in the
product** — `packages/db/src/index.ts` re-exports it, nothing imports it — and
no test of any kind. It appeared at 0/13 branches, never reached, only once the
report could see files no unit test imports.

`listSupportingFindings` is a hand-written statement with three left joins, a
`distinct` and five predicates. **SQL does not typecheck.** A wrong column or a
renamed table would have been caught by nothing until someone wired it up in a
later slice, and the package exports it either way.

It now runs. The first case executes it against the migrated schema and needs no
seeded rows — Postgres resolves every identifier while parsing and planning, so
an empty result is the proof. The rest are the bounds the repository declares
before reaching the executor. Mutation-checked three ways; renaming one selected
column, the exact defect nothing else could see, reddens the cases that reach
the database.

This does not make the repository live. Whether Task 3's read model is finished
or removed is still open — see the Task 3 entry. What changed is that the code
shipping from `@sf/db` today has at least been executed once.

**The rest of the list was triaged, and `topic-clusters` was the only one of its
kind.** Every other never-reached file has a caller and a test of some sort —
`run-content-shadow.ts` has an integration suite, `source-connect.ts`,
`opportunities.ts` and `content-shadow-review.ts` have route or integration
tests, and `hooks-studio.ts`, `hooks-audit.ts` and `hooks-content-shadow.ts` are
TanStack Query modules with real importers, exercised through the UI by
Playwright. That is a materially different situation from raw SQL that had never
been parsed, so they are recorded rather than acted on. **Checked, not
assumed**: an earlier draft of this paragraph asserted the hooks were
UI-exercised before their importers had been looked up.

### 19.4 The triage turned up one more capability nobody can reach

`GET /api/mvp/projects/{projectId}/workspace` accepts
`view ∈ {overview, plan, studio, report}` — both in its own allowlist
(`workspace/route.ts:11`) and in `openapi/mvp.yaml:312`. Three of those four are
**the removed screens**: `plan`, `studio` and `report` have been `redirect()`
pages since Slice 1. The aggregate read model still advertises, and still
serves, views for screens the product deleted. That is §14.8's R2/R3 pattern one
layer down, at the contract rather than the UI.

Underneath it the union has drifted the other way. `WorkspaceViewName`
(`workspace-view.ts:45`) carries **five** values — the four above plus
`execution` — and the service has a `case "execution"` branch at `:666`. The
route's allowlist is typed `readonly WorkspaceViewName[]`, which does not
require exhaustiveness, so nothing flagged the omission: **the `execution`
branch cannot be reached through HTTP at all**, because the allowlist rejects
the value before the service sees it and the OpenAPI enum never offered it.

**Not a live defect, and that was verified rather than assumed.** The only
client is `buildWorkspaceViewQueryOptions` (`hooks.ts:110`), whose parameter is
typed `view: "overview" = "overview"` — it cannot ask for anything else, so no
request 400s in production today.

Left as a finding rather than acted on, because both directions are decisions
rather than repairs: adding `execution` to the allowlist and the enum is
contract tax **and** makes a new surface reachable, while deleting the branch
throws away work that was presumably meant to back the Execution screen. It
belongs with R2/R3 — same question, same answer needed.

**What was done about it: the allowlist is pinned (`3e9d2b4`).** `workspace/route.ts`
was one of **nineteen** `route.ts` files with no colocated test — the earlier
"twenty" in this paragraph was an estimate, the counted figure is 19 of 47 — so
nothing recorded what it accepts. Ten cases now do, and they take no position on
the decision: adding `execution` to the allowlist reddens the case documenting
its unreachability, removing `plan` reddens the case documenting that it is
still served. Whichever way this resolves, it arrives as a failing test rather
than as a silent change of API surface.

Writing them corrected two assumptions about this codebase's conventions, which
is most of the argument for having written them at all: `VALIDATION_ERROR` is
**422**, not the conventional 400, and a malformed project id answers **404**
rather than a validation error — deliberate, per `validate.ts:408`, "an invalid
id is treated as not-found (no existence leak)". That one is now asserted *with
its reason*, so it is not later "fixed" into a 422 that would hand an
unauthenticated prober the difference between a bad id shape and a project that
exists.
