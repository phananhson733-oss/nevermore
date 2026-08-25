# Competitor Keyword Gap v3 Verification

Date: 2026-08-25

Scope: `gengrowth.ai` Marketing tool, `packages/sources` DataForSEO client, `packages/public-tools/competitor-keyword-gap`

Branch: `feat/competitor-keyword-gap-v3-20260825` (PR #207), based on `origin/main` `9f0501fb`

Design: `docs/plans/2026-08-25-competitor-keyword-gap-v3-design.md`
Plan: `docs/plans/2026-08-25-competitor-keyword-gap-v3-implementation.md`
Audit that motivated it: https://claude.ai/code/artifact/fc49c189-fea2-4f07-a534-715923b73350

## Provider probe (before any code)

Two live `domain_intersection` calls, `semrush.com` vs `gengrowth.ai`, US/en,
`limit 10`, `filters [["first_domain_serp_element.rank_group","<=",20]]`:

| include_serp_info | task cost | items | total_count | max rank_group | serp_info |
|---|---|---|---|---|---|
| false | $0.0132 | 10 | 68,642 | 17 | null |
| true | $0.0132 | 10 | 68,642 | 17 | `serp_item_types ["organic"]`, `last_updated_time "2026-05-14 18:17:21 +00:00"` |

- The rank filter path is valid and enforced.
- `include_serp_info` does not change the response `cost` (0.012 + 10 x 0.00012 both ways).
- The volume-ordered head at rank <= 20 was a domain-profile page for another brand
  (`hanime` -> `semrush.com/website/hanime.tv/...`), which decided the `etv desc`
  ordering and the `competitor_domain_profile_page` pre-screen reason.

## Commits

```
cd3c3b37 feat(sources): bound and enrich the domain-intersection task
3af6c516 feat(public-tools): add competitor gap v3 contract and pre-screen policy
c2b06df3 fix(public-tools): derive competitor brand token from the registrable label
c232691f fix(public-tools): keep file-name keywords out of the pre-screen hostname lane
2cc43984 fix(public-tools): drop the pre-screen memo and align the v3 plan and design with the landed policy
35822818 fix(public-tools): label pre-screen heuristics honestly and ignore page files in the profile-page check
83352cf0 feat(public-tools): merge paid-for competitor fields and pre-screen into the gap report
f55f1cf4 feat(marketing): request the bounded competitor gap sample
7d614dc1 feat(marketing): validate the v3 competitor gap envelope
5773d1e2 feat(marketing): add competitor gap v3 copy
49e950f8 fix(marketing): reconcile competitor gap copy with the traffic estimate chip
4eeea6f1 feat(public-tools): export the competitor gap pre-screen reasons array
3870a58d fix(marketing): derive competitor gap pre-screen copy keys from the contract
b9c3ba6a feat(marketing): surface competitor pages, pre-screen bands, and sample rule
57a1c615 fix(marketing): reset the competitor gap band on lane change and split the results surface
a33ae41b fix(marketing): keep the competitor gap results surface to the task spec
c05a3fbd feat(marketing): copy competitor gap rows as a plan
e448fe6e fix(marketing): label every competitor gap plan field and carry run coverage
```

Each task was implemented by a fresh subagent and passed a spec-compliance review
and a code-quality review before the next task started (38 agents, 598 tool calls).
Task 2 needed a controller fix after four review rounds: the domain-profile-page
heuristic matched `/products/crm.html`, and heuristic reasons were labelled as
DFS estimates. Both are fixed in `35822818` and pinned by tests.

## Deterministic gates (at `e448fe6e`)

- `pnpm vitest run --project unit` over `packages/sources/src/dataforseo`,
  `packages/public-tools/src/competitor-keyword-gap`, the marketing handler,
  copy-plan, tool-handoff, `components/tools`, `i18n`, and `app/[locale]/tools`:
  **56 files, 906 tests passed**.
- Root `pnpm typecheck`: every package clean.
- Scoped ESLint over every changed `.ts/.tsx` in `apps/marketing`: clean.
  `@sf/sources` lint: clean. `@sf/public-tools` lint: 2 pre-existing errors in
  untouched `seo-audit/keyword-evidence/extract.test.ts` and `seo-audit/model.ts`.
- `pnpm --filter marketing build`: passed.
- `verify:docs`, `verify:authority`, `deploy:check`, `git diff --check`: passed.
- Known repository baselines outside this diff remain failing exactly as recorded
  in the 2026-08-25 v1.1 verification: `verify:spec` (`package.json` authority-lock
  hash drift) and `implementation:check` (vendor hash drift for
  `packages/sources/src/crawl/parse-page.ts`).

## Evidence boundaries kept

- `nextStep` and its four lanes are unchanged; the pre-screen never re-routes a
  GSC-observed row (pinned by "attaches a pre-screen to every row and never lets
  it change the GSC lane").
- Every new label names its source: `dfs_estimate`, `tool_heuristic`,
  "DFS snapshot {date}", "GSC measured". Nothing is called winnability.
- Provider URL/title are sanitised in `packages/sources` (http(s) only, no
  userinfo, bounded length); the surface re-checks with `safePageUrl` before
  rendering a link with `target="_blank" rel="noopener noreferrer"`.
- The copy plan keeps every provider/visitor value inside one fenced JSON block
  under `UNTRUSTED_DATA_NOTICE`; fixed headings are constants; 48KB byte budget.
- `avg_backlinks_info`, `competition_level`, `description`, `check_url` are not
  parsed.

## Cross-model review (codex)

`codex exec` (codex-cli 0.145.0, reasoning high) over the source diff
(tests and docs excluded, 154KB) with the repo readable. GATE: FAIL, two P1 and
four P2. Every finding was acted on in the follow-up commit:

| Finding | Action |
|---|---|
| [P1] `stretch` rendered as "可争取" (a winnability claim); KD >= 61 labelled "head term" although the rule never looks at volume | Band labels now describe inputs only: "Higher KD or page two" / "难度较高或第二页", "KD above 60, defer" / "难度 > 60，暂缓" |
| [P1] copy plan legend defined `dfs_snapshot` as a "provider SERP observation" | Legend now says "stored SERP snapshot dated by `updatedAt`, not an observation made in this run" (EN/ZH) |
| [P2] plan exported up to 20 rows while the collapsed table showed 10 | Button receives `visibleRows` plus `rowsNotShown`; collapsed rows are counted in `omittedRows`, never copied; test updated to cover collapsed and expanded |
| [P2] brand token false positives: ordinary-word brands, `foo.github.io` -> `github` | Platform-suffix list reads the customer label (`acme.github.io` -> `acme`, tested); ordinary-word brand collision stays a documented limitation of the visible, filterable skip lane |
| [P2] response accepted ranks to 100 and any row count while echoing `sampleRule` | `report.ts` drops rows above `maxCompetitorRank` and beyond `perCompetitorLimit` (tested: rank 21 and the third row of a two-row cap are excluded; `returnedRows` still reports what the provider sent) |
| [P2] malformed `serp_item_types` entries were dropped, so a junk-only list became a reported empty snapshot | `nullableStringList` returns `null` when any entry is malformed; test updated |

Re-run after the fixes: 56 files, 909 tests passed; root typecheck clean;
scoped eslint clean.

## Production run

_Pending; recorded below after merge._

## Deferred to PR B

- Top-N page-one SERP sampling (weakest site, forum result, live AI Overview)
  through the existing keyword-opportunity seams, with `deadlineAt` and a
  provider-cost guard wired into the handler first.
- Opportunity Finder handoff of selected keywords.
