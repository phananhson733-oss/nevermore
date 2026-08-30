# GEO Brief Production Enablement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable the deployed Marketing GEO Brief on Azure OpenAI without losing its independent configuration, quota, evidence, or release boundaries.

**Architecture:** Keep DataForSEO sampling on the existing GEO Agent transport and keep Brief assembly on the bounded `keyword-llm-client` transport. Extend only the GEO Brief scoped resolver with the established prefixed configuration shape and `0..2` temperature range, while making an explicitly invalid value disable the whole config; then configure the Marketing Vercel project with a complete Azure-specific `GEO_BRIEF_*` set.

**Tech Stack:** TypeScript, Vitest, Next.js 16 Marketing app, Vercel, Azure OpenAI Chat Completions, DataForSEO ChatGPT LLM Responses.

---

### Task 1: Freeze the approved scope and baseline

**Files:**
- Modify: `docs/plans/2026-08-30-marketing-geo-brief-production-enable-design.md`
- Create: `docs/plans/2026-08-30-marketing-geo-brief-production-enable-implementation.md`

**Step 1: Record the existing GEO Agent boundary**

Confirm with `rg` that `apps/marketing/src/lib/agents/geo-provider.ts` reads only `DATAFORSEO_LOGIN/PASSWORD` and does not resolve Azure/OpenAI assembly configuration.

**Step 2: Record the correct environment-template owner**

Read `.env.gengrowth-production.template` and preserve its Product/Railway statement that Product Vercel Web receives no LLM secrets. Keep Marketing variables in `apps/marketing/.env.example` and `docs/INFRASTRUCTURE.md` only.

**Step 3: Verify baseline**

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/geo-tools/brief-llm.test.ts \
  apps/marketing/src/lib/geo-tools/brief-handler.test.ts
pnpm --filter @sf/marketing typecheck
```

Expected: 34 tests pass and typecheck exits 0.

**Step 4: Commit the approved design**

Commit only the design and plan documentation before production-code changes.

### Task 2: RED — prove the missing pinned temperature

**Files:**
- Modify: `apps/marketing/src/lib/geo-tools/brief-llm.test.ts`
- Test: `apps/marketing/src/lib/geo-tools/brief-llm.test.ts`

**Step 1: Write the resolver test**

Extend the Azure override case so it supplies:

```ts
GEO_BRIEF_TEMPERATURE: "1"
```

and asserts:

```ts
expect(config?.temperature).toBe(1);
```

**Step 2: Write invalid-value cases**

Add a table test for `"abc"`, `"3"`, `"-1"`, `""`, `"   "`, `"NaN"`, and `"Infinity"`. Even with a valid key/model, each explicitly present invalid value must make the entire resolver return `null`; it must not silently become an unpinned task-default request.

**Step 3: Write the transport-effective test**

Use the real `createKeywordLlmClient` with an injected fetch. Resolve a GEO Brief config pinned to `1`, call `runGeoBriefLlm`, parse the request body, and assert the effective request temperature is `1`, not the task default `0.2`.

**Step 4: Run RED**

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/geo-tools/brief-llm.test.ts
```

Expected against the baseline: the new `temperature === 1` assertion fails because the resolver is always unpinned, and the present-invalid cases fail because the resolver still returns an otherwise usable config. These failures specify both the provider override and the fail-closed boundary.

### Task 3: GREEN — implement the minimal scoped resolver

**Files:**
- Modify: `apps/marketing/src/lib/geo-tools/brief-llm.ts`
- Test: `apps/marketing/src/lib/geo-tools/brief-llm.test.ts`

**Step 1: Add bounded parsing**

Add a module-local `pinnedTemperature(env, key)` parser for the accepted provider range (`0..2`). Distinguish an absent key from an explicitly present invalid value:

```ts
function pinnedTemperature(
  env: Record<string, string | undefined>,
  key: string,
):
  | { readonly valid: true; readonly value: number | null }
  | { readonly valid: false } {
  const raw = env[key];
  if (raw === undefined) return { valid: true, value: null };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { valid: false };
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 && value <= 2
    ? { valid: true, value }
    : { valid: false };
}
```

**Step 2: Wire only the GEO Brief prefix**

Parse only the GEO Brief key, reject an invalid result before constructing the provider config, and then wire the parsed value:

```ts
const temperature = pinnedTemperature(
  env,
  `${GEO_BRIEF_ENV_PREFIX}_TEMPERATURE`,
);
if (!temperature.valid) return null;

// ...inside the config
temperature: temperature.value,
```

Do not add fallback to any neighbouring prefix or global Azure/OpenAI variables.

**Step 3: Run GREEN**

Run the Task 2 command. Expected: all `brief-llm` tests pass.

**Step 4: Run adjacent regression tests**

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/geo-tools/brief-llm.test.ts \
  apps/marketing/src/lib/geo-tools/brief-handler.test.ts \
  apps/marketing/src/lib/tools/keyword-llm-client.test.ts \
  apps/marketing/src/lib/tools/content-brief-llm.test.ts
```

Expected: all pass with no output warnings.

**Step 5: Commit code and tests**

Commit only `brief-llm.ts` and `brief-llm.test.ts` as one bug fix.

### Task 4: Publish the Marketing environment contract

**Files:**
- Modify: `apps/marketing/.env.example`
- Modify: `docs/INFRASTRUCTURE.md`
- Modify: `docs/plans/2026-08-29-marketing-geo-tools-implementation.md`

**Step 1: Add non-secret Marketing variables**

Document `DATAFORSEO_LOGIN/PASSWORD` and this exact GEO Brief set in `apps/marketing/.env.example`:

```dotenv
GEO_BRIEF_API_KEY=
GEO_BRIEF_MODEL=
GEO_BRIEF_URL=
GEO_BRIEF_AUTH_SCHEME=bearer
GEO_BRIEF_TEMPERATURE=0.2
```

Explain that direct OpenAI-compatible usage defaults to the standard Chat Completions URL, bearer auth, and task temperature `0.2` when the temperature variable is absent. Azure uses a full deployment Chat Completions URL including `api-version`, `api-key`, and its deployment-required temperature (`1` for the current `gpt-5.6-luna`). Explicitly present empty/whitespace/nonnumeric/out-of-range temperature disables the provider config; it never falls back to `0.2`.

**Step 2: Update infrastructure ownership**

Extend the `gengrowth-agents` column in `docs/INFRASTRUCTURE.md`; list all five names explicitly and do not put Marketing secrets in Product `nevermore` or Railway columns. Record Production as the owner, with Preview configured only for an authorized authenticated/billable candidate, and do not imply the five variables are already present.

**Step 3: Record the defect and release contract**

Append a dated closeout to the existing GEO tools implementation record: production had DataForSEO but no `GEO_BRIEF_*`; existing Azure requires pinned temperature `1`; describe absent-versus-explicit-invalid fail-closed behavior without secret values; keep Vercel configuration, deployment, and canary as still-required activation evidence.

**Step 4: Verify documentation**

Run:

```bash
rg -n "GEO_BRIEF_(API_KEY|MODEL|URL|AUTH_SCHEME|TEMPERATURE)" \
  apps/marketing/.env.example docs/INFRASTRUCTURE.md \
  docs/plans/2026-08-29-marketing-geo-tools-implementation.md
git diff --check
```

Expected: all five names appear in both the Marketing env example and infrastructure ownership contract; no secret value or whitespace error appears.

**Step 5: Commit configuration documentation**

Commit only the Marketing env example and documentation changes.

### Task 5: Run release gates and independent review

**Files:**
- Review: exact branch diff against `origin/main`

**Step 1: Focused GEO regression**

Run all tests under `apps/marketing/src/lib/geo-tools`, the four GEO components, and the shared alias matcher.

Expected: all pass.

**Step 2: Package and repository gates**

Run:

```bash
pnpm --filter @sf/marketing typecheck
pnpm --filter @sf/marketing lint
pnpm exec vitest run --project unit apps/marketing
pnpm --filter @sf/marketing build
node scripts/verify-implementation.mjs
pnpm secrets:scan
```

Expected: patch-owned files are clean. If the known blog-count test or four untouched lint failures remain, prove they are unchanged from `origin/main` and report them as baseline exceptions rather than modifying unrelated files.

**Step 3: Inspect the exact diff**

Run `git diff --check origin/main...HEAD`, `git diff --stat origin/main...HEAD`, and review every changed line for scope, secrets, generated files, and accidental Product/Worker changes.

**Step 4: Independent reviewer**

Request a fresh code review focused on configuration isolation, Azure request temperature, fail-before-quota ordering, secret handling, and missing tests. Resolve every P0/P1 before release.

### Task 6: Push, PR, and merge the reviewed SHA

**Files:**
- No additional source changes unless review finds a defect

**Step 1: Push the feature branch**

Push without force and create a PR against `main` with test results and baseline exceptions.

**Step 2: Verify PR contents and checks**

Confirm the PR contains only the approved Marketing/config/docs files and the design/plan. Treat Vercel checks as build evidence only; local tests remain separate evidence.

**Step 3: Merge only the reviewed head SHA**

Record feature SHA and merge SHA. Do not infer deployment from merge status.

### Task 7: Configure and deploy Marketing

**Files:**
- External state: Vercel project `gengrowth-agents`

**Step 1: Derive Azure values without printing secrets**

Read the existing ignored local provider file. Validate presence of key, endpoint, deployment, API version, and temperature without printing the key. Construct the full Azure Chat Completions URL deterministically.

**Step 2: Set the dedicated Vercel variables**

Create/update `GEO_BRIEF_API_KEY`, `GEO_BRIEF_MODEL`, `GEO_BRIEF_URL`, `GEO_BRIEF_AUTH_SCHEME=api-key`, and `GEO_BRIEF_TEMPERATURE=1` in Marketing Production. Configure Preview only if the authenticated/billable candidate will be run there. Keep DataForSEO credentials unchanged.

**Step 3: Wait for exact Marketing deployment**

Verify the Production deployment is READY on the merge SHA and owns `gengrowth.ai` plus `www.gengrowth.ai`. Inspect build/runtime `error` and `fatal` logs.

**Step 4: Inspect Product independently**

Record any same-SHA Product candidate and the retained `app.gengrowth.ai` production SHA/health. Do not call Product unchanged without this check.

### Task 8: Production completion canary

**Files:**
- External state: production browser, Vercel, Supabase read-only catalog

**Step 1: Route and auth-boundary smoke**

Verify English/Chinese GEO routes, canonical host, `www` redirect, and safe unauthenticated `401` probes without provider calls.

**Step 2: Authenticate safely**

Reuse a valid production session. If login, account choice, CAPTCHA, Passkey, or 2FA is required, pause for the Owner without reading or storing credentials.

**Step 3: Verify Knowledge Base**

Load an owned knowledge base, save a deliberate draft, freeze once, and confirm revision/CAS behavior without modifying another user's data.

**Step 4: Run one paid Visibility canary**

Use an owned frozen version and run one authorized plan. Verify queued/running recovery, report rendering, model/surface, cost completeness, and successful append-only storage. Do not retry an ambiguous provider failure.

**Step 5: Run one GEO Brief canary**

Confirm `providerConfigured=true`, generate one Brief, and verify HTML, JSON, Markdown, copied source labels, frozen question identity, normalized target host, and no raw i18n keys. Confirm effective Azure temperature from sanitized provider/request evidence where available.

**Step 6: Read-only database verification**

When production catalog access is available, verify 0006/0007 tables, RLS, zero policies, ACLs, triggers, RPC execute grants, required helper, and FKs using SELECT-only queries. Do not rerun migrations or lifecycle DML smoke.

**Step 7: Completion audit**

Map every design requirement to current Git, test, Vercel, browser, provider, and database evidence. Mark the goal complete only when no required item remains unverified.
