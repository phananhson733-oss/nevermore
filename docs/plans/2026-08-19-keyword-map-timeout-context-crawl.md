# Keyword Map Timeout and Context Crawl Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent production candidate expansion from being aborted by the context-call deadline and make the bounded context crawler fill its 14-page result from safe ranked candidates whenever enough readable pages exist.

**Architecture:** Add a request-level LLM deadline used only by candidate expansion. Broaden the context path threshold only through the maximum depth-only penalty, then fetch ranked candidates in deterministic replenishment batches and assign the final stop reason after the actual outcome is known.

**Tech Stack:** TypeScript 5.9, Vitest 4, pnpm monorepo, Next.js Route Handlers, `@sf/sources` guarded public HTTP transport.

---

### Task 1: Prove candidate expansion needs its own deadline

**Files:**
- Modify: `apps/marketing/src/lib/tools/keyword-llm-client.test.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-prompts.test.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-llm-client.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-prompts.ts`

**Step 1: Write the failing tests**

- Capture the request passed by `expandKeywordCandidates` and expect a
  90-second request deadline.
- Prove a request-level deadline overrides the client's 45-second default.
- Prove requests without an override still use the default.

**Step 2: Verify RED**

Run:

```bash
pnpm vitest run apps/marketing/src/lib/tools/keyword-llm-client.test.ts apps/marketing/src/lib/tools/keyword-prompts.test.ts
```

Expected: the new request-level deadline assertions fail because
`KeywordLlmRequest` has no deadline field and expansion inherits 45 seconds.

**Step 3: Implement the minimum behavior**

- Add `KEYWORD_EXPANSION_LLM_TIMEOUT_MS = 90_000`.
- Add a required-or-optional request deadline field without adding a new client
  abstraction.
- Resolve the timer from the request override first, then the injected test
  option, then `KEYWORD_LLM_TIMEOUT_MS`.
- Set the override only in `expandKeywordCandidates`.

**Step 4: Verify GREEN**

Run the Task 1 command and expect both files to pass.

### Task 2: Admit safe custom product paths as low-priority context

**Files:**
- Modify: `packages/sources/src/crawl/page-value.test.ts`
- Modify: `packages/sources/src/crawl/page-value.ts`

**Step 1: Write the failing test**

Assert that an unknown depth-two and depth-three path is crawlable, while
`/blog/post`, `/privacy`, and a foreign-locale equivalent remain excluded.

**Step 2: Verify RED**

Run:

```bash
pnpm vitest run packages/sources/src/crawl/page-value.test.ts
```

Expected: depth-two/depth-three custom paths are rejected by the current zero
threshold.

**Step 3: Implement the minimum behavior**

Set the minimum crawlable score to the maximum depth-only penalty (`-4`) and
update the comments that define the ranking contract.

**Step 4: Verify GREEN**

Run the Task 2 command and expect it to pass.

### Task 3: Replenish failed context candidates

**Files:**
- Modify: `packages/sources/src/crawl/context-profile-failures.test.ts`
- Modify: `packages/sources/src/crawl/context-profile.test.ts`
- Modify: `packages/sources/src/crawl/context-profile.ts`

**Step 1: Write the failing tests**

- Create more than 13 safe candidates; make three high-ranked candidates return
  404, 500, and a transport timeout; expect later candidates to fill all 14
  result pages.
- Create the `aistorygenerator.work` path shape and expect custom depth-two
  generator pages to fill the result to 14.
- Force a budget stop during replenishment and expect its real reason, not
  `max_urls`.

**Step 2: Verify RED**

Run:

```bash
pnpm vitest run packages/sources/src/crawl/context-profile.test.ts packages/sources/src/crawl/context-profile-failures.test.ts
```

Expected: the result stays below 14 and/or reports the old premature stop
reason.

**Step 3: Implement the minimum behavior**

- Extract the existing one-candidate fetch body without changing its rules.
- Run deterministic batches sized to the remaining successful-page slots.
- Break replenishment on a real budget stop.
- Assign `max_urls` only after 14 successful pages when unattempted candidates
  remain.

**Step 4: Verify GREEN**

Run the Task 3 command and expect both files to pass.

### Task 4: Verify the complete change

**Files:**
- Inspect all files changed by Tasks 1-3.

**Step 1: Run focused regressions**

```bash
pnpm vitest run packages/sources/src/crawl/page-value.test.ts packages/sources/src/crawl/context-profile.test.ts packages/sources/src/crawl/context-profile-failures.test.ts apps/marketing/src/lib/tools/keyword-llm-client.test.ts apps/marketing/src/lib/tools/keyword-prompts.test.ts apps/marketing/src/lib/tools/keyword-opportunity-handler.test.ts
```

**Step 2: Run package checks**

```bash
pnpm --filter @sf/sources typecheck
pnpm --filter @sf/sources lint
pnpm --filter @sf/marketing typecheck
pnpm --filter @sf/marketing lint
```

**Step 3: Run repository checks**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm verify:spec
pnpm verify:docs
pnpm secrets:scan
git diff --check
```

**Step 4: Run bounded live crawl**

Invoke `crawlSiteContextProfile("https://aistorygenerator.work")` through the
guarded transport and assert/report 14 pages without running LLM or DataForSEO.

**Step 5: Review**

Request an independent diff review, fix only actionable findings, rerun the
affected checks, and report any unrelated baseline failures separately.

