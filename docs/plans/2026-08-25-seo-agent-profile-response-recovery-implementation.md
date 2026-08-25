# SEO Agent Profile Response Recovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make SEO Agent Profile Diagnosis preserve independently valid model fields, downgrade only invalid fields to `unavailable`, and expose safe Vercel stage diagnostics instead of returning an opaque whole-response 502 for one bad field.

**Architecture:** Keep the existing strict public `AgentProfileRefreshData` contract. Add a model-boundary recovery step that validates each expected field by reusing the strict contract guard, then deterministically fills invalid/missing/duplicate paths as unavailable. Add bounded structured stage logging at the handler's existing invalid-response exits; do not log payload data.

**Tech Stack:** TypeScript, Next.js Route Handlers, Vitest, existing `AgentProfileRefreshField` guards, Vercel runtime logs.

---

### Task 1: Prove and fix field-level recovery

**Files:**
- Modify: `apps/marketing/src/lib/agents/profile-refresh-prompt.test.ts`
- Modify: `apps/marketing/src/lib/agents/profile-refresh-prompt.ts`

**Step 1: Write the failing parser/synthesis test**

Add a test whose first reply contains all expected paths but makes one
available field invalid (for example, an off-crawl evidence URL). Assert that:

- synthesis returns 22 fields;
- the invalid path is returned as `state: "unavailable"`, `value: null`, and
  `evidenceUrls: []`;
- another valid path is preserved exactly;
- the model client is called once, not twice.

**Step 2: Run the test and verify RED**

Run:

```bash
pnpm exec vitest run --project unit apps/marketing/src/lib/agents/profile-refresh-prompt.test.ts
```

Expected: FAIL because the current parser rejects the full reply and performs
the second attempt.

**Step 3: Implement the smallest field-level recovery**

In `profile-refresh-prompt.ts`:

- create a deterministic unavailable field for an expected path;
- inspect candidates by exact `path`;
- accept a path only when exactly one candidate independently passes the
  existing `isAgentProfileRefreshFields` guard against the crawl URL set;
- replace every other path with the unavailable field;
- return `null` if the root is malformed or no candidate field is independently
  valid;
- keep the final output ordered by `AGENT_PROFILE_REFRESH_FIELD_PATHS`;
- retain the existing whole-response retry only for that total failure case.

Do not trim, coerce, or reuse invalid model values.

**Step 4: Run the focused test and verify GREEN**

Run the command from Step 2. Expected: all prompt tests PASS.

**Step 5: Add the all-invalid regression**

Keep or strengthen the existing test proving two wholly unusable replies still
throw `KeywordLlmError` with `reason: "schema_invalid"` and issue exactly two
requests.

**Step 6: Run the prompt suite again**

Expected: PASS with no unexpected console output.

**Step 7: Do not commit**

Repository authority requires explicit commit permission, which the user has
not granted. Leave the reviewed diff local.

### Task 2: Bound the prompt and invalidate stale prompt cache identity

**Files:**
- Modify: `apps/marketing/src/lib/agents/profile-refresh-prompt.test.ts`
- Modify: `apps/marketing/src/lib/agents/profile-refresh-prompt.ts`

**Step 1: Write a failing prompt-contract test**

Assert the generated prompt explicitly bounds string, list, list-item, and
limitation lengths below the existing wire maxima and asks for concise values.
Assert `PROFILE_REFRESH_PROMPT_SET_VERSION` is the new v2 literal.

**Step 2: Verify RED**

Run the focused prompt test. Expected: FAIL because v1 has no concise output
guidance.

**Step 3: Add minimal prompt guidance and bump the version**

Change only the prompt version and FIELD CONTRACT wording. Do not change the
public `agent_profile_refresh.v1` wire schema.

**Step 4: Verify GREEN**

Run the focused prompt suite. Expected: PASS.

**Step 5: Do not commit**

Keep changes local pending explicit authorization.

### Task 3: Add safe invalid-stage diagnostics

**Files:**
- Modify: `apps/marketing/src/lib/agents/profile-refresh-handler.test.ts`
- Modify: `apps/marketing/src/lib/agents/profile-refresh-handler.ts`

**Step 1: Write failing logging tests**

For model-schema, cached-gate, cached-envelope, and fresh-envelope failures,
assert a dependency-injected diagnostic sink receives only a bounded object
such as:

```ts
{
  event: "agent_profile_refresh_invalid",
  stage: "model_schema" | "cached_gate" | "cached_envelope" | "fresh_envelope",
  agent: "seo" | "tech",
  requestCount: number | null,
  retryCount: number | null,
}
```

Assert serialized diagnostics do not contain request URLs, field values, model
content, headers, or error messages.

**Step 2: Verify RED**

Run:

```bash
pnpm exec vitest run --project unit apps/marketing/src/lib/agents/profile-refresh-handler.test.ts
```

Expected: FAIL because no diagnostic sink exists.

**Step 3: Implement the diagnostic sink**

- Add the sink to `AgentProfileRefreshHandlerDependencies` and
  `DEFAULT_DEPENDENCIES`.
- Production default emits one JSON line to `console.error` for Vercel.
- Call it immediately before each existing `profile_response_invalid` 502.
- For `KeywordLlmError("schema_invalid")`, include only its numeric usage
  counters; otherwise use null counters.
- Preserve every existing public status code and body.

**Step 4: Verify GREEN**

Run the handler suite. Expected: PASS without leaking payload text.

**Step 5: Do not commit**

Keep the local diff uncommitted.

### Task 4: Focused and adjacent verification

**Files:**
- Verify only; no new files expected.

**Step 1: Run the profile regression set**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/agents/profile-refresh-prompt.test.ts \
  apps/marketing/src/lib/agents/profile-refresh-handler.test.ts \
  apps/marketing/src/lib/agents/profile-refresh-contract.test.ts \
  apps/marketing/src/components/agents/agent-workbench.test.tsx
```

Expected: all tests PASS.

**Step 2: Run Marketing static gates**

Use the exact scripts exposed by `apps/marketing/package.json`, including its
typecheck and lint commands. Expected: PASS.

**Step 3: Run the Marketing build**

Run the Marketing workspace build without deploying. Expected: PASS.

**Step 4: Review the final diff**

Run:

```bash
git diff --check
git status --short --branch
git diff -- apps/marketing/src/lib/agents/profile-refresh-prompt.ts \
  apps/marketing/src/lib/agents/profile-refresh-prompt.test.ts \
  apps/marketing/src/lib/agents/profile-refresh-handler.ts \
  apps/marketing/src/lib/agents/profile-refresh-handler.test.ts
```

Expected: only approved Marketing profile-diagnosis files plus these two local
plan documents are changed; no secrets, lockfile drift, or unrelated edits.

**Step 5: Stop before external actions**

Do not commit, push, open a PR, deploy, change Vercel settings, or call the
production Profile Diagnosis endpoint without separate user authorization.
