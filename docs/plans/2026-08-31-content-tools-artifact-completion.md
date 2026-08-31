# Content Tools Artifact Completion Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring Content Brief and Content Draft to the supplied Artifact's product standard, including reliable useful generation, successful/partial/failed result UX, source-honest statistics, real handoffs/exports, and verified Marketing production delivery.

**Architecture:** Retain the existing versioned Brief/confirmed Brief/Draft contracts, Luna configuration and evidence/identity gates. Derive presentation statistics from frozen observed evidence independently of model success. Use a compact, balanced evidence prompt with explicit omission accounting to reduce avoidable generation latency; validate actual outputs on the saved birth-chart case. Keep source observations distinct from model recommendations. Result UI follows the Artifact's compact editorial hierarchy in both site themes.

**Tech Stack:** Next 16.2, React 19, TypeScript, Vitest, isolated Playwright, Vercel Marketing, existing Azure Luna.

---

## Authority and accepted design

- User asks to implement to launch-ready quality, not to stop at a transport canary. Code changes, PR/merge and Marketing production release are authorized; external ChatGPT Pro collaboration is explicitly waived in favor of native independent review. No external source upload is authorized or performed.
- Artifact: `/Users/wzb/.codex/attachments/a961cb57-b41c-403a-8b96-f5faa2aaa122/pasted-text.txt`, SHA-256 `8d2a145047bbd83765d2120644f17826df82ca0939cb505d6fa5187922227cfa`, identical to the prior supplied reference. Its layouts and interactions are the target; mock counts, old schema names and overstated source-certainty statements are not real facts.
- Baseline: current main `977f0bc4f32bf8de453e059d3ddf444a7297bad0`, clean isolated worktree, branch `fix/content-tools-artifact-completion-20260831`. Preserve incoming Page Citability and GEO styling changes and all unrelated work.
- Do not change Product, Railway, database/migrations, Azure resource/model/configuration, authentication identity rules, quotas, CMS or publication behavior.

## Decisions

1. Preserve bounded synchronous operation initially and remove unnecessary prompt overhead/imbalanced prefix truncation. Compare measured real completion against the current 45-second run / 30-second model ceiling. Merely enlarging the timeout or hiding a failure is not the solution. If evidence requires a materially different run architecture, record it before changing the contract.
2. Keep frozen source data usable when generation fails: front-load the explicit failure cause and recovery control; retain observed length, source-derived page classifications, raw PAA and scoped GSC/owned evidence. Do not invent an outline, page decision or selected Q list from an unavailable model response.
3. Restore the Artifact's run header, strong page recommendation, field trio, immediately scannable question coverage/source rows, editable outline and handoff. Add p25/median/p75 with declared percentile method. Classify observed competitor formats by explicit rules and label the basis as heuristic, never a measured search-intent fact. Preserve unknowns and show plural candidate formats when no majority exists; keep the model's separate writing recommendation explicit.
4. Restore Draft's leading coverage assessment, collapsible chapter cards, readable source-tier markers/legend alongside claim labels, verification panel and clear export/handoff bar. Processing completion is not publication readiness. V2 settings should retain the Artifact's understandable product-mention choices.
5. Recovery is explicit and never automatic/billable on mount or settings changes. A return-to-settings action must not falsely promise model-only retry or silently overwrite edited input. Existing exact confirmation, stale-operation guards, input safety, one-time handoff and whole-previous section validation remain mandatory.

## Acceptance matrix

| ID | Requirement | Required evidence |
|---|---|---|
| A1 | Artifact hierarchy, proportions, source palette and editorial rhythm | Rendered desktop/mobile, English/Chinese, light/dark result inspection |
| A2 | Visible run time/budget and differentiated source/generation state | Unit + browser checks for success, partial, timeout and unavailable sources |
| A3 | Known observations survive model failure; unknown generated fields stay unknown | Failure fixture + birth-chart failure recovery UI with no invented Q/outline/decision |
| A4 | p25/median/p75 and multi-format distribution are honest and scope-bound | Pure tests for ties, unknowns, small samples, partial reads, duplicates and mixed language units |
| A5 | Question coverage/source evidence is immediately scannable | Rendered rows, honest denominator, keyboard-accessible source detail |
| A6 | Draft coverage is leading; sections collapse/expand; source and claim meanings remain distinct | Unit + real DOM interaction + screenshot checks |
| A7 | A meaningful birth-chart + profile/GSC input produces a useful source-bound Brief | Real Luna output, strict parser, content review and source linkage; timeout is a failure, not PASS |
| A8 | Other representative inputs and malformed/partial outputs remain safe | Focused regressions, at least one additional meaningful generation case and unavailable branch |
| A9 | Confirmed editing, cross-tab handoff, Draft prose/H3, one-section rerun and exports | Real browser, exact output/lineage checks, downloaded JSON/Markdown, no automatic publication/audit |
| A10 | Reviewed code is deployed exactly to Marketing without moving Product canonical origin | PR/head/merge tree, Vercel READY/aliases/bundles, both origin checks, scoped logs |

## Work packages and verification sequence

### Evidence-led refinement (2026-08-31)

- The initial 24 KiB soft latency target was rejected after measurement: it removed 46 of 60 saved page units (including input instructions and scientific limitations) while preserving 32 profile facts. Its minimum/fallback boundary was discontinuous. The candidate now preserves all evidence fitting the unchanged 48 KiB hard cap; relevance sampling is used only when that cap requires it.
- On the exact saved birth-chart source context, explicit Luna `reasoning_effort=none` was accepted by the configured Azure legacy Chat endpoint. Full-evidence response time was 12.6 seconds in one diagnostic call, but the result failed because an outline used a source ID that was not a selected question anchor. This is transport evidence, not content acceptance.
- V3's internal model protocol therefore groups questions inside their owning section. A strict adapter derives the existing public Q/outline mapping from that containment and then runs the unchanged full validator. V2 model protocol and all historical public shapes remain supported; there is no automatic retry, fabricated question, source substitution or relaxed acceptance.
- The page-plan prompt now requires an actual page-purpose match, not merely a matching GSC query; observed named-person/example pages must not be broadened into generic guides without evidence. Gap source rules now match the validator's universal competitor-only constraint. Prompt tests do not prove semantic model quality; real output review remains mandatory.
- Current main advanced to `82683994a290d8bb6428b0aae53163db820bdf1b` with dependency security and independent GEO changes. Integrate and re-verify these before release; do not overwrite their admission/readiness or localized-copy changes.

### 1. Freeze evidence and tests

- Save the exact `birth chart` failed context locally without credentials or public-commit customer data. Bind the run ID, source counts and prompt bytes; don't recrawl for model diagnostics.
- Add failing tests before behavior changes. Record RED independently from fixture setup failures.

### 2. Parallel UI and observation work

- Brief owner: `content-brief-v2-results.tsx`, editor/tool integration, scoped presentation CSS and related tests; only `tools.contentBrief.v2` translation keys.
- Draft owner: `content-draft-v2-results.tsx`, `content-draft-v2-workflow.tsx`, scoped CSS and related tests; only `tools.contentDraft.v2` translation keys.
- Observation owner: new pure `apps/marketing/src/lib/tools/content-brief-v2-observations.ts` and tests. Return typed unit-separated quantiles and explicit observed-page format counts/candidates/unknowns; no external reads.
- Root owns prompt/packing/model orchestration, integrations, directory indexes and acceptance/release records. Shared JSON catalogs must receive only surgical namespace-specific patches, never whole-file reformatting.

### 3. Generation reliability

- Measure current prompt composition on frozen input. Compact metadata that the model cannot act upon and retain real source text/provenance distinctions.
- Select evidence fairly across competitors and mandatory owned targets, preserve relevant headings/PAA and omission counts, rebuild valid source IDs, and self-parse the exact resulting context.
- Use deterministic unit oracles, then bounded direct model checks against the exact input/config; no unrelated model fallback, silent retry, parser weakening or fabricated source content.

### 4. Integration and release

- Run related units, typecheck/lint, secret/redaction gates, build and isolated browser cases after shared artifacts stop changing. Keep known baseline failures explicit, not rebaselined.
- Independently review contracts/evidence, UI/accessibility and final integration. Fix blockers before merge.
- Validate exact PR/head/base; merge only reviewed bytes. Verify Marketing deployment and independent Product canonical identity.
- Re-run real content and interaction acceptance on the final deployment. Mark the goal complete only when the entire matrix is proved; retain any missing/weak result as unfinished work.
