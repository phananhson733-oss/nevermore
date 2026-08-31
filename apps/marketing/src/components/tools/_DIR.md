# apps/marketing/src/components/tools

One line per module: what it reads, what it returns, where it sits. Update the line when the file's header comment changes.

本目录首个 `_DIR.md`（2026-08-30 随 ToolCard 无障碍修复新建），其它模块的行由各自作者补。

- `tool-card.tsx` — `ToolCard({ slug, title, description, category, locale, ctaLabel })`: shared card for the public Tools Hub. The outer Next `Link` keeps its existing locale-aware destination and visual card content while using the formal tool `title` as an explicit accessible name.
- `geo-brief.tsx` — preserves the legacy v1 renderer and reexports the shared v1.1 tool as the current entry.
- `geo-brief-shared-tool.tsx` — exact frozen/gap selectors, Artifact-order shared result, source/time/anchor disclosure and same-object Markdown/JSON/Draft handoff.
- `content-draft-tool.tsx` — shared SEO/GEO intake and same authenticated Draft endpoints; every browser entrance uses the versioned parser.
- `content-draft-intake.tsx` — shared brief identity, readiness and explicit carried-GEO-evidence verification notice.
- `content-draft-settings.tsx` — shared section selection; GEO direct-answer-only fact scope is labelled separately from SEO gap-angle scope.
- `content-draft-results.tsx` — common Draft result surface, including GEO-only exact provenance appendix.
- `content-draft-coverage-card.tsx` — the shared immutable must-answer list and server/model coverage results.
- `content-draft-doc.tsx` — authored sentence bytes plus separate deterministic source labels and annotation controls.
- `content-draft-handoff-bar.tsx` — same-result export; GEO published URLs go to T2 and SEO URLs to On-Page.
- `content-draft-markdown.ts` — unchanged SEO Markdown; GEO appends origin, evidence source/time and version anchors without altering sentence bytes.

- `daily-briefing-tool.tsx` — reads the saved GSC list, independently refreshes it on mount/focus or explicit retry, and preserves site-owned form/report state only while the selection remains granted.
- `daily-briefing-tool.test.tsx` — verifies report interactions and property refresh, empty-list recovery, retry, selection removal, concurrency, and Strict Mode cleanup.
