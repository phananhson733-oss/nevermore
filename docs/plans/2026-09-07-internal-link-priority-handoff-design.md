# Internal Link Audit priority and AI handoff design

Date: 2026-09-07. Approved direction: use the report's existing priority rather than inventing a composite urgency score.

## Goal

Make the single-table audit easier to scan and make its single copy button lead capable code agents from evidence to verified repair, while preserving the crawler, API, evidence caveats, and one-button result design.

## Result ordering

Problem rows are ordered by the highest priority among their linked findings: P1, then P2, matching the current `InternalLinkAuditPriority` contract. Rows with the same highest priority retain their source order. Unmarked rows retain their source order and remain after all problem rows. Each problem row shows its highest priority as a compact badge before its existing finding labels.

The UI does not derive an urgency score from URL shape, inbound counts, impact, or confidence. Those values remain evidence rather than a new ranking model.

## AI handoff routing

The copied handoff starts with a required capability route. An AI with repository, terminal, and browser access enters Code Agent mode: it establishes repository state, verifies current source and production HTML, classifies each candidate as a confirmed site defect, confirmed audit defect, or still unverified, and repairs only confirmed defects with focused tests. It must not stop after restating the audit.

An AI without those capabilities enters Chatbot mode and returns a concise explanation of what was observed, the highest-priority candidates, and the exact missing evidence. It must not claim repair.

Sending the copied prompt authorizes scoped local investigation and repair of confirmed defects. It does not authorize deployment, destructive Git operations, or unrelated refactoring. The crawl evidence remains evidence, not proof of a particular code change. Existing unresolved-target and untrusted-site-data safeguards remain intact.

Every externally influenced string in the evidence sections is JSON encoded before interpolation. Website-controlled line breaks or Markdown headings therefore remain escaped data and cannot create a forged instruction section inside the copied prompt.

## Explanatory copy

The input card's explanatory area becomes a full-width vertical stack. The primary sentence uses 15 px body text with comfortable line height. A shorter operational line sits beneath it at 13.5 px. The two lines break at a semantic boundary instead of competing in a desktop two-column grid.

Chinese copy:

- `从公开 URL 开始，沿同源静态 HTML 链接抓取，并遵循 robots.txt。抓取事实可能由服务端临时缓存；不保存提交者身份或页面正文。`
- `无需登录 · 单次最多约 950 页 · 抓取最长约 4 分钟`

English follows the same information hierarchy and preserves the same operating boundary.

## Verification

Unit tests prove stable P1/P2 ordering, the executable capability-routing contract, and containment of adversarial website-controlled Markdown. Browser tests prove visible priority badges, mixed-finding retention, the single table/single copy button invariant, handoff output, explanatory typography, semantic stacking, accessible priority names, and responsive behavior without horizontal overflow. Marketing typecheck, lint, build, and the focused browser suite are required before completion.
