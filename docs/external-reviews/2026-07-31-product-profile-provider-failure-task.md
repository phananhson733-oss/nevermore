# ChatGPT Pro Engineering Review Task: Production Product Profile Generation Failure

## Background

GenGrowth is a Chinese-first customer growth workspace. The customer-facing Web application runs on Vercel at `app.gengrowth.ai`; asynchronous collection, audit, and Product Profile synthesis jobs run in a persistent Railway Worker. Supabase/PostgreSQL is the canonical ledger and state store.

A customer supplied the basic Product/ICP inputs, successfully completed the website crawl, and then selected “Generate initial profile.” The Web command returned `202 Accepted`, but the asynchronous Product Profile synthesis run failed and the customer saw only a generic “try again later” message.

## Confirmed Production Evidence

The following findings were collected without printing or exporting any credential:

- The Vercel Web application accepted the synthesis command and polled the resulting run normally.
- The Railway Worker remained ready, dequeued the Product Profile synthesis job, and attempted the provider invocation three times.
- Every invocation failed before an HTTP response as `NETWORK_ERROR`; no token usage or provider request ID was recorded.
- After the final queue retry, the recovery layer replaced `NETWORK_ERROR` with `QUEUE_RETRY_EXHAUSTED`.
- The Product Profile page ignored `run.lastError` and rendered one generic failure message for every non-completed terminal state.
- The Worker selected Azure OpenAI because a complete Azure variable set takes precedence over Direct OpenAI.
- Secret-safe validation showed:
  - the configured Azure endpoint had no terminal A/AAAA DNS result;
  - the Azure deployment variable contained a literal escaped newline suffix;
  - the Direct OpenAI key was an obvious placeholder and therefore was not a usable fallback.

This establishes a production configuration failure compounded by two observability/customer-feedback defects. It does not establish that Railway, Vercel, Supabase, crawl collection, or the Product/ICP inputs were unavailable.

## Current Architecture and Boundaries

- Nevermore remains the system of record; GenGrowth is the customer-facing brand.
- Keep the existing four-module customer workspace and its current visual baseline.
- Do not redesign the Product Profile page, navigation, cards, or Chinese-first presentation.
- The Railway Worker remains the asynchronous execution platform.
- Azure OpenAI and Direct OpenAI are two endpoint/auth modes of the existing `openai` provider abstraction.
- A complete Azure variable set intentionally wins over Direct OpenAI.
- Production credentials must remain in platform secret stores and must never be printed, copied into source, uploaded, logged, or returned to the browser.
- No database migration is authorized or needed for this fix.
- No mock/offline fallback may be represented as a successful production AI generation.

## Candidate Patch Scope

Review the candidate changes in:

- `apps/worker/src/env.ts`
- `apps/worker/src/env.test.ts`
- `apps/worker/src/handlers/recovery.ts`
- `apps/worker/src/handlers/recovery.test.ts`
- `apps/web/src/app/p/[projectId]/context/_product-profile-onboarding.ts`
- `apps/web/src/app/p/[projectId]/context/_product-profile-onboarding.test.ts`
- `apps/web/src/app/p/[projectId]/context/_product-profile.tsx`
- `packages/i18n/src/messages/zh-CN.json`
- `packages/i18n/src/messages/en.json`

Relevant unchanged context is also included:

- Worker Product Profile runner and transient retry behavior
- Unified async run DTO and polling hook
- Product Profile synthesis service and route
- LLM transport/client configuration
- Worker startup/context wiring
- repository constraints, package scripts, and CI workflow

## Required Review

Act as an external senior engineer. Review the source and candidate patch independently. Do not assume the candidate implementation is correct.

1. Confirm or refute the production root-cause chain from the supplied code and evidence.
2. Audit the Worker environment validation for:
   - false positives against legitimate Direct or Azure OpenAI configurations;
   - false negatives for placeholder values, leading/trailing whitespace, actual newlines, and literal `\n`/`\r` contamination;
   - secret-safe error handling;
   - preservation of complete-Azure-set precedence and partial-set fail-closed behavior.
3. Audit queue retry exhaustion behavior for:
   - preservation of a stable safe canonical root cause;
   - absence of raw exception/provider/credential leakage;
   - compatibility with every run kind using the shared recovery handler;
   - correct behavior when no safe prior cause exists.
4. Audit the customer-visible Product Profile error mapping for:
   - safe use of `run.lastError`;
   - distinct Chinese-first handling of configuration/auth, temporary provider/network, input/crawl evidence, operator review, superseded, cancelled, and unknown failures;
   - no rendering of raw provider summaries or internal identifiers;
   - no change to the approved visual baseline.
5. Identify missing regression tests, type/API contract drift, race conditions, or cases where the UI could encourage harmful duplicate generation.
6. Recommend the smallest complete correction. If the candidate patch is wrong, provide a minimal unified diff or exact file/function-level edits.

## Required Deliverables

- An evidence-backed review report with severity-ranked findings.
- A clear verdict: `approve`, `approve with required corrections`, or `reject`.
- For every required correction:
  - file and symbol;
  - exact defect;
  - why it matters in production;
  - minimal corrective patch;
  - regression test.
- A production verification checklist that proves a real Railway Worker provider invocation completed and a real Product Profile draft was generated.

## Required Tests

At minimum, the final candidate must pass:

- targeted Worker env and LLM config unit tests;
- targeted Worker recovery tests;
- targeted Product Profile onboarding/error mapping tests;
- i18n parity tests;
- Worker and Web type checks;
- Worker, Web, and i18n lint;
- repository secret scan;
- full repository unit/integration tests;
- OpenAPI generation/check/lint gates;
- production build and Worker image build;
- repository real and mock E2E gates;
- GitHub CI on both push and pull-request event paths without reruns.

## Prohibited Actions and Claims

- Do not deploy, push, merge, create a PR, change Railway/Vercel/Supabase/GitHub settings, or access production.
- Do not request, infer, fabricate, or include credentials.
- Do not add a mock provider or silent deterministic fallback and call it production AI.
- Do not claim DNS, provider authentication, model deployment, or live generation is verified from local tests.
- Do not broaden this fix into a Product Profile redesign or database migration.

## Acceptance Criteria

The fix is acceptable only when:

1. malformed or placeholder model configuration cannot make the Worker appear ready;
2. a transient provider failure retains a safe useful root cause after queue retry exhaustion;
3. the customer sees an honest, actionable Chinese message based on the terminal run category without seeing raw provider details;
4. legitimate supported provider configurations remain valid;
5. all required tests pass;
6. Railway production variables are corrected before the stricter Worker build is deployed;
7. Vercel Web and Railway Worker run the same merge SHA;
8. a live Product Profile synthesis canary reaches `completed` and generates real editable fields from the frozen crawl evidence.
