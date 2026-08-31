# Page Citability correction release

## Scope

Marketing-only correction of the public Page Citability tool. Preserve the
site shell and theme; use the existing input/result hierarchy with real report
values. No Product application, Worker, schema, migration, dependency or
production environment change is introduced by this patch.

## Behavior

- Explicit report paragraph sizes fix inherited global typography. English and
  Chinese use the existing Marketing tokens and Chinese line-height rule.
- Server-owned conclusion separates known issues, heuristic review and missing
  evidence. Priorities link to actual checks. Counts are not citation probability.
- Numeric-source cues are heuristic, not factual verification. FAQ checks the
  supported inline Question/Answer types and nonempty fields. Incomplete
  robots/llms captures and incomplete FAQ scans do not become passing facts.
- Historical site-index snapshots preserve their original rule identities.
  New snapshots explicitly identify the corrected v2 inventory.
- Optional AI review requires explicit consent, verified authentication, a safe
  complete refetch matching the report's final URL and raw hash, and durable
  user/IP/snapshot admission. A new base run invalidates earlier AI state.
- DataForSEO receives bounded page excerpts with web search disabled. Three
  semantic dimensions and valid evidence IDs are required. The model assessment
  never replaces measured checks. Unknown completion or cost remains unknown;
  there is no automatic retry.

## Verification entry points

```sh
pnpm exec vitest run --project unit apps/marketing/src/lib/geo-tools \
  apps/marketing/src/components/tools/page-citability-check.test.tsx \
  apps/marketing/src/app/theme-tokens.test.ts \
  apps/marketing/src/app/api/tools/page-citability-check \
  apps/marketing/scripts/citability-ai-canary.test.ts
pnpm --filter @sf/marketing typecheck
pnpm --filter @sf/marketing build
pnpm --filter @sf/marketing test:e2e e2e/page-citability-check.spec.ts
```

The browser suite must use its credential-free isolated runner. The two manual
real-data replay cases are opt-in via explicitly selected capture file paths;
they never start an external provider request. Recorded JSON, full page captures
and screenshots are local acceptance artifacts, not application fixtures or
bundled production data.

Before release, the real DataForSEO check found a one-dimension response to the
old example prompt. Free retrieval of that task identified the missing fields;
the prompt was corrected to include all three objects without relaxing the
parser. A subsequent real response passed with model
`gpt-4.1-mini-2025-04-14`. The two paid attempts cost USD 0.002794 in total; model
registry reads and existing-task retrieval reported zero cost. These results do
not certify a new production browser session or production deployment.

Real isolated-Linux captures separately verified a static IANA page and an MDN
JavaScript fetch example. Required-resource/DNS failures remain unavailable,
with a null ratio. The renderer is not bundled into the Next runtime and is not
created or enabled by this Marketing code deployment.

## Runtime and release boundaries

The AI route reuses existing Marketing authentication, quota RPC and server-only
DataForSEO credentials. See `scripts/citability-ai-review.md` for exact request,
spend, evidence and failure boundaries; `scripts/citability-renderer.md` covers
the separately hosted rendering service. Missing configuration fails closed.

The user's current release authorization covers commit, push and Marketing
deployment. It does not authorize changing Product/Railway/database configuration
or creating new infrastructure. Validate the exact merged SHA, Marketing aliases
and page/API behavior, and independently confirm the Product production identity.

The user waived external ChatGPT Pro collaboration for this task. Reviews use
Codex and native independent agents, not an external source upload.
