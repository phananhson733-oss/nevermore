# Content Brief Artifact consistency repair

## Authority and scope

- User objective: repair result presentation, Brief business logic, and product acceptance against the supplied Content Tools React Artifact; start with the Brief generator.
- Acceptance input: `/Users/wzb/.codex/attachments/738e0054-e42a-458a-9820-3938943f6849/pasted-text.txt`, especially Brief input/results. User re-supplied this on 2026-08-31 and explicitly requested frontend-design. Its 1,103 lines and SHA-256 `8d2a145047bbd83765d2120644f17826df82ca0939cb505d6fa5187922227cfa` exactly match the earlier attachment. Its mock counts are examples, not production evidence.
- Baseline: `807e2cdce85ed7e6cdde3016e3cfd178a0b45556` (`origin/main`, verified 2026-08-31).
- Worktree: branch `fix/content-brief-artifact-20260831`; unrelated dirty checkouts are preserved.
- Presentation design below was proposed in the audit and explicitly included in the user's repair objective. Business-contract choices were sent for confirmation on 2026-08-31 and are not silently treated as approved.
- Scope is Marketing Content Brief and its required Content Draft consumer integration. No Product App/CMS/database expansion, no GEO Brief coercion, and no report persistence.
- The user previously authorized code changes, PR creation/merge, and Marketing production release in this thread. Production canaries still need exact input and spending scope before execution. No external source upload or ChatGPT Pro delivery has been authorized or performed for this repair.

## Accepted presentation design

Use the current Marketing light/dark tokens and the Artifact's compact editorial hierarchy. Do not force a theme or replace the site's typography system.

Use the requested frontend-design skill within this existing visual authority: approximately 880px result width, compact question rows, three writing-summary fields, clear outline-to-question mapping, and a prominent page recommendation. Do not substitute the separate August 28 overview-card design for this Artifact.

1. A completed run collapses its input form under an accessible settings disclosure. It can be reopened without clearing the frozen result; submit remains the only paid action.
2. The result starts with the keyword, market/language, concrete availability summary, and page recommendation. Large debug cards must not precede the recommendation.
3. Keep intent/format/length, question rows, outline, and the next action compact. Question evidence stays inspectable, but does not dominate the list by default.
4. Model id, requested/effective temperature, token counts, fingerprint, provider row counts, and detailed read ledgers live in native, keyboard-accessible disclosures, closed by default. Keep exact values; do not hide evidence by deleting it.
5. A source with `reason: not_requested` displays a neutral “not used” state, not a red fetch-failure state. No “attempt count unknown” warning for a source that was not selected.
6. Partial-run summary describes the actual returned/truncated/failed/skipped lanes, not a generic list of possible causes. A complete GSC read with no primary match is distinct from unavailable GSC.
7. Fix the paragraph-size inheritance defect locally: explanatory paragraphs must not inherit the global marketing prose size by accident. Do not change global paragraph styling.
8. No page-level horizontal overflow at 390px; long domains, model ids and fingerprints remain readable inside disclosures. The desktop layout must not stretch every source summary to the height of the longest GSC paragraph.

## Business-contract proposal awaiting confirmation

Two implementation routes were considered: extend the existing v1 envelope, or introduce an explicit v2 while keeping the v1 parser intact. The proposed route is v2 because changing question provenance, editable headings, and rewrite plans invalidates v1 recomputation assumptions.

- PAA is retained from the existing SERP advanced response, without paid PAA expansion. It enters the actual question/outline/Draft coverage workflow with its own provenance; it is not a competitor-page coverage count or factual source.
- Semantic question selection uses frozen, bounded page/PAA material and filters template headings. Remove the combined three-page lexical-cluster and three-question outline gates. Never fabricate questions to fill a quota; absent usable evidence has an actionable empty state.
- Primary and supporting-query evidence are distinct, both considered in page ownership. Lack of an exact query match never proves absence of relevant pages or impossibility of self-competition.
- Rewrite recommendations consume bounded current-page content and produce explicit retain/add/rewrite instructions. Missing current-page evidence blocks the rewrite operation instead of silently producing a new-page plan.
- The user can edit outline wording and order, then confirm. Questions, their source bindings and observed evidence remain frozen. The entire Draft-affecting revision is re-fingerprinted; no hash is claimed to authenticate user-supplied data.
- Non-whitespace languages use a truthful language-appropriate length measure and can enter question/outline/writing stages. Changing only an allow-list is insufficient.
- Gap-angle and owned-page topic claims remain bounded to material actually read; source-id validity does not prove semantic support.
- Historical v1 JSON keeps its exact original validation semantics. GEO JSON gets a specific unsupported-document explanation, not a fabricated Content Brief wrapper.

The UI work is a first implementation step, not a substitute for these remaining requirements.

## Acceptance and evidence tiers

Baseline: 469/469 relevant unit tests passed on the unchanged reference bytes on 2026-08-31. This is regression evidence, not Artifact conformance.

Required before final completion:

- Fixed source samples with independent expected questions/actions: semantic paraphrases, template headings, PAA-only and mixed evidence, no GSC, supporting-only matches, update target fetched/unavailable, partial crawl, CJK input.
- Strict parser and causal-fingerprint tests for v1/v2, outline edits, invalid evidence refs, unrelated question mappings, forged coverage counts and reruns.
- Browser tests for actual computed typography, first-result hierarchy, disclosure interaction, neutral not-requested state, editing/reordering/confirmation, JSON export/import and Brief-to-Draft exact revision handoff.
- A real canary proving relevance, writability, editable outline and correct page-action delivery. HTTP 200 alone is insufficient.
- Independent spec and code-quality reviews, current checks, immutable merge/deploy identity, canonical Marketing acceptance and retained Product identity.

Do not mark the goal complete while business-contract implementation, real product acceptance, or release evidence remains open.
