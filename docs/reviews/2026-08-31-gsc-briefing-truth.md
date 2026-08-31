# GSC Daily Briefing truth and freshness repair

## Scope and state

Baseline: `8ce02d2fe31f89addef50f827abad41b8baad60f`.
Candidate branch: `fix/gsc-briefing-truth-20260831`.
Scope: Marketing Daily Search Briefing and its shared Search Analytics measurement parser. No database, Product deployment, model call, credential or production configuration change.

The validation below records the local candidate before release. After reviewing these results, the user explicitly authorized the current task's external Pro review exemption, commit, push, PR and Marketing-only deployment. External source upload was not performed. Native independent review is recorded below and must not be described as external Pro review. Release reconciliation and deployed-state evidence are recorded separately.

## Findings confirmed on the actual GSC website

The user supplied two discrepancies; the existing signed-in GSC and GenGrowth pages were inspected without regenerating the original report or changing the user's original GSC tab.

- Hour-by-hour reconciliation found GSC totals of 1,634 clicks / 8,213 impressions. The old briefing included 16 matching hours totaling 1,316 / 6,670. The omitted first eight hours totaled exactly 318 / 1,543. Every overlapping hourly click and impression value matched. The browser displayed UTC+08:00; the briefing displayed PT offset -07:00.
- The disputed average position 4.0 was reproduced on GSC with the original August 21–27 dates, exact query and exact URL. The first inspection matched the old card's 261 clicks / 1,617 impressions / position 4.0. Query-only, without the page filter, showed 755 / 1,802 / position 2.0. Those are different metric populations. The old UI did not expose the dates and scope clearly.
- A later actual navigation using the new link helper still showed exact query, exact URL, Web search and average position 4.0; GSC had revised impressions to 1,620 while clicks remained 261. Rechecks are timestamped observations, not immutable provider totals.
- A newer August 24–30 query-only website check showed average position 1.8, further demonstrating why the latest available window must be explicit rather than silently retaining an older period.

Customer identifiers and search terms are intentionally not copied into this repository report. Their exact filters are available in the task's user-provided context and the inspected GSC pages. No cookies, tokens, browser storage or credentials were extracted.

## Repair

1. Hourly windows end at the newest valid returned hour, retaining 24 continuous hours and internal null gaps. Local-time labels show complete dates and offsets; raw timestamp keys remain in `time` elements. Daily charts end at the newest returned PT date.
2. The daily discovery read requests `all` through the current PT date. The observed latest date freezes the analysis windows. A dynamic prefix read completes the longest 90-day display window when reporting lags. The hourly read covers the API-supported ten-day range. No fixed three-day lag remains in this briefing.
3. Main query facts use `byProperty`; independent `byPage` query totals support page coverage/brand calculations. Date/hour response aggregation is verified. A query-wide movement never selects a single page as its optimization target.
4. Partial or missing reporting dates suppress comparative changes/actions. Current observations remain available, visibly provisional. Prior query evidence has separate observed, below-floor, not-observed, unavailable and not-compared states.
5. Before returning displayed subjects, a bounded exact-filter API read checks their current and applicable prior metrics. A mismatch or unavailable recheck removes the associated claim/action; the implementation never swaps in a new number under an old conclusion. Missing/malformed provider measurements are rejected rather than converted to zero.
6. Every evidence entry exposes the actual windows, metric scope, exact query/page filters, aggregation and GSC current/prior links. API verification is explicitly distinguished from a GSC website inspection. Formula estimates such as expected clicks are labeled as calculations, not GSC-returned facts; unsupported causal recommendations were removed.
7. Pending form inputs are locked, request generations reject stale responses, and payloads retain the submitted property. A late response from property A cannot appear with property B's identity or GSC links.

## Independent review and regressions

The independent reviewer reproduced and the implementation addressed:

- a prior-read failure rendered as absence;
- a below-floor prior count not being rechecked;
- query verification retaining an unverified page attribution;
- a nonempty dimension key accepted for an undimensioned total;
- incomplete rereads retaining comparative claims;
- verification failures counted as display-budget exclusions;
- the 90-day latest-date window missing unrequested prefix days.

Additional regressions cover no-date actions, a query movement assigned to a page whose own position remains unchanged, DST, future/malformed timestamps, internal gaps, and pending property changes. Tests use explicitly synthetic data; they do not claim to be production API snapshots.

## Validation and limitations

Final acceptance on the frozen candidate:

| Check | Result |
| --- | --- |
| Focused source, core, transport, UI and copy tests | 12 files / 524 tests passed |
| Full repository unit suite, final isolated run | 995 files passed, 1 failed; 15,390 tests passed, 1 pre-existing blog assertion failed |
| Marketing production build | Passed, 297 static pages generated |
| Marketing, Public Tools and Sources type checks | Passed |
| Touched-scope ESLint and diff whitespace check | Passed |
| Local standalone Daily Briefing browser tests | 3 passed; 0 skipped, unexpected or flaky |
| Documentation consistency | 14 tests passed |
| Secret scan and redaction checks | Scan passed; 75 related redaction tests passed |
| Final independent review | No new substantive findings; reported defects independently reproduced as closed |

Source fingerprint: `6b140805f8e96619ac2636e9e1993ddd00c44de1e67600151d4c2c5b070b1869` across 31 changed source/test files. Marketing build ID: `kxCjFEYX4lzcOtWDOGuSn`. File hashes are in `2026-08-31-gsc-briefing-truth-source-manifest.json`.

The final browser run is recorded in `/tmp/gsc-briefing-truth-e2e-final-20260831/report.json`; screenshots there are labeled synthetic. Final build and full-suite logs are `/tmp/gsc-briefing-truth-build-final-20260831.log` and `/tmp/gsc-briefing-truth-unit-acceptance-20260831.log`. An earlier concurrent build/test run also hit an unrelated 300 ms content-clustering performance threshold; that test passed on isolated rerun and in the final full suite, without changing its code or threshold.

- Marketing production build and local standalone browser checks are separate from production deployment.
- The browser suite uses sealed local fixture identity, a pure synthetic GSC client and intercepted API responses. External browser requests are blocked and checked. It proves local interaction and contract behavior, not live OAuth/provider access for the modified application.
- Actual GSC website checks above establish the reported source/scope issues and working exact-filter links. A hosted v10 run with real provider access still requires a separately authorized release/canary.
- In newest-data mode, a still-incomplete current period deliberately produces current observations rather than asserting a complete-period decline or first appearance. This is a safety boundary, not a claim that nothing changed.
- The original baseline has an unrelated failing blog inventory assertion: expected 80 English posts, actual 85. It was reproduced in a clean detached worktree at the exact baseline SHA; no blog-content file was modified here.
