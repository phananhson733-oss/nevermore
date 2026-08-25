# Competitor Keyword Gap Actionability v1.1 Verification

Date: 2026-08-25

Scope: `gengrowth.ai` Marketing tool only

Feature commit: `03baddf6`

Post-merge verification HEAD: `383ce108`

## Evidence boundary

- The browser run used a deterministic, production-shaped local fixture.
- It issued no DataForSEO, GSC, Supabase, database, credit, or LLM request.
- The fixture contained 100 rows: 5 `optimize_existing`, 5
  `review_existing_query`, and 90 `review_content_gap` rows.
- Ten rows carried positive first-party GSC observations; 90 were bounded
  sample misses. This matches the row shape of the sanitized production run
  used to drive the revision without copying its private keyword payload.

## Deterministic gates

After merging `origin/main`, including Daily Briefing watchlist PR #203:

- 15 focused unit files: 391 tests passed.
- Root TypeScript check: passed.
- Marketing production build: passed; 258 routes generated.
- Secret scan: passed; 75 redaction tests passed.
- Scoped ESLint for every changed TS/TSX file: passed.
- `verify:docs`, `verify:authority`, and `deploy:check`: passed.
- `git diff --check`: passed.

Known repository baselines outside this diff remain separately failing:

- `verify:spec`: pre-existing `package.json` authority-lock hash drift.
- `implementation:check`: pre-existing vendor hash drift for
  `packages/sources/src/crawl/parse-page.ts`.
- full Marketing lint: seven pre-existing errors in untouched Agent and
  On-Page files. Scoped lint for this change is green.

## Desktop browser acceptance

Viewport: 1920 × 902

- Result surface width: 1440px.
- Document horizontal overflow: 0px.
- Table wrapper: 1386px client width and 1386px scroll width; no desktop
  horizontal scroll remained.
- Table wrapper `tabIndex`: 0.
- Initial visible rows: 10 of 100.
- Filter counts: All 100, Optimize 5, Review existing 5, Review content gap
  90, Need evidence 0.
- Content-gap filter showed 10 rows and an exact 80-row remainder; expanding
  showed 90 rows; returning to All reset the table to 10 rows.
- Active filters exposed `aria-pressed=true`.

Computed typography:

- keyword: 15.5px / 19.375px, weight 600;
- GSC status: 12px / 16.2px;
- next-check copy: 13px / 18.85px.

The previous global-prose leak measured 17.44px / 30.52px in table paragraphs;
the result table now contains no paragraph elements and no longer inherits that
rule.

Representative compact GSC cell:

```text
有曝光 · 待提升
曝光 70 · 均位 21
页面归因充分 · astrologywiki.com/observed-page-1
```

## Mobile browser acceptance

Viewport: 390 × 844

- Result surface width: 358px.
- Document horizontal overflow: 0px.
- Table wrapper: 312px client width and 1080px scroll width.
- The horizontal region remained keyboard-focusable with `tabIndex=0`.
- Initial visible rows remained bounded to 10.

## Localization

- Chinese and English pages rendered their six localized headers.
- No literal `tools.competitorKeywordGap` message path appeared.
- English page title: `Competitor Keyword Gap Analysis — GenGrowth`.
- Chinese page title: `竞品关键词差距分析 — GenGrowth`.

## Independent review

- Contract/report review: no remaining Critical or Important finding after
  literal schema version, coverage aggregation, and clean-v2 fixes.
- UI/visual review: no remaining Critical or Important finding after property
  lineage, page-state, brand-token, compact GSC, and wide-result fixes.
- Integrated contract → handler → handoff → UI review: no remaining Critical
  or Important finding after exact-v2 response validation and accessibility
  fixes.
