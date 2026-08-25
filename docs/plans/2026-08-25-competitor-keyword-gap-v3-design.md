# Competitor Keyword Gap v3 Design (sample reshape + DFS pre-screen)

Date: 2026-08-25
Status: Approved by Owner (goal: land the 2026-08-25 audit recommendations; open
decisions resolved with the audit's recommended option)
Target: `apps/marketing` on `gengrowth.ai`
Base: `origin/main` at `9f0501fb`
Audit: https://claude.ai/code/artifact/fc49c189-fea2-4f07-a534-715923b73350

## Why v3

The 2026-08-25 production run (`rowCount 288 · costUsd 0.072 · gsc available`)
was correct and useless: every row landed in `review_content_gap` with one
"copy keyword" action. Two structural causes, both upstream of the wording:

1. **Sample shape.** The provider task sends `order_by search_volume desc`,
   `limit 100`, no `filters`. Each competitor therefore contributes its 100
   highest-volume keywords among those it ranks for anywhere in the top 100
   and the site does not. Rank 87 counts as much as rank 1. For ahrefs/semrush
   that is their head vocabulary plus other brands' navigational terms.
2. **Single axis.** `nextStep` is derived from GSC only. DFS fields are
   tie-breakers. A site with no GSC hit on competitor terms gets one lane and
   one verb, and `rowSort` (competitor count first) promotes the head terms
   the competitors share.

## Decisions (from the audit's open questions)

| Decision | Ruling |
|---|---|
| Open the competitor ranking URL through the sanitised boundary? | Yes, only `first_domain_serp_element.url` and `title`; the response test keeps refusing `authorization/credential/password/login/status_message`. URLs are parsed and only `http(s)` without userinfo survive. |
| KD filter in the paid request? | No. KD is unreliable in both directions (KD6 and KD88 misreads on record). KD is a client-side pre-screen band only. |
| Per-competitor cap | 300 rows, filtered to `first_domain_serp_element.rank_group <= 20`. Billing is per returned item (`$0.012 + $0.00012 x rows`); the filtered request is usually far below the cap. |
| SERP page-one sampling | Deferred to PR B after one production run of PR A. |
| GSC row count in the envelope | Yes. `gscQueryRowCount` / `gscQueryPageRowCount` so "available with 0 observed" can be told apart from "GSC returned no rows at all". |
| `include_serp_info` | Enabled only after the cost probe confirms the response `cost` does not change (probe recorded in the implementation plan). |

## Confirmed boundaries (unchanged)

- Independent, signed-in, manual, non-persistent. No weekly cycle, no
  "new this week", no action queue, no credits claim.
- One paid provider operation (`domain_intersection`), one call per competitor.
- No LLM, no RDAP, no crawl, no SERP sampling in this revision.
- A GSC miss is never "not covered". A DFS estimate is never "winnability".
- The Labs `serp_info` block is a **dated snapshot**; it is rendered as
  "AI Overview · DFS snapshot {date}", never as "observed on the SERP".
- `avg_backlinks_info` is not parsed: it is a page-one average that hides the
  weakest holder winnability keys on. `competition_level` is Google Ads
  competition and is not parsed either.

## Contract v3 (`competitor_keyword_gap.v3`)

Additive on the row:

```ts
readonly competitorPages: Readonly<Record<string, {
  readonly url: string | null;   // http(s) only, no userinfo, <= 2048 chars
  readonly title: string | null; // <= 200 chars
  readonly etv: number | null;   // provider estimated monthly traffic to the ranking page
}>>;
readonly coreKeyword: string | null;
readonly searchVolumeTrend: {
  readonly monthly: number | null;
  readonly quarterly: number | null;
  readonly yearly: number | null;
} | null;
/** null when include_serp_info was off or the provider reported no snapshot. */
readonly serpSnapshot: {
  readonly itemTypes: readonly string[];
  readonly updatedAt: string | null;
} | null;
readonly preScreen: {
  readonly band: "prioritize_serp_check" | "stretch" | "defer_head_term"
               | "defer_brand_navigational" | "unbanded";
  readonly basis: "dfs_estimate";
  readonly reason: "kd_low_rank_top10" | "kd_mid_rank_top20" | "kd_high"
                 | "competitor_brand_token" | "domain_like_keyword"
                 | "provider_navigational_intent" | "dfs_metric_missing";
};
```

Additive on the result:

```ts
readonly sampleRule: {
  readonly maxCompetitorRank: 20;
  readonly perCompetitorLimit: 300;
  readonly serpSnapshotRequested: boolean;
};
readonly gscQueryRowCount: number | null;
readonly gscQueryPageRowCount: number | null;
```

`nextStep` and its four lanes are untouched. The pre-screen is a second,
orthogonal axis: it never re-routes a GSC-observed row.

### Pre-screen decision table (pure, deterministic)

Evaluated in order; the first match wins.

| Condition | Band | Reason |
|---|---|---|
| keyword contains a competitor brand token (registrable label of a requested competitor) and no comparative token (`alternative(s)`, `vs`, `versus`, `competitor(s)`, `替代`, `对比`) | `defer_brand_navigational` | `competitor_brand_token` |
| keyword looks like a hostname (`^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$` after key normalisation) | `defer_brand_navigational` | `domain_like_keyword` |
| provider intent is `navigational` | `defer_brand_navigational` | `provider_navigational_intent` |
| KD or search volume is `provider_no_data` | `unbanded` | `dfs_metric_missing` |
| KD > 60 | `defer_head_term` | `kd_high` |
| KD <= 30 and best competitor rank <= 10 | `prioritize_serp_check` | `kd_low_rank_top10` |
| otherwise | `stretch` | `kd_mid_rank_top20` |

Band order inside a GSC lane: prioritize → stretch → unbanded → head → brand.
Then the existing tie-breaks (competitor count, best rank, volume, keyword).

### Provider request

```json
{
  "target1": "competitor.example", "target2": "site.example",
  "location_code": 2840, "language_code": "en",
  "intersections": false, "item_types": ["organic"],
  "include_clickstream_data": false,
  "include_serp_info": true,
  "filters": [["first_domain_serp_element.rank_group", "<=", 20]],
  "order_by": ["keyword_data.keyword_info.search_volume,desc"],
  "limit": 300, "offset": 0
}
```

`DataForSeoDomainIntersectionRequest` gains two optional, typed bounds
(`maxFirstDomainRank`, `includeSerpInfo`); the client composes the provider
filter array. No free-form filter string crosses the boundary.

## Surface changes

- Competitor chips link to the competitor's ranking page (`target=_blank`,
  `rel=noopener noreferrer`), title attribute from the provider title.
- Opportunity signals: pre-screen chip (with tooltip "DFS pre-screen, not SERP
  winnability"), AI Overview snapshot chip only when the snapshot lists
  `ai_overview`, dated.
- `review_content_gap` rows get "Open competitor page" next to "Copy keyword".
- A second filter row for pre-screen bands (AND with the lane filter).
- "Copy top rows as plan": fixed notice + fenced JSON of the visible rows via
  the shared copy-brief mechanism; 48KB byte budget.
- Coverage card states the sample rule verbatim; a limitation appears when the
  overlay is available but GSC returned zero query rows.
- Boundaries gain two sentences: DFS snapshot dating and pre-screen honesty.

## Cost

3 competitors: `<= 3 x ($0.012 + 300 x $0.00012) = $0.144` worst case; the
rank filter usually returns well below the cap. 5 competitors `<= $0.24`.
