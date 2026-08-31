# GSC Daily Briefing freshness and evidence repair

**Goal:** Make the briefing use the newest available Search Console observations, reconcile its totals with GSC, and make every displayed recommendation traceable to the correct entity and time window.

**Architecture:** Keep the existing Marketing / Public Tools boundary. Fetch current GSC daily and hourly data, freeze the latest observed window, and carry completeness independently of transport success. Use property aggregation for query facts and separate page aggregation for page coverage. Recheck displayed subjects with exact filters; show scope, dates, provenance and working GSC verification links. Do not infer a page's performance from a query-wide metric.

**Tech stack:** Existing TypeScript, React, next-intl, Vitest and Search Analytics transport. No new dependency, database, model call or external-write capability.

## Authority and permissions

- User authorized local bug fixes, newest available data, and real GSC website inspection for diagnosis and acceptance.
- Baseline: `8ce02d2fe31f89addef50f827abad41b8baad60f`, branch `fix/gsc-briefing-truth-20260831`, isolated clean worktree.
- Preserve all other working trees. Do not commit, push, publish, deploy, migrate or change credentials/configuration without separate authorization.
- No source/customer data upload to external ChatGPT Pro is authorized. That external review phase is not executed; native local implementation and independent review must not be described as external Pro review.
- Product provenance distinguishes official API reads/rechecks from actual website inspection. The application does not claim a browser visit occurred for every future run.

## Confirmed evidence

1. Existing 24-hour chart uses report completion as its end. In the inspected real report, its 16 included hours match GSC hour-for-hour. The eight excluded hours contain exactly the full numerical discrepancy. Keep customer identifiers and raw data out of this source-controlled plan.
2. The disputed exact query/page average position was reproduced in GSC using the report's original dates and exact filters. Query-only GSC totals use a different population. The existing UI fails to show these dates/scopes.
3. An independent local fixture demonstrates query-wide position movement being assigned to a page whose own position never changed. It also demonstrates actions emitted when all required date rows are missing.

## Implementation and verification

1. **Trend window:** Add failing tests for delayed latest data, continuous 24-hour windows, gaps, disorder, DST, future values and local-time labels. Anchor on latest usable data, not the clock, and retain actual raw timestamps in `time` elements. Daily charts retain explicit PT calendar dates.
2. **Freshness and attribution:** Fetch `date/all` through today before selecting the analysis window; fetch hourly data within the supported ten-day range. Every analysis attachment uses the same frozen dates and `all` state. Partial/missing dates suppress comparative change/actions, while current observations remain clearly provisional. Query facts use `byProperty`; separate `byPage` reads support page coverage. Query-wide metrics cannot select a page for an optimization action. Add the two reproduced regression cases before changing production logic.
3. **Exact evidence recheck:** Re-read displayed subjects with exact query/page filters and the same dates, aggregation and freshness. A failed or inconsistent recheck cannot retain an actionable claim. Do not replace a metric while keeping an old rule result. Record verified scope, filters, actual aggregation, original numbers and verification status.
4. **Visible evidence:** Show actual analysis dates, latest available date, read time, completeness, scope, and GSC links for the current and previous windows. Remove fixed-three-day and finalized-only claims. Recommendations say what to inspect and do not invent a cause such as missing internal links or weak content.
5. **Acceptance:** Run focused unit tests, touched-scope lint/typecheck, Marketing production build, independent review and local browser tests. On GSC itself verify exact link filters and relevant metric examples. Keep fixture tests, real GSC observations, local implementation and production deployment status separate.

## Baseline

`pnpm exec vitest run --project unit packages/public-tools/src/daily-briefing/report.test.ts packages/public-tools/src/daily-briefing/run.test.ts apps/marketing/src/components/tools/daily-briefing-results.test.tsx apps/marketing/src/components/tools/daily-briefing-tool.test.tsx`

Result before changes: 4 test files, 317 tests passed.
