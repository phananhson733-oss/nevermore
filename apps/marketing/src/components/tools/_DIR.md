# apps/marketing/src/components/tools

One line per module: what it reads, what it returns, where it sits. Update the line when the file's header comment changes.

- `content-draft-tool.tsx`, `.test.tsx` — separate SEO v1/shared GEO v1.1/confirmed SEO v2/v3 intake; legacy GEO report and unconfirmed-v2/v3 guidance, signed-out peek and successful-sign-in-only staging, exact payload cleanup and stale/unmount guards.
- `content-draft-intake.tsx` — version-aware paste/upload rejection and localized Content Brief Builder recovery entry, without inventing a convertible GEO document.
- `content-draft-v2-workflow.tsx`, `.test.tsx` — exact confirmed plan/settings/selection, readable received-plan summary and product-mention radios, session-first submission and full-previous rerun validation; successful result folds settings and receives focus, failures reopen controls without discarding the prior verified result.
- `content-draft-v2-results.tsx` — coverage-first quality assessment separate from processing status, collapsible H2/H3 prose and rerun controls, distinct source-tier/claim labels and verify list; exact JSON/Markdown with one confirmed related-links block; export receipts bind immutable result, confirmation, locale and latest action, not only the causal fingerprint.
- `content-draft-v2-presentation.module.css` — scoped Artifact editorial typography, section/coverage hierarchy and light/dark source tokens using existing site variables.
- `content-draft-v2-onpage.tsx`, `.test.tsx` — explicit user-entered published URL to same-origin On-Page popup, confirmed fingerprint and normalized base language; no auto-submit or assumed publication.
- `connected-tool-content.ts`, `content-v2-copy.test.ts` — bilingual acquisition copy reflects current supporting-scope/PAA research, confirmation, CJK length and whole-draft evidence semantics while naming legacy v1 separately.

本目录首个 `_DIR.md`（2026-08-30 随 ToolCard 无障碍修复新建），其它模块的行由各自作者补。

- `tool-card.tsx` — `ToolCard({ slug, title, description, category, locale, ctaLabel })`: shared card for the public Tools Hub. The outer Next `Link` keeps its existing locale-aware destination and visual card content while using the formal tool `title` as an explicit accessible name.
- `content-brief-tool.tsx` — session-first explicit v3 submission and full async v2/v3 response parsing; success collapses settings and focuses the result. Failure recovery focuses existing settings without submitting or discarding edits; obsolete validations cannot publish.
- `content-brief-v2-results.tsx` — v2/v3 Artifact result hierarchy: visible time/budget, explicit generation failure recovery, strong page plan, separate source observations and model judgments, question coverage/source rows and closed full receipts. Compact field cards keep counts/quantiles and version-specific heuristic labels visible while long methodology stays keyboard-accessible in native details; unavailable generation never invents a plan.
- `content-brief-v2-editor.tsx` — browser-local H2/H3 wording/order edits, stable O/Q mappings, explicit page decision and exact confirmed revisions; bounded JSON export and explicit version-2 Draft popup staging, invalidated by edits or unmount without clearing another payload.
- `content-brief-v2-fixture.ts`, `content-brief-v2-results.test.tsx` — independent source-backed synthetic v2 fixtures, exact-parser proof, edit/confirmation/export/race/near-byte-limit tests and EN/ZH copy checks.
- `content-brief-v3-fixture.ts` — synthetic confirmed v3 receipt for intake/admission regressions, with an actual bound SERP snapshot and strict parser/fingerprint checks; no provider evidence.
- `content-brief-results.tsx` — keyword/source summary, verdict, three fields, questions, outline, gap/links, writable-only Draft/JSON handoff and collapsed boundaries in Artifact order; unavailable SERP keeps actionable coverage-only copy.
- `content-brief-run-header.tsx` — compact keyword/time header; summary names actual read gaps and exact model/temperature/fingerprint values stay in closed native run details.
- `content-brief-evidence-coverage.tsx` — four compact source summaries and closed read/ledger details; unused optional sources are neutral, actual failures stay distinct, and full frozen evidence remains inspectable.
- `content-brief-field-cards.tsx` — intent/format/length values with original source semantics and denominators; rule/distribution details are closed by default.
- `content-brief-must-answer-list.tsx` — compact Q/coverage/source rows with immutable question references and closed source-heading/excerpt details.
- `content-brief-outline-list.tsx` — H2 sequence and frozen Q mappings stay visible with short source layers; full provenance and original O IDs remain in native details.
- `content-brief-gap-angle-card.tsx` — angle/rationale and checked-page counts remain visible; full model provenance and cited profile facts retain their derivation inside native details.
- `content-brief-links-cards.tsx` — owned URL, metrics and rationale/topic with short source layers; full original provenance remains inspectable inside native details.
- `content-brief-wont-say-footer.tsx` — all ten v1 capability boundaries retained inside a default-closed native disclosure after Draft/JSON handoff.
- `content-brief-presentation.module.css` — Brief-only 880px editorial rhythm, non-stretched compact fields, proportional format bars with neutral unknowns, responsive question rows and scoped paragraph sizing; uses existing Marketing theme/font tokens.
- `content-brief-presentation.test.tsx` — real EN/ZH component tests for Artifact order, default-closed full evidence, neutral unused sources, actual partial summaries, coverage-only guidance and preserved source semantics.
- `content-brief-provenance.test.tsx` — real EN/ZH Outline/Gap/Links tests for short visible source layers, complete closed evidence, immutable identities, native toggles and unchanged unavailable branches.
- `content-brief-tool.test.tsx` — session-first submission and real result rendering; success focuses the named result; reopening/editing preserves the frozen keyword; deferred failures and cancelled sign-in restore usable settings without another request.
- `geo-brief.tsx` — preserves the legacy v1 renderer and reexports the shared v1.1 tool as the current entry.
- `geo-brief-shared-tool.tsx` — exact frozen/gap selectors, Artifact-order shared result, source/time/anchor disclosure and same-object Markdown/JSON/Draft handoff.
- `content-draft-intake.tsx`, `.test.tsx` — shared brief identity; GEO structure-only/limited status from actual fact receipts and observed samples rather than legacy readiness, with exact server verification before quota explained.
- `content-draft-settings.tsx` — shared section selection; GEO direct-answer-only fact scope is labelled separately from SEO gap-angle scope.
- `content-draft-results.tsx` — common Draft result surface, including GEO-only exact provenance appendix.
- `content-draft-coverage-card.tsx` — the shared immutable must-answer list and server/model coverage results.
- `content-draft-doc.tsx` — authored sentence bytes plus separate deterministic source labels and annotation controls.
- `content-draft-handoff-bar.tsx` — same-result export; GEO published URLs go to T2 and SEO URLs to On-Page.
- `content-draft-markdown.ts` — unchanged SEO Markdown; GEO appends origin, evidence source/time and version anchors without altering sentence bytes.

- `daily-briefing-tool.tsx` — reads the saved GSC list, independently refreshes it on mount/focus or explicit retry, and preserves site-owned form/report state only while the selection remains granted.
- `daily-briefing-tool.test.tsx` — verifies report interactions and property refresh, empty-list recovery, retry, selection removal, concurrency, and Strict Mode cleanup.
- `page-citability-check.tsx`, `.test.tsx` — existing-site input/result styling, server-derived verdict/coverage, measured rule evidence and independently consented snapshot-bound AI review; copy and stale-response behavior retain the same report identity.
