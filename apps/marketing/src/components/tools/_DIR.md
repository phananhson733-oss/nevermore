# apps/marketing/src/components/tools

One line per module: what it reads, what it returns, where it sits. Update the line when the file's header comment changes.

- `ai-visibility-check.tsx`, `.test.tsx` — account website and exact frozen-input selection, Input/Result tabs, paid-run state, source refresh and owned report restoration; no automatic run from navigation.
- `ai-visibility-client.ts`, `ai-visibility-context.ts` — client wire validation and exact snapshot/source loading; a current Profile cannot fill historical evidence gaps.
- `ai-visibility-source.tsx`, `.test.tsx` — compact current/frozen complete Profile disclosures, measurement override labels, question previews and explicit source-review links.
- `ai-visibility-history.tsx` — latest account-owned checks and stable run-URL reopening, with historical summary-only evidence distinguished from complete V2 evidence.
- `ai-visibility-report/` — four prominent scoped metrics, engine/intent tables, evidence-backed gaps, answer/source disclosures, V1 summary compatibility and exports; missing or omitted evidence is never an absence claim.
- `ai-visibility-check-v2.tsx` — secondary untrusted local-file comparison, without provider work or account-run authority.
- `geo-kb-profile.tsx`, `geo-kb-profile-copy-review.tsx`, `geo-kb-frozen-copy.tsx` — complete read-only copied Profile, explicit version difference/adoption review and immutable frozen copy display.
- `geo-kb-measurement-review.tsx` — opt-in operational-field proposals and explicit bounded competitor selection, without saving, freezing or claiming source facts were verified.
- `geo-knowledge-base.tsx` — separate source-copy and operational GEO review with explicit save/freeze, stale-source recovery and language readiness.

- `content-draft-tool.tsx`, `.test.tsx` — separate SEO v1/shared GEO v1.1/confirmed SEO v2 intake; legacy GEO report and unconfirmed-v2 guidance, signed-out peek and successful-sign-in-only staging, exact payload cleanup and stale/unmount guards.
- `content-draft-intake.tsx` — version-aware paste/upload rejection and localized Content Brief Builder recovery entry, without inventing a convertible GEO document.
- `content-draft-v2-workflow.tsx`, `.test.tsx` — exact confirmed plan/settings/selection, session-first submission and full-previous rerun validation; successful result folds settings and receives focus, failures reopen controls without discarding the prior verified result.
- `content-draft-v2-results.tsx` — actual H2/H3 prose, all-question coverage, observed U/P evidence and verify list; minified JSON and whole-outline Markdown with one confirmed related-links block; export receipts bound to current fingerprint and latest action.
- `content-draft-v2-onpage.tsx`, `.test.tsx` — explicit user-entered published URL to same-origin On-Page popup, confirmed fingerprint and normalized base language; no auto-submit or assumed publication.
- `connected-tool-content.ts`, `content-v2-copy.test.ts` — bilingual acquisition copy reflects current supporting-scope/PAA research, confirmation, CJK length and whole-draft evidence semantics while naming legacy v1 separately.

本目录首个 `_DIR.md`（2026-08-30 随 ToolCard 无障碍修复新建），其它模块的行由各自作者补。

- `tool-card.tsx` — `ToolCard({ slug, title, description, category, locale, ctaLabel })`: shared card for the public Tools Hub. The outer Next `Link` keeps its existing locale-aware destination and visual card content while using the formal tool `title` as an explicit accessible name.
- `content-brief-tool.tsx` — session-first explicit v2 submission and full async response parsing; success collapses settings and focuses the result. Failed reruns preserve the prior confirmed result, while obsolete validations cannot publish.
- `content-brief-v2-results.tsx` — actual v2 keyword/page plan, source strip, compact question table, observed length, owned-page evidence and closed complete run/context receipts; no fake v1 projection.
- `content-brief-v2-editor.tsx` — browser-local H2/H3 wording/order edits, stable O/Q mappings, explicit page decision and exact confirmed revisions; bounded JSON export and explicit version-2 Draft popup staging, invalidated by edits or unmount without clearing another payload.
- `content-brief-v2-fixture.ts`, `content-brief-v2-results.test.tsx` — independent source-backed synthetic v2 fixtures, exact-parser proof, edit/confirmation/export/race/near-byte-limit tests and EN/ZH copy checks.
- `content-brief-results.tsx` — keyword/source summary, verdict, three fields, questions, outline, gap/links, writable-only Draft/JSON handoff and collapsed boundaries in Artifact order; unavailable SERP keeps actionable coverage-only copy.
- `content-brief-run-header.tsx` — compact keyword/time header; summary names actual read gaps and exact model/temperature/fingerprint values stay in closed native run details.
- `content-brief-evidence-coverage.tsx` — four compact source summaries and closed read/ledger details; unused optional sources are neutral, actual failures stay distinct, and full frozen evidence remains inspectable.
- `content-brief-field-cards.tsx` — intent/format/length values with original source semantics and denominators; rule/distribution details are closed by default.
- `content-brief-must-answer-list.tsx` — compact Q/coverage/source rows with immutable question references and closed source-heading/excerpt details.
- `content-brief-outline-list.tsx` — H2 sequence and frozen Q mappings stay visible with short source layers; full provenance and original O IDs remain in native details.
- `content-brief-gap-angle-card.tsx` — angle/rationale and checked-page counts remain visible; full model provenance and cited profile facts retain their derivation inside native details.
- `content-brief-links-cards.tsx` — owned URL, metrics and rationale/topic with short source layers; full original provenance remains inspectable inside native details.
- `content-brief-wont-say-footer.tsx` — all ten v1 capability boundaries retained inside a default-closed native disclosure after Draft/JSON handoff.
- `content-brief-presentation.module.css` — Brief-only 880px editorial rhythm, 14px field padding, responsive question rows and direct 11.5px evidence paragraph sizing; uses existing Marketing theme/font tokens.
- `content-brief-presentation.test.tsx` — real EN/ZH component tests for Artifact order, default-closed full evidence, neutral unused sources, actual partial summaries, coverage-only guidance and preserved source semantics.
- `content-brief-provenance.test.tsx` — real EN/ZH Outline/Gap/Links tests for short visible source layers, complete closed evidence, immutable identities, native toggles and unchanged unavailable branches.
- `content-brief-tool.test.tsx` — session-first submission and real result rendering; success focuses the named result; reopening/editing preserves the frozen keyword; deferred failures and cancelled sign-in restore usable settings without another request.
- `geo-brief.tsx` — preserves the legacy v1 renderer and reexports the shared v1.1 tool as the current entry.
- `geo-brief-shared-tool.tsx` — exact frozen/gap selectors, Artifact-order shared result, source/time/anchor disclosure and same-object Markdown/JSON/Draft handoff.
- `content-draft-intake.tsx` — shared brief identity, readiness and explicit carried-GEO-evidence verification notice.
- `content-draft-settings.tsx` — shared section selection; GEO direct-answer-only fact scope is labelled separately from SEO gap-angle scope.
- `content-draft-results.tsx` — common Draft result surface, including GEO-only exact provenance appendix.
- `content-draft-coverage-card.tsx` — the shared immutable must-answer list and server/model coverage results.
- `content-draft-doc.tsx` — authored sentence bytes plus separate deterministic source labels and annotation controls.
- `content-draft-handoff-bar.tsx` — same-result export; GEO published URLs go to T2 and SEO URLs to On-Page.
- `content-draft-markdown.ts` — unchanged SEO Markdown; GEO appends origin, evidence source/time and version anchors without altering sentence bytes.

- `daily-briefing-tool.tsx` — reads the saved GSC list, independently refreshes it on mount/focus or explicit retry, and preserves site-owned form/report state only while the selection remains granted.
- `daily-briefing-tool.test.tsx` — verifies report interactions and property refresh, empty-list recovery, retry, selection removal, concurrency, and Strict Mode cleanup.
