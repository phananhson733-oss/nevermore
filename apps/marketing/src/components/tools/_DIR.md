# apps/marketing/src/components/tools

One line per module: what it reads, what it returns, where it sits. Update the line when the file's header comment changes.

本目录首个 `_DIR.md`（2026-08-30 随 ToolCard 无障碍修复新建），其它模块的行由各自作者补。

- `tool-card.tsx` — `ToolCard({ slug, title, description, category, locale, ctaLabel })`: shared card for the public Tools Hub. The outer Next `Link` keeps its existing locale-aware destination and visual card content while using the formal tool `title` as an explicit accessible name.
- `content-brief-tool.tsx` — session-first explicit v2 submission and full async response parsing; success collapses settings and focuses the result. Failed reruns preserve the prior confirmed result, while obsolete validations cannot publish.
- `content-brief-v2-results.tsx` — actual v2 keyword/page plan, source strip, compact question table, observed length, owned-page evidence and closed complete run/context receipts; no fake v1 projection.
- `content-brief-v2-editor.tsx` — browser-local H2/H3 wording/order edits, stable O/Q mappings, explicit page decision and exact confirmed revisions; minified bounded JSON export, stale async guards and no implicit Draft navigation.
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
