# Growth Opportunity Slice 1 — product stop gate (2026-07-21)

This is the Slice 1 product stop gate required by
`docs/plans/2026-07-21-unified-growth-opportunity-implementation.md` (Task 9,
Step 4) and the landing execution plan
`docs/plans/2026-07-24-slice1-landing-execution-plan.md` (§5 Definition of Done).

It records evidence for each required decision, states the gate decision, and
appends a non-normative Slice 2 re-entry brief. It adds no migration and no
task.

Branch `codex/unified-growth-opportunity-v03`; product `0.3.0`; runtime contract
`2026-07-21`; authority `authority/implementation-spec-v0.3/`; rule set
`mvp.rules.0.2.0` (11 canonical rules). Evidence below is the checked-in code and
the mock + integration proofs that exercise the four-entry vertical end to end.

---

## Required decisions

- [x] **Operators and a client can explain Growth Map without being taught the
  old seven-page model.**
  - Primary navigation is exactly four entries — Overview / Growth Map /
    Execution / Results (`_nav-model.ts` `PRIMARY_NAV_ITEMS`; i18n `nav.*`).
  - Legacy deep links stay safe as compatibility routes
    (`diagnosis → growth-map`, `plan`/`studio → execution`, `report → results`;
    `_compatibility-route.ts`).
  - Proof: `e2e/growth-map.mock.spec.ts` and
    `e2e/audit-technical-vertical.mock.spec.ts` assert exactly four primary nav
    links routing to the four canonical segments, in order.

- [x] **No Data is understood as missing coverage, not a zero score.**
  - Absent scalar metrics render `growthMap.noData` = "No data / 数据不足" via
    `MetricLedger`/`MetricValue`; audit-module coverage carries an explicit
    `no_data` state with a non-empty limitation and empty evidence
    (`packages/contracts/src/zod/audit.ts` `CoverageState`; audit-projection
    invariant: `no_data` ⇒ evidence/finding/provider/observedAt empty,
    limitations non-empty).
  - Proof: `e2e/audit-technical-vertical.mock.spec.ts` asserts the selected URL's
    Audit Evidence shows "No data" (no analytics coverage) rather than `0`.

- [x] **The default Growth Map is a multi-URL portfolio, and Audit Evidence /
  Opportunity Review remain understandable states of one selected object.**
  - Growth Map defaults to the `pages` object mode with a searchable multi-URL
    portfolio (`useGrowthMapUrls`), and the selected URL's Audit Evidence and
    Opportunity Review are two `data-detail-panel` sub-states of one URL detail —
    not competing top-level tabs (`_growth-map.tsx` `detailState`).
  - The same Finding target and Evidence IDs appear in both sub-states (one
    evidence chain).
  - Proof: both mock specs open the portfolio, select
    `https://example.test/customer-onboarding`, and assert the canonical Finding's
    target (`code[title]`) and Evidence ID are present in both the audit-evidence
    and opportunity-review panels; the audit-evidence panel exposes **no** Confirm
    control.

- [x] **Keyword and Competitor libraries show provenance and analysis scope
  without introducing separate primary navigation.**
  - Keyword and Competitor are second-level object modes inside Growth Map
    (`keywords` / `competitors`), reading `/audit/keywords` and
    `/audit/competitors` with source/observed-at/mapping and
    relation/analysis-scope/origin provenance (`hooks-growth-map.ts`;
    `_growth-map.tsx` `KeywordLibraryPane` / `CompetitorLibraryPane`). No new
    primary nav entry is added for Market/Keyword/Competitor/Blog/Publishing.
  - Provenance-and-scope behaviour is additionally proven by
    `e2e/product-profile.mock.spec.ts` (approved/candidate/excluded competitor
    review with analysis scope) and the four-entry nav assertions above.
  - Slice 1 note: the two new mock vertical specs drive the `pages` mode; the
    keyword/competitor subviews are covered by the existing product-profile and
    growth-map view-model tests rather than a new end-to-end walk.

- [x] **One measured Finding creates exactly one Action and one technical
  ticket.**
  - Confirming a reviewable Opportunity runs the existing Finding Review
    transaction on its single `primaryFindingId`; that transaction creates at
    most one canonical Action, and the rule projection fixes the Artifact type
    (`TECH-CANONICAL-002 → technical_ticket`,
    `packages/contracts/src/zod/opportunities.ts` `RULE_OPPORTUNITY_PROJECTION`).
  - Proof: `apps/web/src/lib/services/__tests__/technical-opportunity-vertical.integration.test.ts`
    (replay is idempotent; `countActionsForFinding === 1`; supporting Findings
    have zero Actions) and the Execution surface in both mock specs (exactly one
    "Technical ticket" delivery chain for the confirmed Action, while the related
    CTR and content Opportunities stay independently unconfirmed).

- [x] **Recheck compares two immutable runs and makes no outcome claim beyond
  its evidence.**
  - `createActionRecheck` opens a brand-new immutable run
    (`projection_version = "growth-audit-recheck.0.3.0"`) linked to the prior run,
    Action, target scope, and capability version, and never mutates the prior run
    (`apps/web/src/lib/services/action-recheck.ts`). Full-audit reads are isolated
    from recheck runs via `AuditRunsRepository.findLatestByProjectionVersion`
    (裁决 8 in the landing plan).
  - The Results contract carries only technical rule state
    (`verified | observed | insufficient_data`) plus direction
    (`resolved | unchanged | unknown`) and has no impact/lift/traffic/rank/revenue
    /AI-citation language (`packages/contracts/src/zod/recheck.ts`).
  - Proof: `apps/web/src/lib/services/__tests__/action-recheck.integration.test.ts`
    (a fresh run id and audit-run id, prior run preserved,
    `projection_version === "growth-audit-recheck.0.3.0"`) and
    `e2e/audit-technical-vertical.mock.spec.ts` (recheck returns a new run id that
    is not the prior run id; the Results surface shows a prior-vs-new comparison
    labelled "Technical condition verified" and its text contains none of
    traffic / revenue / ranking / citation / lift).

- [x] **No parallel Opportunity, content, Action, Artifact, or checkpoint
  lifecycle was introduced.**
  - Opportunity confirmation reuses the existing Finding Review transaction and
    `artifact_revisions` optimistic concurrency (409 `STALE_REVISION`); no new
    approval-event, checkpoint, or Opportunity table was added (裁决 3 and 8;
    `performance_checkpoints` is neither queried nor migrated). The Opportunity
    projection is strictly read-only and never writes an Action.
  - Proof: `git grep performance_checkpoints` finds no query/migration reference;
    the Task 7/8 file lists mark `finding-review.ts`, `artifacts.ts`,
    `run-artifact.ts`, and the three Artifact templates "Verify unchanged"; both
    mock specs record only the four expected mutations (one versioned audit run,
    one Finding confirmation, one artifact promotion to `ready`, one recheck) and
    no publish/CMS/Content-Shadow write.

---

## Decision

`accepted`

All seven decisions are evidenced by checked-in code plus the Slice 1 integration
and mock proofs. The technical opportunity vertical runs URL + ICP →
createGrowthAuditRun → Overview → Growth Map (Audit Evidence / Opportunity
Review) → Execution → recheck → Results with one Finding producing one Action and
one template-fixed technical ticket, and with no lift claim and no parallel
lifecycle. The full repository gate is green (see the landing execution plan's
verification set).

### Known Slice 1 simplifications (honest scope, not defects)

These are deliberate Slice 1 reductions recorded so Slice 2 re-entry starts from
an accurate baseline. None of them weakens the seven decisions above.

1. **Opportunity projection is not yet page-wired.** The `GrowthOpportunity`
   contract, `opportunities` service, and `hooks-opportunities` exist and are
   verified by their own unit tests, but no page renders `GrowthOpportunity`
   directly. Growth Map realises the "reviewable Opportunity" decision through
   Finding cards whose Confirm control appears only for `reviewableFindingIds`.
   The three related Opportunities on one URL are therefore three separately
   reviewable Finding cards, not three `GrowthOpportunity` cards.
2. **Candidate Opportunities are not populated.** The opportunities projection
   does not emit `CandidateOpportunity` rows for Observations without a measured
   Finding, and `supportingFindingIds` is always `[]`. The vertical E2E confirms
   only the canonical measured Finding; no fabricated candidate/supporting data
   was introduced to satisfy a test.
3. **Crawl-only audit ⇒ non-crawl modules report `no_data`.** A Slice 1 audit run
   freezes the latest crawl snapshot; audit modules that require GSC/GA4/CSV
   sources surface `no_data` coverage with limitations rather than a score.
4. **Recheck read isolation.** The recheck audit run uses
   `projection_version = "growth-audit-recheck.0.3.0"` and full-audit reads use
   `findLatestByProjectionVersion("growth-audit.0.3.0")`, so a recheck run cannot
   hijack the Overview / Opportunities / Audit projections.
5. **No dedicated on-page recheck or "mark done" affordance.** In Slice 1 the
   Results surface is read-only and the Execution surface has no recheck button;
   work is completed by promoting the Artifact to `ready` in the existing Studio
   editor. The vertical E2E drives `createActionRecheck` and the artifact
   promotion against the same endpoints the app hooks call, since no user-visible
   control exists yet.

### Post-acceptance regression register

Defects found after this gate was accepted, recorded here because each one
changes what a reviewer can actually do with a surface this gate accepted.

**R1 — [fixed 2026-07-26] Growth Map lost the Diagnosis evidence keyboard
contract.**

Slice 1 replaced the Diagnosis screen with Growth Map and pointed
`/p/{projectId}/diagnosis` at it, but the evidence disclosure was rebuilt as a
bare `<details>/<summary>`: no Escape handling, no focus management, no
`aria-expanded`. The contract the retired screen owned — asserted for Diagnosis
by `e2e/real-vertical-chains.spec.ts` — was that Enter opens a `role="dialog"`,
Escape closes it, focus returns to the exact trigger, and `aria-expanded` flips.
A keyboard-only reviewer could open the Growth Map disclosure but had no
equivalent way to leave it, and assistive technology was never told the
trigger's state. The whole `diagnosis/_*.tsx` tree is now orphaned, so nothing
else carried the contract.

- **Fix.**
  `apps/web/src/app/p/[projectId]/growth-map/_evidence-refs-disclosure.tsx`
  keeps the `<details>/<summary>` rendering and adds behavior and ARIA only:
  `aria-expanded` on the trigger, a `role="dialog"` region labelled by the
  trigger, focus moved into the dialog on open, Escape to close, and focus
  returned to the exact trigger element that opened it.
- **Guard.** `e2e/growth-map.mock.spec.ts` — "evidence disclosure opens on
  Enter, closes on Escape, and returns focus". Mutation-tested on darwin:
  removing the Escape handling, removing the focus return, and pinning
  `aria-expanded` each turn the guard red, so none of the three clauses is
  uncovered.
- **Visual parity (structural).** The diff contains no `*.css` or
  `*.module.css` file, no added / removed / changed `className`, and no inline
  `style`. Every changed line is behavior or ARIA.
- **Visual parity (measured, darwin only).** Pre-change and post-change
  screenshots of the Finding card, the Audit Evidence panel, and the full Growth
  Map page at 1440x900 and 390x844 are identical at `threshold: 0,
  maxDiffPixels: 0` in both the closed and the pointer-opened state.
- **Not verified on linux.** That pixel comparison was produced on darwin only;
  this machine cannot produce a linux baseline, and no linux baseline was
  regenerated or overwritten. The linux rendering of this change is
  **unverified** and has to be confirmed by CI.
- **Residual (accepted).** Opening the disclosure with the keyboard now paints
  the application's standard `:focus-visible` ring (`globals.css`) on the
  evidence region instead of on the trigger, because focus moves into the
  dialog. Measured as a 2996-pixel difference (0.03 of the card) in the
  keyboard-opened state only; layout is byte-identical. This is the required
  visible focus indicator following focus — no style rule was added or changed.

---

## Slice 2 re-entry brief (non-normative)

The following names a future target story and its acceptance questions only. It
adds no migration and no task. A new
`2026-XX-XX-seo-geo-content-shadow-implementation.md` may be written only after a
product owner accepts this stop gate.

```text
one test project
+ one explicit competitor set
+ one SearchQuery cluster
+ one independent GenerativeQuery set
+ existing-page-first decision
→ one canonical content-related Finding
→ one Action
→ one content_brief
→ pinned Flow Shadow research/draft/QA
→ human side-by-side review
→ no CMS write
```

Acceptance questions to answer before Slice 2 implementation begins:

- Does surfacing `CandidateOpportunity` rows (with `supportingFindingIds`
  populated) clarify or crowd the Opportunity Review, given Slice 1 chose to show
  Findings directly?
- Can a content demand-gap Finding reach exactly one `content_brief` without
  introducing a second confirmation path or a parallel content lifecycle?
- How is Flow Shadow research/draft/QA pinned to immutable inputs so a
  side-by-side human review stays reproducible, still with no CMS write?
