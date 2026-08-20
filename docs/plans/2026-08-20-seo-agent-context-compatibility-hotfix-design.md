# SEO Agent Context Compatibility Hotfix Design

Date: 2026-08-20

Status: approved by the owner through “按照方案A实施”.

Baseline: branch `fix/seo-agent-remediation-20260820`, Git SHA
`2afb3aa54d6fbe443f49ff9a4b37c51e6c8da061`. The affected browser tab was
loaded from deployment `dpl_bML1LDEPCfanXFC1MrdKoGDv6D7u` at Git SHA
`641107fa9cf3982baa1517805b333f2f1627bd12`, before the current Marketing
deployment became active.

## Outcome

Repair the accepted-context flow without forcing the visitor to discard the
Profile already assembled in an old tab:

- an old client must still receive a valid core audit from a new server;
- a current client must receive the complete seven-record Search Console
  region;
- provider-derived competitor classifications must be visible in the matching
  review fields and become part of the locally confirmed run context;
- a credible target-query suggestion must be derived from already available,
  source-approved Product Profile search seeds without another provider call;
- inferred values must stay visibly unconfirmed until the visitor accepts the
  run context;
- the change remains entirely in the Marketing-owned Agent and does not write
  an App Product Profile.

## Root causes proved in production

### 1. A successful response was rejected by a stale browser contract

The affected browser issued two audit requests. Both returned HTTP 200 and a
roughly 765 KB JSON body. The first took about 195 seconds and the second about
13 seconds. The old JavaScript bundle accepts exactly six Search Console record
IDs, while the current server returns the combined six search-performance
records plus `sitemap_url_not_indexed`. The fail-closed client therefore mapped
a successful result to `audit_response_invalid`.

### 2. Competitor evidence was display-only

`deriveAgentCompetitorDisplayFrame` merges provider suggestions and manual
classifications for the summary cards, but the review fields are bound to the
raw Profile arrays. System suggestions therefore appear above the editor while
`directCompetitors`, `indirectAlternatives`, and `excludedAlternatives` remain
empty.

### 3. No target-query producer existed

Profile Refresh owns an exact 22-field Product/ICP contract and intentionally
does not produce `targetQuery`. Profile Search consumes a query only on the CN
SERP path and does not return one. In supported markets such as US, competitor
discovery can succeed through domain overlap while `targetQuery` stays empty.

## Decisions

### 1. Negotiate the optional Search Console region

Add one shared browser/server capability:

```ts
export const AGENT_AUDIT_CONTRACT_HEADER =
  "x-gengrowth-agent-audit-contract" as const;
export const AGENT_AUDIT_CONTRACT_SEARCH_CONSOLE_7 =
  "search-console-7" as const;
```

The current Workbench sends this header on an Agent audit. The server only
reads and attaches the seven-record Search Console region when the marker is
present. A request without the marker is treated as a legacy client: the server
returns the complete core audit but omits the optional Search Console region
and does not call its reader. It must not truncate seven records to six.

The response keeps its existing private/no-store behavior and declares the
served contract in a response header. `Vary` includes the capability header so
the representation boundary remains explicit even though authenticated audit
responses are not shared-cacheable.

This is capability negotiation, not authorization. Authentication,
same-origin checks, request validation, crawl behavior, and all current runtime
guards remain authoritative.

### 2. Materialize the effective competitor review only at confirmation

Provider suggestions remain suggestions, not canonical Product Profile facts.
The review surface nevertheless shows the effective values in the matching
three fields, so it no longer presents an empty editor under populated cards.

A pure helper derives the effective classification from:

1. normalized manual classifications;
2. provider/system suggestions for domains not manually classified;
3. one-group-only and first-occurrence deduplication.

Manual decisions always win. The classification buttons remain the
authoritative way to move a suggested domain. A list-field edit starts from the
effective frame so typing does not discard suggestions that were visibly in
the field. Removing a visible suggestion from a list must produce a stable
decision rather than letting it reappear on the next render.

When the visitor clicks “Accept context and run”, the effective three arrays
are copied into the immutable local confirmation snapshot. This explicit
acceptance may use `user_edit` provenance because the visitor has confirmed
the reviewed classification. Nothing is written to `apps/web`, Supabase, or a
canonical App Product Profile.

### 3. Derive a target-query suggestion from existing trusted seeds

Do not change the exact Profile Refresh schema and do not add a paid provider
call. Add a browser-safe pure function that derives a bounded suggestion from
the same approved-source inputs already used for Product Profile search seeds.

Selection rules:

1. preserve a non-empty manual or On-Page handoff query exactly;
2. prefer an approved non-brand/category or product-capability seed when one is
   available;
3. use the approved product-name seed only as a final fallback;
4. normalize Unicode/whitespace and enforce the existing 200-character search
   seed limit;
5. return `null` when no credible seed exists.

The context summary and review surface label this value as inferred and needing
confirmation. It is not sent to the audit merely because it was displayed.
Clicking “Accept context and run” copies the suggestion into the confirmed
local Profile only when the visitor has not supplied a query. An explicit query
always wins. The direct SEO request then uses the existing one-item
`targetQueries` wire behavior.

### 4. Preserve old-tab and stale-result identities

The old browser tab is not reloaded during implementation. After deployment,
its request will have no new capability header and must therefore receive the
legacy-compatible core result. A fresh tab will send the marker and receive the
seven-record Search Console region.

Target-query suggestions and accepted competitor classifications are part of
the same run identity already used by the Workbench. Changing an explicit
query still invalidates a mounted report. Competitor edits continue to frame
the confirmed solution but do not invent a new evidence-ranking algorithm.

The immutable run snapshot and the editable Stage 01 Profile are deliberately
different objects. The run snapshot contains suggestions the visitor accepted
for this run; the editable Profile contains only true manual state. An
authentication handoff stores both under the exact v4 pending-intent contract:

- `confirmedProfile` resumes the outbound audit;
- `editableProfile` restores the review UI;
- both must be confirmed, have the exact Agent and URL, and remain inside the
  existing ten-minute TTL;
- a missing, malformed, or mismatched snapshot fails closed;
- v1-v3 intent slots are cleared rather than guessed or migrated.

This prevents a provider suggestion from being relabeled as `user_edit` and
surviving into a later market/query search, including after sign-in reload or
an API-level authentication race.

## Error and unavailable states

- A malformed core audit remains `audit_response_invalid`; negotiation must not
  weaken runtime validation.
- A current client whose Search Console reader fails retains the current
  `searchPerformanceUnavailable` behavior.
- A legacy client does not get `searchPerformanceUnavailable` merely because it
  did not advertise support; the optional region is simply absent.
- No credible target-query seed remains `not provided / confirmation required`.
- No competitor suggestion preserves manual-only arrays.
- Duplicate, invalid, or cross-group competitor domains are normalized or
  rejected by the existing public-hostname rules.

## Explicit non-goals

- No Profile Refresh v2/23-field migration.
- No additional DataForSEO, LLM, Search Console, or crawl call for the query
  suggestion.
- No account limits, credits, billing, pricing, or provider-cost ledger.
- No App integration or persistent Product Profile write.
- No main-branch merge and no Product `app.gengrowth.ai` deployment.
- No weakening of the exact seven-record current contract.

## Acceptance evidence

1. A request without the capability marker does not call the Search Console
   reader and returns an envelope accepted by the legacy six-record client.
2. A request with the marker attaches all seven records and passes both current
   wire and display guards.
3. Unknown capability values fail safely to the legacy representation.
4. System suggestions are visible in the direct/indirect/excluded editor
   fields, while manual classification wins and each normalized domain appears
   in exactly one group.
5. Confirmation receives the effective competitor arrays even when the visitor
   did not click every candidate button.
6. A non-empty explicit target query is never replaced.
7. A source-approved Profile with no explicit query exposes one inferred query;
   confirmation copies it into the audit request.
8. A Profile without a credible seed leaves the query unavailable and sends no
   invented `targetQueries`.
9. Same-tab and authentication-resume tests prove the run snapshot contains
   accepted suggestions while the editable Profile does not retain them as
   manual state; malformed dual-snapshot intents fail closed and v3 is cleared.
10. Focused Vitest suites, Marketing lint/typecheck/build, the full applicable
   unit suite, Agent Playwright coverage, and `git diff --check` pass.
11. The released Marketing deployment is bound to the new immutable SHA, while
    the Product deployment identity remains unchanged.
