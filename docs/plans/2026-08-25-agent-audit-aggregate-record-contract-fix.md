# Agent Audit Aggregate Record Contract Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the browser accept the existing, truthful Search Performance records that contain one aggregate summary plus exactly `affected` URL details, without weakening any other record guard.

**Architecture:** Keep the producer and wire versions unchanged. Extend the shared `isSearchPerformanceRecord` boundary with one strict validator used only for `abandoned_url_impression_share` and `sitemap_url_not_indexed`; every other record remains governed by the existing `affected === observations.length` invariant.

**Tech Stack:** TypeScript strict ESM, Vitest unit project, pnpm workspace, Next.js 16 Marketing app.

---

### Task 1: Capture production-shaped RED

**Files:**
- Modify: `packages/public-tools/src/agent-audit/abandoned-impressions.test.ts`
- Modify: `packages/public-tools/src/agent-audit/index-coverage.test.ts`
- Modify: `apps/marketing/src/lib/agents/audit-contract.test.ts`

**Step 1: Add the observed abandoned-URL contract assertion**

Import `isSearchPerformanceRecord` from `../seo-audit/contract.ts`. Build the
existing 70/30 live/gone fixture through `buildSearchPerformanceRecords`, select
`abandoned_url_impression_share`, and assert:

```ts
expect(record).toMatchObject({
  state: "observed",
  tested: 2,
  affected: 1,
});
expect(record?.observations).toHaveLength(2);
expect(isSearchPerformanceRecord(record)).toBe(true);
```

Add a zero-gone case proving a valid summary-only observed record is accepted.

**Step 2: Add the observed Index Coverage contract assertion**

Import `isSearchPerformanceRecord`, build one PASS plus one NEUTRAL entry through
`buildIndexCoverageRecords`, and assert the same summary-plus-detail relation is
accepted. Add an all-PASS summary-only case.

**Step 3: Add the complete Agent-envelope regression**

In `audit-contract.test.ts`, use the real builders to replace only the Search
Performance region in a success envelope with six Search Performance records,
one observed Index Coverage record, and at least one resolved abandoned URL.
Assert `isAgentAuditSuccessEnvelope(...) === true`.

**Step 4: Run RED**

Run:

```bash
pnpm exec vitest run --project unit \
  packages/public-tools/src/agent-audit/abandoned-impressions.test.ts \
  packages/public-tools/src/agent-audit/index-coverage.test.ts \
  apps/marketing/src/lib/agents/audit-contract.test.ts
```

Expected: only the new observed aggregate-record assertions fail because the
current shared guard rejects one summary plus `affected` details.

### Task 2: Implement the narrow strict guard

**Files:**
- Modify: `packages/public-tools/src/seo-audit/contract.ts`
- Test: `packages/public-tools/src/agent-audit/abandoned-impressions.test.ts`
- Test: `packages/public-tools/src/agent-audit/index-coverage.test.ts`

**Step 1: Add value and exact-label helpers**

Add private helpers beside `isRecordOfCategory` that read one named evidence
value and verify the exact label sequence of an observation. They must not be
exported or used by other categories.

**Step 2: Add a two-ID aggregate-detail validator**

After the common field and evidence-value checks, route only the two known IDs
through a private validator. The implementation must enforce this shape:

```ts
record.state === "observed"
record.tested > 0
record.affected <= record.tested
record.observations.length === record.affected + 1
```

For `abandoned_url_impression_share`, require the exact four summary labels,
the exact two detail labels, a finite share in `[0, 1]`, non-negative finite
impression counts, a non-empty property matching the summary URL, and the exact
limitation literal.

For `sitemap_url_not_indexed`, require a `null` summary URL, the exact two
summary labels, a finite coverage rate in `[0, 1]`, inspected count equal to
`tested`, exact one-label URL details with a non-PASS canonical verdict, and the
exact limitation literal.

Known aggregate IDs in any non-`unverified` malformed state must return false
immediately; they must not fall back to the generic invariant. Unverified forms
continue through the existing generic path.

**Step 3: Add fail-closed malformed cases**

For both real builder outputs, clone and separately corrupt:

- summary removal;
- `affected`/detail mismatch;
- out-of-range aggregate share;
- wrong summary label;
- empty detail URL;
- wrong limitation.

Assert every corruption is rejected by `isSearchPerformanceRecord`.

**Step 4: Run GREEN**

Run the Task 1 command. Expected: all pass.

**Step 5: Commit the implementation**

```bash
git add \
  packages/public-tools/src/seo-audit/contract.ts \
  packages/public-tools/src/agent-audit/abandoned-impressions.test.ts \
  packages/public-tools/src/agent-audit/index-coverage.test.ts \
  apps/marketing/src/lib/agents/audit-contract.test.ts
git commit -m "fix(marketing): accept aggregate audit evidence records"
```

### Task 3: Verify and release

**Files:**
- Verify only; no additional production files expected.

**Step 1: Run adjacent tests**

```bash
pnpm exec vitest run --project unit \
  packages/public-tools/src/seo-audit \
  packages/public-tools/src/agent-audit \
  apps/marketing/src/lib/agents/audit-contract.test.ts \
  apps/marketing/src/lib/agents/audit-handler.test.ts \
  apps/marketing/src/components/agents/agent-display-contract.test.ts \
  apps/marketing/src/components/agents/agent-display-vocabulary.test.ts \
  apps/marketing/src/components/agents/agent-audit-model.test.ts \
  apps/marketing/src/components/agents/agent-messages.test.ts \
  apps/marketing/src/i18n/messages.test.ts
```

**Step 2: Run static and production gates**

```bash
pnpm exec eslint \
  packages/public-tools/src/seo-audit/contract.ts \
  packages/public-tools/src/agent-audit/abandoned-impressions.test.ts \
  packages/public-tools/src/agent-audit/index-coverage.test.ts \
  apps/marketing/src/lib/agents/audit-contract.test.ts
pnpm --filter @sf/public-tools typecheck
pnpm --filter @sf/marketing typecheck
pnpm --filter @sf/marketing build
pnpm secrets:scan
git diff --check
```

**Step 3: Independent review**

Obtain one spec-compliance review and one correctness/fail-closed review. Fix
any Critical or Important finding with another RED→GREEN cycle.

**Step 4: Merge and push**

Re-fetch `origin/main`, verify no unreviewed drift, merge the isolated branch
into the exact current `main`, and push to `phananhson733-oss/nevermore.git`.

**Step 5: Verify production**

Wait for `gengrowth-agents` production READY at the pushed SHA. Verify aliases,
`HTTP 200`, runtime errors, and independently prove `app.gengrowth.ai` kept its
prior production deployment. From the already authenticated browser, run one
URL-only cached audit request and pass the full raw body through the exact local
`isAgentAuditSuccessEnvelope` and `supportsAgentDisplayVocabulary` functions.
Do not send target queries or invoke LLM/DataForSEO.
