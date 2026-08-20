# SEO Agent Context Compatibility Hotfix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make stale and current SEO Agent tabs receive safe audit results while carrying reviewed competitor and target-query suggestions into the accepted local run context.

**Architecture:** Negotiate the optional seven-record Search Console region with a shared request capability, keep legacy requests on a valid core representation, and derive a local effective search context from existing provider suggestions and approved Product Profile seeds. Materialize inferred values only in the visitor-confirmed run snapshot; do not expand Profile Refresh or add provider calls.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, next-intl, Vitest, Playwright, Vercel Node functions.

---

Implementation uses the existing isolated worktree and the approved
Marketing-only release boundary. Each production task follows RED → minimal
GREEN → focused regression → spec review → code-quality review.

### Task 1: Negotiate the Search Console audit region

**Files:**
- Modify: `apps/marketing/src/lib/agents/audit-contract.ts`
- Modify: `apps/marketing/src/lib/agents/audit-handler.ts`
- Modify: `apps/marketing/src/components/agents/agent-workbench.tsx`
- Test: `apps/marketing/src/lib/agents/audit-handler.test.ts`
- Test: `apps/marketing/src/components/agents/agent-workbench.test.tsx`
- Test if needed: `apps/marketing/src/app/api/agents/seo/audit/route.test.ts`

**Step 1: Write legacy/current failing tests**

Add a real seven-record `readAgentSearchPerformance` fixture and assert:

```ts
expect(legacyResponse.status).toBe(200);
expect(legacyReadSearchPerformance).not.toHaveBeenCalled();
expect("searchPerformance" in legacyBody.data.result).toBe(false);
expect(isLegacyAuditEnvelope(legacyBody)).toBe(true);

expect(currentBody.data.result.searchPerformance?.records).toHaveLength(7);
expect(isAgentAuditSuccessEnvelope(currentBody)).toBe(true);
expect(supportsAgentDisplayVocabulary(currentBody.data, "seo")).toBe(true);
```

Add a Workbench request test requiring the new capability header on direct SEO
and On-Page handoff audit requests. Add an unknown-header case that behaves as
legacy.

**Step 2: Run RED**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/agents/audit-handler.test.ts \
  apps/marketing/src/components/agents/agent-workbench.test.tsx
```

Expected: the current handler invokes/attaches Search Console without
negotiation and the Workbench sends no capability header.

**Step 3: Add shared constants and server negotiation**

Export the lower-case header name and exact supported value from the
browser-safe audit contract. Add an exact predicate:

```ts
export function supportsSearchConsole7(request: Request): boolean {
  return request.headers.get(AGENT_AUDIT_CONTRACT_HEADER) ===
    AGENT_AUDIT_CONTRACT_SEARCH_CONSOLE_7;
}
```

Gate both the Search Console reader and its output region on that predicate.
Do not set `searchPerformanceUnavailable` for legacy requests. Preserve all
existing behavior after a current client advertises support.

**Step 4: Advertise the capability from the current Workbench**

Add the exact header to the audit fetch only. Do not add it to Profile Search or
Profile Refresh, whose contracts are unchanged.

**Step 5: Run GREEN and focused regressions**

Run the RED command plus:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/agents/audit-contract.test.ts \
  apps/marketing/src/components/agents/agent-display-contract.test.ts \
  apps/marketing/src/app/api/agents/seo/audit/route.test.ts \
  apps/marketing/src/app/api/agents/tech/audit/route.test.ts
```

Expected: all pass and current seven-record exactness remains enforced.

### Task 2: Show and confirm effective competitor classifications

**Files:**
- Modify: `apps/marketing/src/components/agents/agent-competitor-candidates.ts`
- Modify: `apps/marketing/src/components/agents/agent-profile-panel.tsx`
- Test: `apps/marketing/src/components/agents/agent-competitor-candidates.test.ts`
- Test: `apps/marketing/src/components/agents/agent-profile-panel.test.tsx`

**Step 1: Write failing pure-function tests**

Add tests proving a new acceptance helper:

```ts
const accepted = acceptAgentCompetitorSuggestions(profile, suggestions);
expect(accepted.directCompetitors).toEqual(["direct.example"]);
expect(accepted.indirectAlternatives).toEqual(["indirect.example"]);
expect(accepted.excludedAlternatives).toEqual(["excluded.example"]);
```

Cover normalized duplicates, invalid domains, a manual decision overriding a
system suggestion, and manual-only values not present in provider output.

**Step 2: Write failing panel-flow tests**

- Open Review with provider suggestions and raw empty arrays.
- Assert the three corresponding inputs visibly contain the effective values.
- Assert the original draft remains unconfirmed before the confirmation click.
- Click Confirm and assert `onConfirm` receives the effective arrays.
- Change/move/remove one suggested domain and assert it stays changed after a
  rerender and appears in exactly one group.

**Step 3: Run RED**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/agents/agent-competitor-candidates.test.ts \
  apps/marketing/src/components/agents/agent-profile-panel.test.tsx
```

Expected: fields are raw/empty and confirmation receives the unmaterialized
Profile.

**Step 4: Implement one pure effective-frame/acceptance seam**

Reuse `deriveAgentCompetitorDisplayFrame`; do not duplicate classification
rules. Build exact arrays from the frame and apply them through
`updateAgentProfile` only for explicit visitor edits or final confirmation.
Render effective values in the list fields. Ensure list editing starts from the
effective frame so a deleted suggestion cannot silently reappear.

**Step 5: Run GREEN and Profile regressions**

Run the RED command plus:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/agents/agent-profile.test.ts \
  apps/marketing/src/components/agents/agent-workbench.test.tsx
```

Expected: all pass and no canonical App persistence is introduced.

### Task 3: Derive and accept a target-query suggestion

**Files:**
- Modify: `apps/marketing/src/components/agents/agent-profile-search-seeds.ts`
- Modify: `apps/marketing/src/components/agents/agent-profile-panel.tsx`
- Test: `apps/marketing/src/components/agents/agent-profile-search-seeds.test.ts`
- Test: `apps/marketing/src/components/agents/agent-profile-panel.test.tsx`
- Test: `apps/marketing/src/components/agents/agent-workbench.test.tsx`
- Modify translations only if a new visible label is required:
  `apps/marketing/src/i18n/messages/en.json`,
  `apps/marketing/src/i18n/messages/zh.json`
- Test translations if modified:
  `apps/marketing/src/components/agents/agent-messages.test.ts`

**Step 1: Write failing derivation tests**

Assert that the helper:

- preserves an explicit target query;
- prefers an approved category/capability seed over a branded product name;
- falls back to an approved product name only when no other seed exists;
- ignores fields with missing/unapproved provenance;
- normalizes Unicode/whitespace and returns `null` past 200 characters or when
  no credible seed exists.

**Step 2: Write failing acceptance-flow tests**

- Show an inferred suggestion in the context/review surface while
  `profile.targetQuery` is empty.
- Confirm the context and assert `onConfirm` receives the suggestion.
- Assert a manually entered query wins.
- Assert no credible seed leaves the query absent.
- In the Workbench, assert accepted suggestion produces one ordered
  `targetQueries` item; absent suggestion produces no `targetQueries` and does
  not add a provider call before the audit.

**Step 3: Run RED**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/agents/agent-profile-search-seeds.test.ts \
  apps/marketing/src/components/agents/agent-profile-panel.test.tsx \
  apps/marketing/src/components/agents/agent-workbench.test.tsx
```

Expected: no query-derivation export and confirmation preserves the empty
query.

**Step 4: Implement browser-safe derivation and confirmation**

Keep canonical seed normalization in one module. The Panel derives the
suggestion from the current Profile, labels it inferred/confirmation-required,
and materializes it only in the local Profile passed to `confirmAgentProfile`.
Do not change Profile Refresh, Profile Search wire contracts, or their cache
versions.

**Step 5: Run GREEN, i18n, and request-shape regressions**

Run the RED command and, if messages changed:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/agents/agent-messages.test.ts
```

Expected: all pass in English and Chinese.

### Task 4: Integrated completion gates

**Files:**
- Modify only production/test files required by Tasks 1–3.
- Modify for the reviewed run/live separation:
  `apps/marketing/src/components/agents/agent-intent.ts`,
  `apps/marketing/src/components/agents/agent-workbench.tsx`, and their exact
  tests.
- Add durable release evidence under the existing visualization/release
  evidence directory; do not commit generated screenshots unless repository
  policy requires them.

**Step 1: Run combined focused tests**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/agents/audit-contract.test.ts \
  apps/marketing/src/lib/agents/audit-handler.test.ts \
  apps/marketing/src/components/agents/agent-display-contract.test.ts \
  apps/marketing/src/components/agents/agent-competitor-candidates.test.ts \
  apps/marketing/src/components/agents/agent-profile-search-seeds.test.ts \
  apps/marketing/src/components/agents/agent-profile-panel.test.tsx \
  apps/marketing/src/components/agents/agent-workbench.test.tsx \
  apps/marketing/src/components/agents/agent-intent.test.ts \
  apps/marketing/src/components/agents/agent-messages.test.ts
```

The integrated suite must also prove the v4 dual-snapshot pending intent:

- `confirmedProfile` carries the materialized outbound run;
- `editableProfile` restores only real manual state;
- same-tab, signed-out storage, mount reload, focus resume, and API-level
  `auth_required` race use the correct snapshot;
- missing/malformed/mismatched snapshots fail closed;
- v1-v3 slots are removed and the original TTL is preserved.

**Step 2: Run package and repository gates**

```bash
pnpm --filter @sf/marketing lint
pnpm --filter @sf/marketing typecheck
pnpm test
pnpm lint
pnpm typecheck
pnpm --filter @sf/marketing build
pnpm secrets:scan
git diff --check
```

**Step 3: Run Agent browser coverage**

Run the standalone Marketing Playwright suite, including the existing Agent
flow and a new deterministic assertion that the current browser sends the
contract marker and confirmation sends the effective query/competitors. Do not
invoke a paid production provider for this automated gate.

**Step 4: Perform two-stage independent review**

First run a spec-compliance review against the approved design. Fix every gap
and re-review. Only after spec approval, run a code-quality/security review and
fix/re-review every finding.

**Step 5: Commit and push the immutable candidate**

Inspect the final diff and secrets output, then commit only intended files and
push `fix/seo-agent-remediation-20260820`. Do not merge `origin/main`.

**Step 6: Deploy only the Marketing project**

Follow `docs/INFRASTRUCTURE.md` and the Vercel deployment guidance. Bind the
Marketing deployment to the new commit SHA and do not deploy `apps/web`.

**Step 7: Production canary**

- Confirm the new deployment is READY and owns `gengrowth.ai` aliases.
- Confirm the deployed Git SHA equals the pushed candidate.
- Prove the Product deployment ID and Git SHA are unchanged.
- Verify a fresh tab receives the new bundle and advertises the capability.
- Verify the preserved old tab can receive a legacy-compatible core audit only
  after obtaining action-time confirmation if the click may spend provider
  quota.
- Verify competitors/query render and confirm through non-paid deterministic
  browser seams; do not claim paid-provider success without an authorized run.

**Step 8: Completion audit**

Map every design acceptance item to current source, test output, deployment
metadata, or browser evidence. Do not mark complete while any item is missing or
indirect.
