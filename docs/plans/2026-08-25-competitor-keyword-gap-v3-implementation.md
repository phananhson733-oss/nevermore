# Competitor Keyword Gap v3 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the paid DataForSEO sample (rank-filtered, etv-ordered, cap 300, serp snapshot on), parse the fields that sample already pays for, add an orthogonal DFS pre-screen axis with a visible skip lane, expose a "copy rows as plan" export, and record GSC row counts — as contract `competitor_keyword_gap.v3`.

**Architecture:** Three layers change in dependency order. `packages/sources` (provider request bounds + parser fields) → `packages/public-tools/competitor-keyword-gap` (types v3, pure `pre-screen.ts`, report merge/sort) → `apps/marketing` (handler pass-through, response guard, i18n, results UI, copy-plan module). `nextStep` semantics are untouched; every new field is additive and labelled by its source.

**Tech Stack:** TypeScript (ESM, `.ts` imports), vitest (`--project unit`), React 19 + next-intl, Tailwind tokens, pnpm workspace.

**Design:** `docs/plans/2026-08-25-competitor-keyword-gap-v3-design.md`
**Audit:** https://claude.ai/code/artifact/fc49c189-fea2-4f07-a534-715923b73350

**Worktree:** `/Users/wzb/.config/superpowers/worktrees/signalframe-mvp-app/competitor-keyword-gap-v3-20260825` (branch `feat/competitor-keyword-gap-v3-20260825`, based on `origin/main` `9f0501fb`). `pnpm install` already done.

---

## Probe record (2026-08-25, before any code)

Two live `domain_intersection` calls, `semrush.com` vs `gengrowth.ai`, US/en, `limit 10`, `filters [["first_domain_serp_element.rank_group","<=",20]]`:

| include_serp_info | task cost | items | total_count | max rank_group | serp_info |
|---|---|---|---|---|---|
| false | $0.0132 | 10 | 68,642 | 17 | null |
| true | $0.0132 | 10 | 68,642 | 17 | `{serp_item_types:["organic"], last_updated_time:"2026-05-14 18:17:21 +00:00", se_results_count:7600000}` |

Conclusions that bind this plan:
- The `first_domain_serp_element.rank_group` filter path is valid and enforced.
- `include_serp_info` does not change the response `cost` (0.012 + 10 × 0.00012 both ways). Enable it by default.
- `first_domain_serp_element.url/title/etv`, `keyword_properties.core_keyword`, `keyword_info.search_volume_trend` are present on every item.
- `last_updated_time` is `YYYY-MM-DD HH:MM:SS +00:00`, not ISO. Parse leniently; provider format drift must yield `null`, never fail the competitor.
- The rank ≤ 20 pool is still huge (68k) and top-by-volume is dominated by domain-profile pages (`hanime` → `semrush.com/website/hanime.tv/...`). Therefore: order by `first_domain_serp_element.etv desc` (rank-weighted traffic), and the pre-screen gets a `competitor_domain_profile_page` reason.

## Repo rules that apply

- Never `git add -A`; add exact paths. Never `git checkout --` to restore in shared worktrees.
- The format hook may rewrite whole `.ts/.tsx` files: after each Edit run `git diff --stat` and confirm only intended files changed.
- Every `.ts` file starts with the three `// @input/@output/@pos` comment lines; keep them accurate.
- Run tests with `pnpm vitest run --project unit <file paths>` from the worktree root.
- Do not touch `apps/marketing/src/lib/tools/tool-handoff.ts`, `keyword-*.ts`, or anything under `packages/sources/src/crawl` (hash-locked).
- No emojis anywhere. No LLM calls. No new paid endpoints.

## File map

| File | Responsibility | Change |
|---|---|---|
| `packages/sources/src/dataforseo/client.ts` | DFS HTTP client | request bounds, task builder, row parser fields, URL/title/timestamp helpers |
| `packages/sources/src/dataforseo/domain-intersection.test.ts` | client contract tests | new expectations |
| `packages/public-tools/src/competitor-keyword-gap/types.ts` | public contract | v3 constants + types |
| `packages/public-tools/src/competitor-keyword-gap/pre-screen.ts` (new) | pure pre-screen policy | new |
| `packages/public-tools/src/competitor-keyword-gap/pre-screen.test.ts` (new) | policy tests | new |
| `packages/public-tools/src/competitor-keyword-gap/report.ts` | report merge/sort | new row/result fields, sort |
| `packages/public-tools/src/competitor-keyword-gap/report.test.ts` | report tests | update fixtures, add cases |
| `packages/public-tools/src/competitor-keyword-gap/index.ts` | barrel | export pre-screen |
| `apps/marketing/src/lib/tools/competitor-keyword-gap-handler.ts` | orchestration | request bounds, pass-through |
| `apps/marketing/src/lib/tools/competitor-keyword-gap-handler.test.ts` | handler tests | update |
| `apps/marketing/src/lib/tools/competitor-keyword-gap-copy-plan.ts` (new) | markdown plan export | new |
| `apps/marketing/src/lib/tools/competitor-keyword-gap-copy-plan.test.ts` (new) | export tests | new |
| `apps/marketing/src/components/tools/competitor-keyword-gap-tool.tsx` | response guard | v3 row/result guard |
| `apps/marketing/src/components/tools/competitor-keyword-gap-tool.test.tsx` | guard tests | update fixture |
| `apps/marketing/src/components/tools/competitor-keyword-gap-results.tsx` | results surface | links, chips, filters, actions, coverage, copy plan |
| `apps/marketing/src/components/tools/competitor-keyword-gap-results.test.tsx` | surface tests | update + add |
| `apps/marketing/src/i18n/messages/en.json`, `zh.json` | copy | new keys |
| `apps/marketing/src/i18n/messages.test.ts` | copy-shape guard | required paths |
| `apps/marketing/src/i18n/competitor-keyword-gap-messages.test.tsx` | real-catalog render | fixture v3 |
| `docs/reviews/2026-08-25-competitor-keyword-gap-v3-verification.md` (new) | evidence | end |

---

### Task 1: Provider client — typed request bounds, etv ordering, serp snapshot, paid-for fields

**Files:**
- Modify: `packages/sources/src/dataforseo/client.ts` (types ~L250-280, `normalizeDomainIntersectionRequest` ~L730-830, `parseDomainIntersectionRow` ~L1098-1167, `toDomainIntersectionProviderTask` ~L2602-2620)
- Test: `packages/sources/src/dataforseo/domain-intersection.test.ts`

- [ ] **Step 1: Write the failing tests**

In `domain-intersection.test.ts`:

(a) Change the first test's request to include the new bounds and update the expected provider task and projection:

```ts
const REQUEST: DataForSeoDomainIntersectionRequest = {
  target1: "competitor.example",
  target2: "site.example",
  locationCode: 2_840,
  languageCode: "en",
  intersections: false,
  limit: 100,
  maxFirstDomainRank: 20,
  includeSerpInfo: true,
};
```

Expected body becomes:

```ts
{
  target1: "competitor.example",
  target2: "site.example",
  location_code: 2_840,
  language_code: "en",
  intersections: false,
  item_types: ["organic"],
  include_clickstream_data: false,
  include_serp_info: true,
  filters: [["first_domain_serp_element.rank_group", "<=", 20]],
  order_by: [
    "first_domain_serp_element.etv,desc",
    "keyword_data.keyword_info.search_volume,desc",
  ],
  limit: 100,
  offset: 0,
}
```

Extend the fixture item in `successEnvelope` with:

```ts
keyword_info: {
  search_volume: 2_900,
  cpc: 7.25,
  search_volume_trend: { monthly: 5, quarterly: -3, yearly: 12 },
},
keyword_properties: { keyword_difficulty: 31, core_keyword: "approval workflow" },
serp_info: {
  serp_item_types: ["organic", "ai_overview"],
  last_updated_time: "2026-05-14 18:17:21 +00:00",
  se_results_count: 7_600_000,
  check_url: "https://www.google.com/search?q=must-not-cross",
},
avg_backlinks_info: { backlinks: 12.5, main_domain_rank: 640 },
first_domain_serp_element: {
  type: "organic",
  rank_group: 4,
  rank_absolute: 6,
  url: "https://competitor.example/approval-workflows",
  title: "Approval workflows that scale",
  etv: 812.4,
  description: "provider prose must-not-cross",
},
```

Expected row:

```ts
{
  keyword: "approval workflow software",
  searchVolume: 2_900,
  cpc: 7.25,
  keywordDifficulty: 31,
  providerIntent: "commercial",
  firstDomainRank: 4,
  secondDomainRank: null,
  firstDomainUrl: "https://competitor.example/approval-workflows",
  firstDomainTitle: "Approval workflows that scale",
  firstDomainEtv: 812.4,
  coreKeyword: "approval workflow",
  searchVolumeTrend: { monthly: 5, quarterly: -3, yearly: 12 },
  serpItemTypes: ["organic", "ai_overview"],
  serpUpdatedAt: "2026-05-14T18:17:21.000Z",
}
```

Replace the sanitisation assertion with:

```ts
expect(JSON.stringify(result)).not.toMatch(
  /authorization|credential|password|login|status_message|must-not-cross|check_url|avg_backlinks|description/i,
);
```

(b) Add a test "omits bounds it was not given and keeps the legacy task shape": request without `maxFirstDomainRank`/`includeSerpInfo` → body has no `filters` key, `include_serp_info: false`, same `order_by` as above.

(c) Add a test "drops unsafe or oversized competitor URLs and titles without failing the row": items with `url: "javascript:alert(1)"`, `url: "https://user:pw@competitor.example/x"`, a 3,000-char https URL, and a 500-char title built without whitespace (`"t".repeat(500)`) → `firstDomainUrl: null` for the first three, `firstDomainTitle` of exactly 200 chars. A non-string `url` (e.g. `42`) throws `SourceError` `INVALID_RESPONSE`.

(d) Add a test "treats an unparseable provider timestamp as silence": `last_updated_time: "yesterday"` → `serpUpdatedAt: null`; `serp_info: null` → `serpItemTypes: null, serpUpdatedAt: null`; `search_volume_trend: null` → `searchVolumeTrend: null`; `core_keyword: ""` → `coreKeyword: null`.

(e) Add a test "rejects invalid bounds": `maxFirstDomainRank: 0`, `maxFirstDomainRank: 101`, `maxFirstDomainRank: 1.5`, `includeSerpInfo: "yes"` each throw `SourceError` with code `INVALID_CONFIGURATION` before any fetch (fetchImpl must not be called).

Update the existing "preserves absent provider metrics and ranks as null" expectation to include the seven new fields as `null` (and `serpItemTypes: null`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run --project unit packages/sources/src/dataforseo/domain-intersection.test.ts`
Expected: FAIL (type errors on unknown request fields; body mismatch).

- [ ] **Step 3: Implement**

In `client.ts`:

```ts
/** Credential-free pairwise comparison input for one fixed Labs live task. */
export interface DataForSeoDomainIntersectionRequest {
  readonly target1: string;
  readonly target2: string;
  readonly locationCode?: number;
  readonly locationName?: string;
  readonly languageCode: string;
  readonly intersections: boolean;
  readonly limit: number;
  /**
   * Keep only items where target1's organic element sits at this rank_group or
   * better. Composed into the provider `filters` array here so no free-form
   * filter expression crosses this boundary.
   */
  readonly maxFirstDomainRank?: number;
  /** Ask for the provider's stored SERP snapshot per keyword (no price change: probe 2026-08-25). */
  readonly includeSerpInfo?: boolean;
}

export interface DataForSeoSearchVolumeTrend {
  readonly monthly: number | null;
  readonly quarterly: number | null;
  readonly yearly: number | null;
}

/** Sanitized facts retained from one domain-intersection keyword item. */
export interface DataForSeoDomainIntersectionRow {
  readonly keyword: string;
  readonly searchVolume: number | null;
  readonly cpc: number | null;
  readonly keywordDifficulty: number | null;
  readonly providerIntent: DataForSeoProviderSearchIntent | null;
  readonly firstDomainRank: number | null;
  readonly secondDomainRank: number | null;
  /** target1's ranking page; http(s) only, no userinfo, at most 2048 chars, else null. */
  readonly firstDomainUrl: string | null;
  /** Provider title of that page, trimmed to 200 chars. */
  readonly firstDomainTitle: string | null;
  /** Provider estimated monthly traffic to that page for this keyword. */
  readonly firstDomainEtv: number | null;
  readonly coreKeyword: string | null;
  readonly searchVolumeTrend: DataForSeoSearchVolumeTrend | null;
  /** Stored SERP snapshot element types; null when no snapshot was requested or reported. */
  readonly serpItemTypes: readonly string[] | null;
  /** ISO timestamp of that snapshot; null when absent or unparseable. */
  readonly serpUpdatedAt: string | null;
}
```

Constants near `MAX_DATAFORSEO_LIMIT`:

```ts
const MAX_DOMAIN_INTERSECTION_RANK = 100;
const MAX_PROVIDER_URL_CHARS = 2_048;
const MAX_PROVIDER_TITLE_CHARS = 200;
```

In `normalizeDomainIntersectionRequest`, after the `limit` check:

```ts
if (
  value.maxFirstDomainRank !== undefined &&
  (!Number.isSafeInteger(value.maxFirstDomainRank) ||
    value.maxFirstDomainRank < 1 ||
    value.maxFirstDomainRank > MAX_DOMAIN_INTERSECTION_RANK)
) {
  throw new SourceError(
    "INVALID_CONFIGURATION",
    `DataForSEO domain-intersection maxFirstDomainRank must be an integer from 1 to ${MAX_DOMAIN_INTERSECTION_RANK}.`,
  );
}
if (
  value.includeSerpInfo !== undefined &&
  typeof value.includeSerpInfo !== "boolean"
) {
  throw new SourceError(
    "INVALID_CONFIGURATION",
    "DataForSEO domain-intersection includeSerpInfo must be a boolean.",
  );
}
```

and carry both through `common` (`maxFirstDomainRank: value.maxFirstDomainRank`, `includeSerpInfo: value.includeSerpInfo ?? false`).

`toDomainIntersectionProviderTask`:

```ts
function toDomainIntersectionProviderTask(
  request: DataForSeoDomainIntersectionRequest,
): JsonRecord {
  const normalized = normalizeDomainIntersectionRequest(request);
  return {
    target1: normalized.target1,
    target2: normalized.target2,
    ...(normalized.locationCode !== undefined
      ? { location_code: normalized.locationCode }
      : { location_name: normalized.locationName }),
    language_code: normalized.languageCode,
    intersections: normalized.intersections,
    item_types: ["organic"],
    include_clickstream_data: false,
    include_serp_info: normalized.includeSerpInfo === true,
    ...(normalized.maxFirstDomainRank === undefined
      ? {}
      : {
          filters: [
            ["first_domain_serp_element.rank_group", "<=", normalized.maxFirstDomainRank],
          ],
        }),
    order_by: [
      "first_domain_serp_element.etv,desc",
      "keyword_data.keyword_info.search_volume,desc",
    ],
    limit: normalized.limit,
    offset: 0,
  };
}
```

Helpers (place next to `nullableString`):

```ts
/** A provider URL the surface may link to, or null. Drops rather than throws on unsafe shapes. */
function nullableSafeHttpUrl(value: unknown, context: string): string | null {
  const raw = nullableString(value, context);
  if (raw === null) return null;
  const candidate = raw.trim();
  if (candidate.length > MAX_PROVIDER_URL_CHARS) return null;
  try {
    const url = new URL(candidate);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === ""
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function nullableBoundedTitle(value: unknown, context: string): string | null {
  const raw = nullableString(value, context);
  if (raw === null) return null;
  const flat = raw.replace(/\s+/g, " ").trim();
  if (flat === "") return null;
  return flat.length > MAX_PROVIDER_TITLE_CHARS
    ? flat.slice(0, MAX_PROVIDER_TITLE_CHARS).trim()
    : flat;
}

/** Provider timestamps arrive as "YYYY-MM-DD HH:MM:SS +00:00"; anything unparseable is silence. */
function nullableProviderTimestamp(value: unknown, context: string): string | null {
  const raw = nullableString(value, context);
  if (raw === null) return null;
  const match = raw.trim().match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\s*([+-]\d{2}):?(\d{2})|Z)?$/,
  );
  if (match === null) return null;
  const offset =
    match[3] === undefined ? "Z" : `${match[3]}:${match[4]}`;
  const date = new Date(`${match[1]}T${match[2]}${offset}`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function nullableNumberOrNull(value: unknown, context: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SourceError("INVALID_RESPONSE", `${context} did not contain a finite number.`);
  }
  return value;
}

function nullableSearchVolumeTrend(
  value: unknown,
  context: string,
): DataForSeoSearchVolumeTrend | null {
  if (value === undefined || value === null) return null;
  const trend = asRecord(value, context);
  return {
    monthly: nullableNumberOrNull(trend.monthly, `${context}.monthly`),
    quarterly: nullableNumberOrNull(trend.quarterly, `${context}.quarterly`),
    yearly: nullableNumberOrNull(trend.yearly, `${context}.yearly`),
  };
}

function nullableStringList(value: unknown, context: string): readonly string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new SourceError("INVALID_RESPONSE", `${context} was not an array.`);
  }
  return value.flatMap((entry) =>
    typeof entry === "string" && entry.trim() !== "" ? [entry.trim().slice(0, 64)] : [],
  );
}
```

In `parseDomainIntersectionRow`, read `firstElement = item.first_domain_serp_element` as an optional record and `serpInfo = keywordData.serp_info` as an optional record; add to the returned object:

```ts
firstDomainUrl: firstElement === null ? null : nullableSafeHttpUrl(firstElement.url, `${ctx}.first_domain_serp_element.url`),
firstDomainTitle: firstElement === null ? null : nullableBoundedTitle(firstElement.title, `${ctx}.first_domain_serp_element.title`),
firstDomainEtv: firstElement === null ? null : nullableNonNegativeNumber(firstElement.etv, `${ctx}.first_domain_serp_element.etv`),
coreKeyword: nullableBoundedTitle(keywordProperties?.core_keyword, `${ctx}.core_keyword`),
searchVolumeTrend: nullableSearchVolumeTrend(keywordInfo?.search_volume_trend, `${ctx}.search_volume_trend`),
serpItemTypes: serpInfo === null ? null : nullableStringList(serpInfo.serp_item_types, `${ctx}.serp_info.serp_item_types`),
serpUpdatedAt: serpInfo === null ? null : nullableProviderTimestamp(serpInfo.last_updated_time, `${ctx}.serp_info.last_updated_time`),
```

(`ctx` = `DataForSEO domain-intersection item ${index}`.) Do NOT parse `avg_backlinks_info`, `description`, `check_url`, `competition_level`.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run --project unit packages/sources/src/dataforseo/domain-intersection.test.ts packages/sources/src/dataforseo`
Expected: PASS (all dataforseo tests, not only the intersection file).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @sf/sources typecheck` (if no such script, `pnpm typecheck`), then `git diff --stat`.
Commit: `git add packages/sources/src/dataforseo/client.ts packages/sources/src/dataforseo/domain-intersection.test.ts && git commit -m "feat(sources): bound and enrich the domain-intersection task"`

---

### Task 2: Public contract v3 and the pure pre-screen policy

**Files:**
- Modify: `packages/public-tools/src/competitor-keyword-gap/types.ts`
- Create: `packages/public-tools/src/competitor-keyword-gap/pre-screen.ts`
- Create: `packages/public-tools/src/competitor-keyword-gap/pre-screen.test.ts`
- Modify: `packages/public-tools/src/competitor-keyword-gap/index.ts`

- [ ] **Step 1: Write the failing pre-screen tests**

```ts
import { describe, expect, it } from "vitest";
import { preScreenCompetitorKeyword, competitorBrandTokens } from "./pre-screen.ts";

const METRIC = (value: number | null) =>
  value === null
    ? { availability: "provider_no_data" as const, value: null }
    : value === 0
      ? { availability: "explicit_zero" as const, value: 0 }
      : { availability: "available" as const, value };

function input(overrides: Partial<Parameters<typeof preScreenCompetitorKeyword>[0]> = {}) {
  return {
    keyword: "approval workflow software",
    keywordDifficulty: METRIC(28),
    searchVolume: METRIC(2_900),
    bestCompetitorRank: 4,
    providerIntent: "commercial",
    competitorPages: { "one.example": "https://one.example/approval-workflows" },
    competitorDomains: ["one.example", "two.example"],
    ...overrides,
  };
}

describe("preScreenCompetitorKeyword", () => {
  it("prioritises a low-KD term a competitor holds on page one", () => {
    expect(preScreenCompetitorKeyword(input())).toEqual({
      band: "prioritize_serp_check", basis: "dfs_estimate", reason: "kd_low_rank_top10",
    });
  });
  it("marks mid-KD or page-two terms as stretch", () => {
    expect(preScreenCompetitorKeyword(input({ keywordDifficulty: METRIC(45) })).band).toBe("stretch");
    expect(preScreenCompetitorKeyword(input({ bestCompetitorRank: 14 })).band).toBe("stretch");
    expect(preScreenCompetitorKeyword(input({ bestCompetitorRank: 14 })).reason).toBe("kd_mid_rank_top20");
  });
  it("defers KD above 60 as a head term", () => {
    expect(preScreenCompetitorKeyword(input({ keywordDifficulty: METRIC(61) }))).toEqual({
      band: "defer_head_term", basis: "dfs_estimate", reason: "kd_high",
    });
  });
  it("leaves rows without KD or volume unbanded rather than guessing", () => {
    expect(preScreenCompetitorKeyword(input({ keywordDifficulty: METRIC(null) })).reason).toBe("dfs_metric_missing");
    expect(preScreenCompetitorKeyword(input({ searchVolume: METRIC(null) })).band).toBe("unbanded");
    expect(preScreenCompetitorKeyword(input({ searchVolume: METRIC(0) })).band).toBe("prioritize_serp_check");
  });
  it("routes a competitor brand term to the skip lane unless it is comparative", () => {
    expect(preScreenCompetitorKeyword(input({ keyword: "one webmaster tools" })).reason).toBe("competitor_brand_token");
    expect(preScreenCompetitorKeyword(input({ keyword: "ONE.example login" })).band).toBe("defer_brand_navigational");
    expect(preScreenCompetitorKeyword(input({ keyword: "one alternatives" })).band).toBe("prioritize_serp_check");
    expect(preScreenCompetitorKeyword(input({ keyword: "two vs one" })).band).toBe("prioritize_serp_check");
    expect(preScreenCompetitorKeyword(input({ keyword: "one 替代" })).band).toBe("prioritize_serp_check");
  });
  it("routes a hostname-shaped keyword and a provider navigational intent to the skip lane", () => {
    expect(preScreenCompetitorKeyword(input({ keyword: "now.gg" })).reason).toBe("domain_like_keyword");
    expect(preScreenCompetitorKeyword(input({ providerIntent: "navigational" })).reason).toBe("provider_navigational_intent");
  });
  it("recognises a competitor domain-profile page as another brand's navigational term", () => {
    expect(
      preScreenCompetitorKeyword(
        input({ keyword: "hanime", competitorPages: { "one.example": "https://one.example/website/hanime.tv/overview/" } }),
      ),
    ).toEqual({ band: "defer_brand_navigational", basis: "dfs_estimate", reason: "competitor_domain_profile_page" });
    expect(
      preScreenCompetitorKeyword(
        input({ keyword: "approval software", competitorPages: { "one.example": "https://one.example/blog/approval-software-guide" } }),
      ).band,
    ).toBe("prioritize_serp_check");
  });
  it("does not let a short or generic-only label act as a brand token", () => {
    // "a.io" -> "a" is too short; "www.io" -> "www" is generic and "io" is too short.
    expect(competitorBrandTokens(["a.io", "www.io", "seo-tools.example"])).toEqual(["seo-tools"]);
    expect(competitorBrandTokens(["www.example.com"])).toEqual(["example"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project unit packages/public-tools/src/competitor-keyword-gap/pre-screen.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Add v3 types**

In `types.ts`:

```ts
export const COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION = "competitor_keyword_gap.v3";
export const COMPETITOR_KEYWORD_GAP_TOOL = "competitor_keyword_gap";
/** Server-owned per-competitor cap; billing is per returned row so the rank filter keeps runs cheap. */
export const COMPETITOR_KEYWORD_GAP_PROVIDER_LIMIT = 300;
export const COMPETITOR_KEYWORD_GAP_MAX_COMPETITOR_RANK = 20;
/** Pre-screen thresholds. KD is a band input only; it is never a filter and never called winnability. */
export const COMPETITOR_KEYWORD_GAP_KD_LOW_MAX = 30;
export const COMPETITOR_KEYWORD_GAP_KD_HEAD_MIN = 61;
export const COMPETITOR_KEYWORD_GAP_PAGE_ONE_RANK_MAX = 10;

export interface CompetitorKeywordGapSampleRule {
  readonly maxCompetitorRank: number;
  readonly perCompetitorLimit: number;
  readonly serpSnapshotRequested: boolean;
}

export interface CompetitorKeywordGapCompetitorPage {
  readonly url: string | null;
  readonly title: string | null;
  readonly etv: number | null;
}

export interface CompetitorKeywordGapSearchVolumeTrend {
  readonly monthly: number | null;
  readonly quarterly: number | null;
  readonly yearly: number | null;
}

export interface CompetitorKeywordGapSerpSnapshot {
  readonly itemTypes: readonly string[];
  readonly updatedAt: string | null;
}

export type CompetitorKeywordGapPreScreenBand =
  | "prioritize_serp_check"
  | "stretch"
  | "unbanded"
  | "defer_head_term"
  | "defer_brand_navigational";

export const COMPETITOR_KEYWORD_GAP_PRE_SCREEN_BANDS = [
  "prioritize_serp_check",
  "stretch",
  "unbanded",
  "defer_head_term",
  "defer_brand_navigational",
] as const satisfies readonly CompetitorKeywordGapPreScreenBand[];

export type CompetitorKeywordGapPreScreenReason =
  | "kd_low_rank_top10"
  | "kd_mid_rank_top20"
  | "kd_high"
  | "dfs_metric_missing"
  | "competitor_brand_token"
  | "competitor_domain_profile_page"
  | "domain_like_keyword"
  | "provider_navigational_intent";

export interface CompetitorKeywordGapPreScreen {
  readonly band: CompetitorKeywordGapPreScreenBand;
  readonly basis: "dfs_estimate";
  readonly reason: CompetitorKeywordGapPreScreenReason;
}
```

Extend `CompetitorKeywordGapRow` with `competitorPages`, `coreKeyword`, `searchVolumeTrend`, `serpSnapshot`, `preScreen` (as in the design doc) and rename `CompetitorKeywordGapResultV2` → `CompetitorKeywordGapResultV3` adding `sampleRule`, `gscQueryRowCount`, `gscQueryPageRowCount`. No alias is kept: grep the exact identifier `CompetitorKeywordGapResultV2` (five references: `types.ts`, `report.test.ts`, `competitor-keyword-gap-results.tsx`) and rename them in their own tasks. Do NOT touch `KeywordOpportunityResultV2` in `keyword-opportunity/`.

- [ ] **Step 4: Implement `pre-screen.ts`**

```ts
// @input  -- one merged gap row's DFS estimates, its competitor pages, and the requested competitor domains
// @output -- a deterministic pre-screen band with the single reason that decided it
// @pos    -- second, orthogonal axis next to the GSC-derived next step; an estimate, never winnability

import type {
  CompetitorKeywordGapMetric,
  CompetitorKeywordGapPreScreen,
} from "./types.ts";
import {
  COMPETITOR_KEYWORD_GAP_KD_HEAD_MIN,
  COMPETITOR_KEYWORD_GAP_KD_LOW_MAX,
  COMPETITOR_KEYWORD_GAP_PAGE_ONE_RANK_MAX,
} from "./types.ts";

export interface CompetitorKeywordGapPreScreenInput {
  readonly keyword: string;
  readonly keywordDifficulty: CompetitorKeywordGapMetric;
  readonly searchVolume: CompetitorKeywordGapMetric;
  readonly bestCompetitorRank: number;
  readonly providerIntent: string | null;
  /** Competitor domain -> ranking page URL (already sanitised), when known. */
  readonly competitorPages: Readonly<Record<string, string | null>>;
  readonly competitorDomains: readonly string[];
}

const GENERIC_LABELS = new Set(["www", "app", "site", "web", "blog", "shop", "home"]);
const COMPARATIVE_TOKENS = /\b(alternatives?|vs\.?|versus|competitors?|compare|comparison)\b|替代|对比|竞品|比较/i;
const HOSTNAME_SHAPE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

function normalizedKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The label a person would call the competitor by: `ahrefs` for `ahrefs.com`, `seo-tools` for `seo-tools.example`. */
export function competitorBrandTokens(domains: readonly string[]): readonly string[] {
  const tokens = new Set<string>();
  for (const domain of domains) {
    const labels = domain.toLowerCase().split(".").filter((label) => label !== "");
    const candidate = labels.find((label) => !GENERIC_LABELS.has(label));
    if (candidate !== undefined && candidate.length >= 3) tokens.add(candidate);
  }
  return [...tokens].toSorted();
}

function containsToken(keyword: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(keyword);
}

function isDomainProfilePage(keyword: string, pages: Readonly<Record<string, string | null>>): boolean {
  const compact = keyword.replace(/\s+/g, "");
  if (compact.length < 3) return false;
  const escaped = compact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const needle = new RegExp(`/${escaped}\\.[a-z]{2,}(?:/|$)`, "i");
  return Object.values(pages).some((url) => {
    if (url === null) return false;
    try {
      return needle.test(new URL(url).pathname);
    } catch {
      return false;
    }
  });
}

export function preScreenCompetitorKeyword(
  input: CompetitorKeywordGapPreScreenInput,
): CompetitorKeywordGapPreScreen {
  const keyword = normalizedKey(input.keyword);
  const comparative = COMPARATIVE_TOKENS.test(keyword);
  const decide = (
    band: CompetitorKeywordGapPreScreen["band"],
    reason: CompetitorKeywordGapPreScreen["reason"],
  ): CompetitorKeywordGapPreScreen =>
    Object.freeze({ band, basis: "dfs_estimate", reason });

  if (!comparative) {
    if (competitorBrandTokens(input.competitorDomains).some((token) => containsToken(keyword, token))) {
      return decide("defer_brand_navigational", "competitor_brand_token");
    }
    if (HOSTNAME_SHAPE.test(keyword)) {
      return decide("defer_brand_navigational", "domain_like_keyword");
    }
    if (isDomainProfilePage(keyword, input.competitorPages)) {
      return decide("defer_brand_navigational", "competitor_domain_profile_page");
    }
    if (input.providerIntent?.trim().toLowerCase() === "navigational") {
      return decide("defer_brand_navigational", "provider_navigational_intent");
    }
  }

  const kd = input.keywordDifficulty.value;
  if (
    kd === null ||
    input.keywordDifficulty.availability === "provider_no_data" ||
    input.searchVolume.availability === "provider_no_data"
  ) {
    return decide("unbanded", "dfs_metric_missing");
  }
  if (kd >= COMPETITOR_KEYWORD_GAP_KD_HEAD_MIN) {
    return decide("defer_head_term", "kd_high");
  }
  if (
    kd <= COMPETITOR_KEYWORD_GAP_KD_LOW_MAX &&
    input.bestCompetitorRank <= COMPETITOR_KEYWORD_GAP_PAGE_ONE_RANK_MAX
  ) {
    return decide("prioritize_serp_check", "kd_low_rank_top10");
  }
  return decide("stretch", "kd_mid_rank_top20");
}
```

Note on the tests: `"ONE.example login"` must hit `competitor_brand_token` (the token `one` is present) — the order above checks brand tokens before hostname shape, which is what the test expects. The comparative exemption applies to all four navigational checks.

Export from `index.ts`: `export * from "./pre-screen.ts";` (check the barrel's existing style — it re-exports three modules).

- [ ] **Step 5: Run pre-screen tests**

Run: `pnpm vitest run --project unit packages/public-tools/src/competitor-keyword-gap/pre-screen.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

`git add packages/public-tools/src/competitor-keyword-gap/types.ts packages/public-tools/src/competitor-keyword-gap/pre-screen.ts packages/public-tools/src/competitor-keyword-gap/pre-screen.test.ts packages/public-tools/src/competitor-keyword-gap/index.ts && git commit -m "feat(public-tools): add competitor gap v3 contract and pre-screen policy"`

(The report tests are red at this point because the row type changed; Task 3 fixes them.)

---

### Task 3: Report — merge the paid-for fields, attach the pre-screen, sort by band inside each lane

**Files:**
- Modify: `packages/public-tools/src/competitor-keyword-gap/report.ts`
- Test: `packages/public-tools/src/competitor-keyword-gap/report.test.ts`

- [ ] **Step 1: Write failing tests** (add to `report.test.ts`; update `providerResult` rows via a `row()` helper that fills the seven new provider fields with nulls by default)

```ts
function row(overrides: Partial<CompetitorKeywordGapProviderRow> & { keyword: string; firstDomainRank: number }) {
  return {
    searchVolume: 1_000, cpc: 1, keywordDifficulty: 20, providerIntent: "commercial",
    secondDomainRank: null, firstDomainUrl: null, firstDomainTitle: null, firstDomainEtv: null,
    coreKeyword: null, searchVolumeTrend: null, serpItemTypes: null, serpUpdatedAt: null,
    ...overrides,
  };
}
```

Add `sampleRule: { maxCompetitorRank: 20, perCompetitorLimit: 300, serpSnapshotRequested: true }` to `BASE` (the `reportFor` helper at ~L44 is the single `buildCompetitorKeywordGapReport` call site and spreads `BASE`). Rewrite the existing "publishes the v2 schema version" test (~L86) and its `expectTypeOf<...ResultV2>` (~L92) as case 1 below.

Cases:
1. "publishes the v3 schema version and the sample rule": `schemaVersion === "competitor_keyword_gap.v3"`, `result.sampleRule` equals `{ maxCompetitorRank: 20, perCompetitorLimit: 300, serpSnapshotRequested: true }` when `input.sampleRule` is passed as such (report takes `sampleRule` from input verbatim and freezes it).
2. "keeps each competitor's best-rank page": two rows for `one.example` with the same keyword at ranks 9 and 3 → `competitorPages["one.example"]` is the rank-3 row's `{url,title,etv}`; a competitor whose rows carry no URL → `{ url: null, title: null, etv: null }`; `competitorPages` has exactly the domains in `competitorRanks`.
3. "takes core keyword, trend and serp snapshot from the best evidence that has them": row A (rank 2, all null) + row B (rank 5, `coreKeyword:"crm"`, trend, `serpItemTypes:["organic","ai_overview"]`, `serpUpdatedAt`) → row carries B's values; `serpSnapshot` is `null` when every evidence row has `serpItemTypes: null`; an empty `serpItemTypes: []` yields `serpSnapshot: { itemTypes: [], updatedAt }` (empty list is not silence).
4. "attaches a pre-screen to every row and never lets it change the GSC lane": a `navigational` row with a positive GSC query observation keeps `nextStep: "review_existing_query"` while `preScreen.band === "defer_brand_navigational"`.
5. "orders bands inside a lane before the DFS tie-breaks": five `review_content_gap` rows with bands brand, head, unbanded, stretch, prioritize and identical competitor counts → order prioritize, stretch, unbanded, head, brand; then with two `prioritize` rows, competitor count still decides between them.
6. "reports GSC row counts": gsc available with 3 query rows (one zero-impression) and 2 query-page rows → `gscQueryRowCount: 3`, `gscQueryPageRowCount: 2`; gsc `null` → both `null`; gsc unavailable → both `null`.
7. Update the frozen-paths test to also assert `Object.isFrozen(row.competitorPages)`, `Object.isFrozen(row.preScreen)`, `Object.isFrozen(result.sampleRule)`.

Replace every `CompetitorKeywordGapResultV2` reference with `V3` and add the seven null fields to existing inline provider rows (use the `row()` helper to keep the diff small).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project unit packages/public-tools/src/competitor-keyword-gap/report.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement in `report.ts`**

- `CompetitorKeywordGapProviderRow` gains the seven fields (same names/types as the sources row; the public-tools package must not import `@sf/sources`).
- `CompetitorKeywordGapReportInput` gains `readonly sampleRule: CompetitorKeywordGapSampleRule;`.
- In the aggregate loop keep, per domain, the evidence with the best rank (`compareEvidence` order) and build:

```ts
const competitorPages = Object.freeze(
  Object.fromEntries(
    rankEntries.map(([domain]) => {
      const best = evidence.find((item) => item.domain === domain);
      return [
        domain,
        Object.freeze({
          url: best?.row.firstDomainUrl ?? null,
          title: best?.row.firstDomainTitle ?? null,
          etv: best?.row.firstDomainEtv ?? null,
        }),
      ];
    }),
  ),
);
```

- `firstWith<T>(evidence, read: (row) => T | null): T | null` helper (first evidence in rank order whose read is non-null) for `coreKeyword`, `searchVolumeTrend`, and the snapshot:

```ts
const snapshotSource = evidence.find((item) => item.row.serpItemTypes !== null);
const serpSnapshot =
  snapshotSource === undefined
    ? null
    : Object.freeze({
        itemTypes: Object.freeze([...(snapshotSource.row.serpItemTypes ?? [])]),
        updatedAt: snapshotSource.row.serpUpdatedAt,
      });
```

- Hoist `searchVolume`, `cpc`, `keywordDifficulty`, `providerIntent`, `bestCompetitorRank` (currently computed inline in the returned literal at ~L556-564) into `const`s before the call, then `preScreen: preScreenCompetitorKeyword({ keyword: aggregate.key, keywordDifficulty, searchVolume, bestCompetitorRank, providerIntent, competitorPages: Object.fromEntries(Object.entries(competitorPages).map(([domain, page]) => [domain, page.url])), competitorDomains: input.competitorDomains })`. (There is no `mapValues` helper in this file.)
- `rowSort`: after the impressions comparison and BEFORE `competitorCount`, insert:

```ts
const bandPriority: Readonly<Record<CompetitorKeywordGapPreScreenBand, number>> = {
  prioritize_serp_check: 0, stretch: 1, unbanded: 2, defer_head_term: 3, defer_brand_navigational: 4,
};
if (bandPriority[a.preScreen.band] !== bandPriority[b.preScreen.band]) {
  return bandPriority[a.preScreen.band] - bandPriority[b.preScreen.band];
}
```

- Result: `sampleRule: Object.freeze({ ...input.sampleRule })`, `gscQueryRowCount: input.gsc?.status === "available" ? input.gsc.queryRows.length : null`, same for query-page rows.
- Update the file header comment (`@output` now says v3).

- [ ] **Step 4: Run all competitor-keyword-gap tests**

Run: `pnpm vitest run --project unit packages/public-tools/src/competitor-keyword-gap`
Expected: PASS.

- [ ] **Step 5: Commit**

`git add packages/public-tools/src/competitor-keyword-gap/report.ts packages/public-tools/src/competitor-keyword-gap/report.test.ts && git commit -m "feat(public-tools): merge paid-for competitor fields and pre-screen into the gap report"`

---

### Task 4: Handler — send the bounds, pass the fields through, record the rule

**Files:**
- Modify: `apps/marketing/src/lib/tools/competitor-keyword-gap-handler.ts`
- Test: `apps/marketing/src/lib/tools/competitor-keyword-gap-handler.test.ts`

- [ ] **Step 1: Failing tests**

1. Existing "calls the provider" style test: assert `domainIntersection` was called with `{ target1, target2, locationCode, languageCode, intersections: false, limit: 300, maxFirstDomainRank: 20, includeSerpInfo: true }`.
2. "passes the competitor page and snapshot fields into the report": provider response row with `firstDomainUrl`, `firstDomainTitle`, `firstDomainEtv`, `coreKeyword`, `searchVolumeTrend`, `serpItemTypes: ["organic","ai_overview"]`, `serpUpdatedAt` → envelope row has `competitorPages["one.example"].url`, `serpSnapshot.itemTypes` containing `ai_overview`, `preScreen.basis === "dfs_estimate"`.
3. "records the sample rule and GSC row counts in the envelope": `result.sampleRule` equals the constants; with connected GSC returning 2 query rows → `gscQueryRowCount: 2`; without GSC → `null`.
4. Update `providerResponse()` in the test helpers to include the seven fields (nulls by default).
5. Assert the final log is unchanged in shape (no new keys) — the log stays sanitised.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project unit apps/marketing/src/lib/tools/competitor-keyword-gap-handler.test.ts`

- [ ] **Step 3: Implement**

- Import `COMPETITOR_KEYWORD_GAP_MAX_COMPETITOR_RANK` from `@sf/public-tools` (add it to the public-tools barrel export if not already re-exported through `index.ts` of the package — check `packages/public-tools/src/index.ts`).
- `const SAMPLE_RULE: CompetitorKeywordGapSampleRule = { maxCompetitorRank: COMPETITOR_KEYWORD_GAP_MAX_COMPETITOR_RANK, perCompetitorLimit: COMPETITOR_KEYWORD_GAP_PROVIDER_LIMIT, serpSnapshotRequested: true };`
- Provider call adds `maxFirstDomainRank: SAMPLE_RULE.maxCompetitorRank, includeSerpInfo: SAMPLE_RULE.serpSnapshotRequested`.
- `completedProviderResult` maps the seven fields through.
- `buildCompetitorKeywordGapReport({ ..., sampleRule: SAMPLE_RULE })`.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run --project unit apps/marketing/src/lib/tools/competitor-keyword-gap-handler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

`git add apps/marketing/src/lib/tools/competitor-keyword-gap-handler.ts apps/marketing/src/lib/tools/competitor-keyword-gap-handler.test.ts && git commit -m "feat(marketing): request the bounded competitor gap sample"`

---

### Task 5: Response guard in the tool component

**Files:**
- Modify: `apps/marketing/src/components/tools/competitor-keyword-gap-tool.tsx` (`isV2Row` → `isV3Row`, `responseEnvelope`)
- Test: `apps/marketing/src/components/tools/competitor-keyword-gap-tool.test.tsx`

- [ ] **Step 1: Failing tests** — the existing envelope fixture in the tool test must be upgraded to v3 (schemaVersion, row fields, `sampleRule`, counts). Add: "rejects a v2 envelope" (schemaVersion v2 → error state), "rejects a row whose preScreen band is unknown", "rejects a competitorPages url that is not a string or null".

- [ ] **Step 2: Run** `pnpm vitest run --project unit apps/marketing/src/components/tools/competitor-keyword-gap-tool.test.tsx` → FAIL.

- [ ] **Step 3: Implement** `isV3Row` checks: `isRecord(value.competitorPages)` and every value `{ url: string|null, title: string|null, etv: finite|null }`; `coreKeyword` string|null; `searchVolumeTrend` null or record of three finite|null; `serpSnapshot` null or `{ itemTypes: string[], updatedAt: string|null }`; `preScreen` record with `band` in `COMPETITOR_KEYWORD_GAP_PRE_SCREEN_BANDS`, `basis === "dfs_estimate"`, `reason` string. `responseEnvelope` additionally checks `isRecord(result.sampleRule)` with finite `maxCompetitorRank`, `perCompetitorLimit`, boolean `serpSnapshotRequested`, and `isFiniteNumberOrNull(result.gscQueryRowCount)`, `isFiniteNumberOrNull(result.gscQueryPageRowCount)`. Update the header comment to say v3.

- [ ] **Step 4: Run** the tool test → PASS. **Step 5: Commit** `feat(marketing): validate the v3 competitor gap envelope`.

---

### Task 6: Copy — EN/ZH keys and the copy-shape guard

**Files:**
- Modify: `apps/marketing/src/i18n/messages/en.json`, `apps/marketing/src/i18n/messages/zh.json` (`tools.competitorKeywordGap`)
- Modify: `apps/marketing/src/i18n/messages.test.ts` (`COMPETITOR_GAP_RESULT_REQUIRED_PATHS`)

- [ ] **Step 1: Add the required paths to the test first** (they fail until the JSON has them):

```
"preScreen.title", "preScreen.basis", "preScreen.band.prioritize_serp_check", "preScreen.band.stretch",
"preScreen.band.unbanded", "preScreen.band.defer_head_term", "preScreen.band.defer_brand_navigational",
"preScreen.reason.kd_low_rank_top10", "preScreen.reason.kd_mid_rank_top20", "preScreen.reason.kd_high",
"preScreen.reason.dfs_metric_missing", "preScreen.reason.competitor_brand_token",
"preScreen.reason.competitor_domain_profile_page", "preScreen.reason.domain_like_keyword",
"preScreen.reason.provider_navigational_intent", "preScreen.filterAll",
"signals.aiOverviewSnapshot", "signals.aiOverviewSnapshotUndated", "signals.competitorTraffic",
"actions.openCompetitorPage", "actions.copyPlan", "actions.copyPlanDone", "actions.copyPlanFailed",
"coverage.sampleRule", "coverage.rowsInRule",
"overview.gscQueryRows", "limitations.gscNoRows",
"boundaries.dfsSnapshot", "boundaries.preScreen"
```

- [ ] **Step 2: Run** `pnpm vitest run --project unit apps/marketing/src/i18n/messages.test.ts` → FAIL.

- [ ] **Step 3: Add copy.** EN:

```json
"preScreen": {
  "title": "DFS pre-screen",
  "basis": "DataForSEO estimate; a pre-screen, not SERP winnability.",
  "filterAll": "All bands",
  "band": {
    "prioritize_serp_check": "Check SERP first",
    "stretch": "Stretch",
    "unbanded": "Not banded",
    "defer_head_term": "Head term, defer",
    "defer_brand_navigational": "Brand or navigational, skip"
  },
  "reason": {
    "kd_low_rank_top10": "KD at or below 30 and a competitor on page one.",
    "kd_mid_rank_top20": "Mid KD or a competitor on page two.",
    "kd_high": "KD above 60; a head term for this sample.",
    "dfs_metric_missing": "The provider reported no KD or volume, so no band was assigned.",
    "competitor_brand_token": "Contains a requested competitor's brand.",
    "competitor_domain_profile_page": "The competitor ranks with a domain profile page for another brand.",
    "domain_like_keyword": "The keyword is shaped like a hostname.",
    "provider_navigational_intent": "The provider labels the intent navigational."
  }
},
"signals": {
  "bestRank": "Best competitor #{rank}",
  "difficulty": "KD {value}",
  "aiOverviewSnapshot": "AI Overview · DFS snapshot {date}",
  "aiOverviewSnapshotUndated": "AI Overview · DFS snapshot, undated",
  "competitorTraffic": "Competitor page est. {value}/mo"
},
"actions": { ...existing,
  "openCompetitorPage": "Open competitor page",
  "copyPlan": "Copy {count} rows as plan",
  "copyPlanDone": "Copied {count} rows.",
  "copyPlanFailed": "Could not copy the plan in this browser."
},
"coverage": { ...existing,
  "sampleRule": "Sample rule: competitor rank at or better than #{maxRank}, ordered by the competitor page's estimated traffic, at most {limit} rows per competitor.",
  "rowsInRule": "{returned} returned · {total} reported inside the rule"
},
"overview": { ...existing, "gscQueryRows": "GSC returned {count} query rows for this property." },
"limitations": { ...existing, "gscNoRows": "GSC returned no query rows for the selected property in this window. Check that the property covers this site before reading any row as a content gap." },
"boundaries": { ...existing,
  "dfsSnapshot": "AI Overview and SERP feature marks come from DataForSEO's stored SERP snapshot and carry its date; they are not a live observation from this run.",
  "preScreen": "The DFS pre-screen band orders rows by provider estimates only. It never changes the GSC-derived next step and is not a winnability claim."
}
```

ZH:

```json
"preScreen": {
  "title": "DFS 预筛",
  "basis": "DataForSEO 估算；只是预筛，不是 SERP 可赢性。",
  "filterAll": "全部预筛带",
  "band": {
    "prioritize_serp_check": "优先核 SERP",
    "stretch": "可争取",
    "unbanded": "未分带",
    "defer_head_term": "头部词，暂缓",
    "defer_brand_navigational": "品牌/导航词，跳过"
  },
  "reason": {
    "kd_low_rank_top10": "难度 ≤ 30 且有竞品在首页。",
    "kd_mid_rank_top20": "难度中等，或竞品在第二页。",
    "kd_high": "难度 > 60，在本样本里属于头部词。",
    "dfs_metric_missing": "数据源未报告难度或搜索量，不分带。",
    "competitor_brand_token": "包含所选竞品的品牌词。",
    "competitor_domain_profile_page": "竞品是用别家品牌的域名档案页排名的。",
    "domain_like_keyword": "关键词本身是域名形态。",
    "provider_navigational_intent": "数据源判定为导航意图。"
  }
},
"signals": {
  "bestRank": "最佳竞品排名 #{rank}",
  "difficulty": "难度 {value}",
  "aiOverviewSnapshot": "AI Overview · DFS 快照 {date}",
  "aiOverviewSnapshotUndated": "AI Overview · DFS 快照，无日期",
  "competitorTraffic": "竞品页面预估 {value}/月"
},
"actions": { ...existing,
  "openCompetitorPage": "打开竞品页面",
  "copyPlan": "复制 {count} 行为计划",
  "copyPlanDone": "已复制 {count} 行。",
  "copyPlanFailed": "浏览器里无法复制这份计划。"
},
"coverage": { ...existing,
  "sampleRule": "采样规则：竞品排名 ≤ #{maxRank}，按竞品页面预估流量降序，每个竞品最多 {limit} 行。",
  "rowsInRule": "返回 {returned} 条 · 规则内数据源报告 {total} 条"
},
"overview": { ...existing, "gscQueryRows": "该资源在本窗口内 GSC 共返回 {count} 条查询。" },
"limitations": { ...existing, "gscNoRows": "所选资源在本窗口内 GSC 一条查询都没有返回。把任何行读作内容差距之前，先确认资源覆盖的是这个站点。" },
"boundaries": { ...existing,
  "dfsSnapshot": "AI Overview 与 SERP 特性标记来自 DataForSEO 存储的 SERP 快照并带其日期，不是本次运行的实时观测。",
  "preScreen": "DFS 预筛带只按数据源估算排序；它不改变由 GSC 决定的下一步，也不是可赢性结论。"
}
```

Also replace the existing `coverage.rows` usage? Keep `coverage.rows` (still used when `totalCount` is null) and add `rowsInRule` for the filtered count.

- [ ] **Step 4: Run** `pnpm vitest run --project unit apps/marketing/src/i18n/messages.test.ts` → PASS (EN/ZH parity + placeholders).

- [ ] **Step 5: Commit** `git add apps/marketing/src/i18n/messages/en.json apps/marketing/src/i18n/messages/zh.json apps/marketing/src/i18n/messages.test.ts && git commit -m "feat(marketing): add competitor gap v3 copy"`

---

### Task 7: Results surface

**Files:**
- Modify: `apps/marketing/src/components/tools/competitor-keyword-gap-results.tsx`
- Test: `apps/marketing/src/components/tools/competitor-keyword-gap-results.test.tsx`
- Test: `apps/marketing/src/i18n/competitor-keyword-gap-messages.test.tsx` (fixture → v3)

- [ ] **Step 1: Failing tests** (upgrade `BASE` to v3 first: add the row fields, `sampleRule`, counts; the `next-intl` mock renders keys so assertions target keys/attributes)

1. "links each competitor chip to its ranking page when one is known": `[data-competitor-rank="alpha.example"]` is an `<a href="https://alpha.example/...">` with `target="_blank"`, `rel="noopener noreferrer"`, `title` from the provider title; a competitor with `url: null` renders a `<span>`.
2. "shows the pre-screen band with its basis": `[data-pre-screen="prioritize_serp_check"]` present with `title` containing `preScreen.basis` and `preScreen.reason.kd_low_rank_top10`.
3. "shows a dated AI Overview snapshot chip only when the snapshot lists it": row with `serpSnapshot.itemTypes: ["organic","ai_overview"], updatedAt: "2026-05-14T18:17:21.000Z"` → `[data-serp-snapshot="ai_overview"]` text contains `signals.aiOverviewSnapshot`; row with `["organic"]` → no such element; row with `updatedAt: null` → `signals.aiOverviewSnapshotUndated`.
4. "offers the competitor page next to copy-keyword in the content-gap lane": review_content_gap row with a known URL → both `[data-row-action="copy-keyword"]` and `[data-row-action="open-competitor-page"]` (anchor, `_blank`); with no URL → only copy.
5. "filters by pre-screen band and by lane together": click `[data-pre-screen-filter="defer_brand_navigational"]` → only the brand row visible; the lane filter count chips keep their totals; clicking `[data-next-step-filter="review_content_gap"]` AND a band → intersection.
6. "states the sample rule and in-rule counts in coverage": `[data-sample-rule]` text contains `coverage.sampleRule:maxRank=20,limit=300`; competitor card uses `coverage.rowsInRule` when `totalCount !== null`.
7. "surfaces a GSC zero-row limitation": overlay `available`, `gscQueryRowCount: 0` → `limitations.gscNoRows` rendered and `[data-coverage-details]` open; `gscQueryRowCount: 40` → `overview.gscQueryRows:count=40` appears in the GSC card body and no limitation.
8. "keeps the boundaries list at six sentences" (four existing + `dfsSnapshot` + `preScreen`). The two existing assertions `boundaries?.querySelectorAll("li")).toHaveLength(4)` (around lines 924 and 952, titled "...always states the four durable evidence boundaries" and "...names all four durable boundaries") are updated to six and retitled; they are the only existing expectations this change breaks.
9. Keep every other existing test green (the six-column header list is unchanged; `[data-competitor-rank]` stays on whichever element renders; the copy-plan button is tested in Task 8).

In `competitor-keyword-gap-messages.test.tsx` upgrade the fixture and assert the ZH page renders `DFS 预筛` and `采样规则` and no literal `tools.competitorKeywordGap` path.

- [ ] **Step 2: Run** both test files → FAIL.

- [ ] **Step 3: Implement** (keep every existing `data-*` hook; reuse `CHIP_TEXT`, `ACTION_BUTTON`, `META_TEXT`):

- `type BandFilter = "all" | CompetitorKeywordGapPreScreenBand;` second `useState`; `filteredRows` = lane filter AND band filter; `changeFilter` and a `changeBandFilter` both reset `expanded`.
- Band filter row directly under the lane filter row: `<div data-pre-screen-filters>` with `preScreen.filterAll` + one chip per band in `COMPETITOR_KEYWORD_GAP_PRE_SCREEN_BANDS`, counts computed from rows that pass the *lane* filter, `data-pre-screen-filter={band}`, `aria-pressed`.
- Competitor chips: `competitorLink(row, domain)` → `safePageUrl(row.competitorPages[domain]?.url ?? null)`; render `<a>` when non-null (`title={row.competitorPages[domain]?.title ?? undefined}`), else `<span>`; keep `data-competitor-rank={domain}` on whichever element renders.
- Opportunity signals cell: after KD chip add `<span data-pre-screen={row.preScreen.band} title={`${t("preScreen.basis")} ${translated(t, `preScreen.reason.${row.preScreen.reason}`)}`} className={CHIP_TEXT}>{translated(t, `preScreen.band.${row.preScreen.band}`)}</span>`; then if `row.serpSnapshot?.itemTypes.includes("ai_overview")` a `<span data-serp-snapshot="ai_overview">` with the dated/undated label (`date` = `new Intl.DateTimeFormat(locale, { dateStyle: "medium" })` of `updatedAt`); then if the best competitor page's `etv` is non-null a `signals.competitorTraffic` chip.
- Next-check cell, `review_content_gap` branch: wrap in a flex with the copy button and, when `bestCompetitorPageUrl(row)` (page of the best-rank competitor; fall back to any competitor with a URL) is non-null, an `<a data-row-action="open-competitor-page" target="_blank" rel="noopener noreferrer" className={ACTION_BUTTON}>`.
- `CoverageCards`: a `<div data-sample-rule>` line with `t("coverage.sampleRule", { maxRank: result.sampleRule.maxCompetitorRank, limit: result.sampleRule.perCompetitorLimit })`; competitor card uses `coverage.rowsInRule` when `totalCount !== null`, else `coverage.rows` with `total: "—"`.
- `OverviewCards` GSC card: when `overlayStatus` is available/partial and `gscQueryRowCount !== null`, append `t("overview.gscQueryRows", { count })` as a second body line (`data-gsc-query-rows`).
- `Limitations`: push `limitations.gscNoRows` when `overlayStatus === "available" && result.gscQueryRowCount === 0`; `CoverageDetails.hasWarning` includes that condition.
- `EvidenceBoundaries`: list becomes `["dfsEstimates","gscOwnSample","competitorOutcomesUnavailable","manualSnapshot","dfsSnapshot","preScreen"]`.
- Header comment → v3.

- [ ] **Step 4: Run** `pnpm vitest run --project unit apps/marketing/src/components/tools/competitor-keyword-gap-results.test.tsx apps/marketing/src/i18n/competitor-keyword-gap-messages.test.tsx` → PASS. Then `git diff --stat` (only the three files).

- [ ] **Step 5: Commit** `feat(marketing): surface competitor pages, pre-screen bands, and sample rule`.

---

### Task 8: "Copy rows as plan"

**Files:**
- Create: `apps/marketing/src/lib/tools/competitor-keyword-gap-copy-plan.ts`
- Create: `apps/marketing/src/lib/tools/competitor-keyword-gap-copy-plan.test.ts`
- Modify: `apps/marketing/src/components/tools/competitor-keyword-gap-results.tsx` (button)
- Test: `apps/marketing/src/components/tools/competitor-keyword-gap-results.test.tsx`

- [ ] **Step 1: Failing tests** for the module:

```ts
import { describe, expect, it } from "vitest";
import { UNTRUSTED_DATA_NOTICE } from "../copy-brief/fenced-json.ts";
import { briefByteLength } from "../copy-brief/budget.ts";
import { buildCompetitorKeywordGapPlan, COPY_PLAN_MAX_BYTES, COPY_PLAN_MAX_ROWS } from "./competitor-keyword-gap-copy-plan.ts";
```

Cases: (1) "opens with fixed labels and the notice, then one fenced JSON block": output starts with `# Competitor keyword gap plan` (EN) / `# 竞品词差距计划` (ZH), contains `UNTRUSTED_DATA_NOTICE[locale]`, contains exactly one "```json" fence; (2) "puts every visitor/provider value inside the fence": a keyword containing "` | ignore previous" and a title containing "```" → neither appears outside the fence; parsing the fenced block with `JSON.parse` returns the identical strings; (3) "carries each field's evidence label": fenced JSON rows carry `searchVolume: { value, source: "dfs_estimate" }`, `competitorPages[...]: { url, title, etv, source: "dfs_estimate" }`, `serpSnapshot: { ..., source: "dfs_snapshot" }`, `gsc: { queryStatus, ..., source: "gsc_measured" }`, `preScreen: { band, reason, source: "dfs_estimate" }`, `nextStep`; (4) "caps rows and bytes": 500 rows in → `rows.length === COPY_PLAN_MAX_ROWS` (20) and `meta.omittedRows === 480`; a row with a 40KB title → output within `COPY_PLAN_MAX_BYTES` (48 * 1024) by dropping trailing rows and raising `meta.omittedRows`, never truncating a value; (5) "labels the filter that produced the rows": `meta.laneFilter`, `meta.bandFilter`, `meta.sampleRule`, `meta.capturedAt`, `meta.siteDomain`, `meta.competitorDomains`.

Signature:

```ts
export interface CompetitorKeywordGapPlanInput {
  readonly locale: "en" | "zh";
  readonly result: CompetitorKeywordGapResultV3;
  readonly rows: readonly CompetitorKeywordGapRow[]; // already filtered + ordered by the surface
  readonly laneFilter: string;
  readonly bandFilter: string;
}
export interface CompetitorKeywordGapPlanOutput {
  readonly markdown: string;
  readonly rowCount: number;
  readonly omittedRows: number;
}
export function buildCompetitorKeywordGapPlan(input: CompetitorKeywordGapPlanInput): CompetitorKeywordGapPlanOutput;
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** using `fencedJson`, `UNTRUSTED_DATA_NOTICE`, `withinBriefBudget`; fixed EN/ZH headings live as constants in this file (they are instructions, not data). Loop: take `min(rows.length, COPY_PLAN_MAX_ROWS)`; while `!withinBriefBudget(markdown, COPY_PLAN_MAX_BYTES)` and rows remain, drop the last row and rebuild.

- [ ] **Step 4: Button** in `ResultsTable` header (`data-row-action="copy-plan"`): label `actions.copyPlan` with `count = min(filteredRows.length, COPY_PLAN_MAX_ROWS)`; on click build the plan from `filteredRows` (the current lane+band filter, full order, not only the visible 10), `navigator.clipboard.writeText`, then set an inline status line `actions.copyPlanDone` (`role="status"`) or `actions.copyPlanFailed` via the existing `actionError`. Locale for the plan: `locale.startsWith("zh") ? "zh" : "en"`. Results test: clicking copies markdown that contains the fence and `count=` reflects the filter.

- [ ] **Step 5: Run** both test files → PASS. Commit `feat(marketing): copy competitor gap rows as a plan`.

---

### Task 9: Whole-tree verification, docs, PR

- [ ] **Step 1: Targeted suites**

```
pnpm vitest run --project unit packages/sources/src/dataforseo packages/public-tools/src/competitor-keyword-gap apps/marketing/src/lib/tools/competitor-keyword-gap-handler.test.ts apps/marketing/src/lib/tools/competitor-keyword-gap-copy-plan.test.ts apps/marketing/src/lib/tools/tool-handoff.test.ts apps/marketing/src/components/tools apps/marketing/src/i18n "apps/marketing/src/app/[locale]/tools"
```
(The `[locale]` path must be quoted: unquoted it is a zsh glob and aborts the command.)
Expected: all green. Record counts.

- [ ] **Step 2: Typecheck** `pnpm typecheck` (root). Expected: pass.

- [ ] **Step 3: Scoped lint** `pnpm --filter marketing exec eslint <every changed .ts/.tsx under apps/marketing>` and `pnpm -r --if-present lint` for `packages/sources`/`packages/public-tools` if those packages define lint. Record pre-existing failures separately (the 08-25 verification lists seven pre-existing marketing lint errors in untouched Agent/On-Page files).

- [ ] **Step 4: Build** `pnpm --filter marketing build` (from root). Expected: pass, route count reported.

- [ ] **Step 5: Repo gates** `pnpm verify:docs && pnpm verify:authority && pnpm deploy:check && git diff --check`. `verify:spec` and `implementation:check` have known pre-existing drift (08-25 verification); run them and record the diff against that baseline only.

- [ ] **Step 6: Verification doc** `docs/reviews/2026-08-25-competitor-keyword-gap-v3-verification.md`: probe record, gates, commit list, what is deferred (PR B: SERP sampling; Opportunity Finder handoff).

- [ ] **Step 7: Cross-model review** — run the `codex` skill on the branch diff written to a file (per memory: give it the diff, not the repo), address P0/P1 findings, re-run the suites.

- [ ] **Step 8: Push + PR** `git push -u origin feat/competitor-keyword-gap-v3-20260825`, `gh pr create` with the design/audit links and the probe table; after merge, one production run (`gengrowth.ai/zh/tools/competitor-keyword-gap`, 3 competitors) and read the `competitor_keyword_gap` runtime log (`costUsd`, `rowCount`) into the verification doc.
