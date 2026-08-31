# apps/marketing/src/components/tools

One line per module: what it reads, what it returns, where it sits. Update the line when the file's header comment changes.

本目录首个 `_DIR.md`（2026-08-30 随 ToolCard 无障碍修复新建），其它模块的行由各自作者补。

- `tool-card.tsx` — `ToolCard({ slug, title, description, category, locale, ctaLabel })`: shared card for the public Tools Hub. The outer Next `Link` keeps its existing locale-aware destination and visual card content while using the formal tool `title` as an explicit accessible name.

- `daily-briefing-tool.tsx` — reads the saved GSC list, independently refreshes it on mount/focus or explicit retry, and preserves site-owned form/report state only while the selection remains granted.
- `daily-briefing-tool.test.tsx` — verifies report interactions and property refresh, empty-list recovery, retry, selection removal, concurrency, and Strict Mode cleanup.
