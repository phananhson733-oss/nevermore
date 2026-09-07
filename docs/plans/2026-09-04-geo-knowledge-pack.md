# GEO Knowledge Pack Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add eight evidence-backed frozen GEO knowledge modules plus the complete question set in one consistent customer-facing system, and correct the question-table typography without exposing Product Profile or internal lineage data.

**Architecture:** Add a strict `marketing-geo-knowledge-pack.v1` companion contract and a prepared-candidate v2 union so immutable v2 history is not reinterpreted. Deterministic collection and assembly produce entity/fact/evidence/machine/coverage content; one durable, evidence-bound model generation produces definitions, Q&A, scope, and supported comparison prose. A fresh one-click v2 run has three separately metered model attempts (roles, knowledge, questions), while recovery reuses the original durable attempt. The customer renderer consumes only the pack and complete question set.

**Tech Stack:** TypeScript strict ESM, Zod, Next.js 16/React 19, Cheerio, existing SSRF-safe public fetch boundary, Supabase/PostgreSQL JSONB, Vitest/jsdom, Tailwind utilities.

---

### Task 1: Freeze the customer pack contract

**Files:**
- Create: `apps/marketing/src/lib/geo-tools/kb-knowledge-pack-contract.test.ts`
- Create: `apps/marketing/src/lib/geo-tools/kb-knowledge-pack-contract.ts`

**Step 1: Write the failing tests**

Cover an available pack, partial/unavailable modules, duplicate IDs, unknown
fields, invalid URLs/timestamps, unsupported source refs, unconfirmed competitor
refs, oversized arrays/text, numeric claims without exact evidence, and content
hash mismatch.

**Step 2: Run the tests and verify RED**

Run:

```bash
pnpm exec vitest run --project unit apps/marketing/src/lib/geo-tools/kb-knowledge-pack-contract.test.ts
```

Expected: FAIL because the contract module does not exist.

**Step 3: Implement the minimal strict contract**

Define discriminated availability states, customer modules, a bounded source
catalogue, exact evidence references, deterministic hashing, and parser/builder
functions. Do not include attachment example values.

**Step 4: Run the focused tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

### Task 2: Collect deterministic website knowledge evidence

**Files:**
- Create: `apps/marketing/src/lib/geo-tools/kb-knowledge-evidence.test.ts`
- Create: `apps/marketing/src/lib/geo-tools/kb-knowledge-evidence.ts`
- Modify: `apps/marketing/src/lib/geo-tools/kb-enrichment-deps.ts`

**Step 1: Write failing tests**

Test stable same-host page selection, duplicate removal, redirect rejection,
visible excerpt extraction, JSON-LD type observation, FAQ extraction,
hreflang, robots, sitemap, llms.txt, confirmed-competitor-only collection,
limits, partial failures, and no instruction execution from page text.

**Step 2: Verify RED**

Run the new test file; expected failure is the missing collector API.

**Step 3: Implement minimal deterministic collection**

Reuse the existing safe fetch transport and crawl gate. Fetch at most eight own
HTML pages, three machine resources, and two pages for each of at most five
confirmed competitors. Preserve typed availability and exact public sources.

**Step 4: Verify GREEN**

Run the focused test file and the existing enrichment tests.

### Task 3: Add evidence-bound knowledge narrative synthesis

**Files:**
- Create: `apps/marketing/src/lib/geo-tools/kb-knowledge-synthesis-contract.test.ts`
- Create: `apps/marketing/src/lib/geo-tools/kb-knowledge-synthesis-contract.ts`
- Create: `apps/marketing/src/lib/geo-tools/kb-knowledge-synthesis-prompts.ts`
- Create: `apps/marketing/src/lib/geo-tools/kb-knowledge-synthesis.test.ts`
- Create: `apps/marketing/src/lib/geo-tools/kb-knowledge-synthesis.ts`

**Step 1: Write failing parser and provider tests**

Assert known source refs, confirmed competitor scope, exact numeric support,
bounded Q&A/definition/comparison/scope output, unsupported-language preflight,
one provider call, invalid response handling, and `outcome_unknown` semantics.

**Step 2: Verify RED**

Run both new test files; expected failure is missing synthesis functions.

**Step 3: Implement the minimal synthesis adapter**

Use the existing pinned GEO LLM configuration and client. Persist only the
secret-free input/prompt version/provider metadata; never log credentials or
raw failure payloads.

**Step 4: Verify GREEN**

Run both new files and the existing GEO synthesis suite.

### Task 4: Assemble the final pack

**Files:**
- Create: `apps/marketing/src/lib/geo-tools/kb-knowledge-pack.test.ts`
- Create: `apps/marketing/src/lib/geo-tools/kb-knowledge-pack.ts`

**Step 1: Write failing assembly tests**

Prove accepted exact facts become atomic facts, machine observations remain
deterministic, model content keeps evidence refs, unavailable narrative leaves
deterministic modules visible, and coverage/gaps are customer-readable.

**Step 2: Verify RED**

Run the new test file; expected failure is a missing assembler.

**Step 3: Implement minimal pure assembly**

The assembler receives only the saved GEO payload, exact evidence bundle,
strict narrative result, and frozen question scope. It performs no fetch,
model call, store read, or current Profile lookup.

**Step 4: Verify GREEN**

Run the focused tests.

### Task 5: Version prepared candidates without rewriting history

**Files:**
- Modify: `apps/marketing/src/lib/geo-tools/kb-prepared-contract.test.ts`
- Modify: `apps/marketing/src/lib/geo-tools/kb-prepared-contract.ts`
- Modify: `apps/marketing/src/lib/geo-tools/kb-preparation.test.ts`
- Modify: `apps/marketing/src/lib/geo-tools/kb-preparation.ts`

**Step 1: Write failing compatibility tests**

Assert prepared v1 remains byte-exact/readable, prepared v2 requires a valid
pack, the pack hash participates in candidate identity, and mismatched
payload/evidence/question references fail closed.

**Step 2: Verify RED**

Run the two focused existing test files and confirm the new v2 expectations
fail.

**Step 3: Implement the candidate union and v2 assembler**

Do not change v1 parser semantics. Return an `AnyGeoPreparedCandidate` union and
make new preparation produce v2 only when a complete knowledge generation is
selected.

**Step 4: Verify GREEN**

Run both focused test files.

### Task 6: Add the durable knowledge-generation kind

**Files:**
- Modify: `apps/marketing/src/lib/geo-tools/kb-generation.test.ts`
- Modify: `apps/marketing/src/lib/geo-tools/kb-generation.ts`
- Modify: `apps/marketing/src/lib/geo-tools/kb-generation-store.test.ts`
- Modify: `apps/marketing/src/lib/geo-tools/kb-generation-store.ts`
- Modify: `apps/marketing/src/lib/geo-tools/kb-generation-preparer.test.ts`
- Modify: `apps/marketing/src/lib/geo-tools/kb-generation-preparer.ts`
- Modify: `apps/marketing/src/lib/geo-tools/kb-generation-handler.test.ts`
- Modify: `apps/marketing/src/lib/geo-tools/kb-generation-handler.ts`

**Step 1: Write failing state-machine tests**

Add `knowledge_pack` to the exact durable input/value union. Assert preflight
and evidence collection happen before reservation, one attempt is reserved,
stale inputs fail, successful output persists, and `outcome_unknown` is not
automatically retried.

**Step 2: Verify RED**

Run the four focused suites and confirm the missing generation kind fails.

**Step 3: Implement minimal runtime support**

Reuse the existing attempt ledger and provider accounting. Do not create a
second billing or retry implementation. A fresh complete run records one role,
one knowledge, and one question attempt; reloading or resuming a successful
knowledge attempt must not add another role or knowledge call.

**Step 4: Verify GREEN**

Run focused generation and synthesis suites.

### Task 7: Persist/freeze/read the pack companion

**Files:**
- Create: `apps/marketing/supabase/migrations/20260905155607_geo_knowledge_pack_companion.sql`
- Modify: `apps/marketing/src/lib/geo-tools/kb-prepared-store.test.ts`
- Modify: `apps/marketing/src/lib/geo-tools/kb-prepared-store.ts`
- Modify: `apps/marketing/src/lib/geo-tools/kb-versioned-read.test.ts`
- Modify: `apps/marketing/src/lib/geo-tools/kb-versioned-read.ts`
- Modify: `apps/marketing/src/lib/geo-tools/kb-complete-read.test.ts`
- Modify: `apps/marketing/src/lib/geo-tools/kb-complete-read.ts`

**Step 1: Write failing store/read tests**

Assert v2 candidates persist, the SQL validator accepts only known generation
kinds/schemas, freeze retains the exact prepared ID, owner-scoped reads load
the companion, v1 returns `null`, and malformed/foreign packs fail closed.

**Step 2: Verify RED**

Run the focused suites and SQL test harness; expected failure is the missing v2
candidate/knowledge generation SQL support.

**Step 3: Add forward-only SQL and readers**

Replace functions additively; do not alter or delete immutable history. Include
`prepared_id` in the exact snapshot read projection and read the prepared row
under the same user/KB/snapshot scope. Keep RLS enabled with no browser policies;
grant `service_role` only the reads and owner-scoped claim/finish/freeze RPCs it
needs, not direct writes.

**Step 4: Verify GREEN**

Run focused unit tests and marketing SQL integration against an explicit
disposable loopback database and a restored production backup. Apply the
migration twice, then verify validators, constraints, row-count preservation,
RLS, grants, and byte-exact v1/v2 history.

### Task 8: Wire the one-click flow and API

**Files:**
- Create: `apps/marketing/src/app/api/tools/geo-knowledge-base/v2/knowledge/route.test.ts`
- Create: `apps/marketing/src/app/api/tools/geo-knowledge-base/v2/knowledge/route.ts`
- Modify: `apps/marketing/src/lib/geo-tools/kb-v2-runtime.test.ts`
- Modify: `apps/marketing/src/lib/geo-tools/kb-v2-runtime.ts`
- Modify: `apps/marketing/src/components/tools/use-geo-kb-v2-editor.test.tsx`
- Modify: `apps/marketing/src/components/tools/use-geo-kb-v2-editor.ts`

**Step 1: Write failing route/workflow tests**

Assert save/sources/roles/knowledge/prepare/freeze order, no knowledge call on
language preflight failure, no silent retry after unknown delivery, and an
existing frozen question set or pack remains readable when a new generation is
not supported for the selected language. Cover a dropped successful knowledge
response recovered by its original key, reload recovery, and one-click resume
from the succeeded knowledge boundary without repeating roles or knowledge.

**Step 2: Verify RED**

Run the route, runtime, and hook suites and confirm missing wiring failures.

**Step 3: Implement minimal route/runtime/hook wiring**

Keep the existing explicit confirmation and error vocabulary. Do not trigger
calls merely by opening or expanding the GEO card.

**Step 4: Verify GREEN**

Run focused route/runtime/hook tests.

### Task 9: Render eight pack modules plus the complete question set

**Files:**
- Create: `apps/marketing/src/components/tools/geo-knowledge-pack.test.tsx`
- Create: `apps/marketing/src/components/tools/geo-knowledge-pack.tsx`
- Create: `apps/marketing/src/components/tools/geo-knowledge-pack.test-fixtures.ts`
- Create: `apps/marketing/src/components/tools/geo-knowledge-pack-copy.ts`
- Modify: `apps/marketing/src/components/tools/geo-kb-version-content.test.tsx`
- Modify: `apps/marketing/src/components/tools/geo-kb-version-content.tsx`
- Modify: `apps/marketing/src/components/tools/geo-knowledge-base-v2.test.tsx`
- Modify: `apps/marketing/src/components/tools/geo-knowledge-base-v2.tsx`

**Step 1: Write failing component tests**

Assert all customer modules, source links, partial/unavailable copy, responsive
labels, semantic headings, and exact DOM absence of Product Profile, competitor
identity, roles/review, receipts, hashes, versions, and internal IDs.

Add a regression assertion that question-policy sublines are block spans (or
explicitly 13px) rather than bare paragraphs affected by global `p` CSS.

**Step 2: Verify RED**

Run the focused component and browser-wire privacy files and confirm expected
failures.

**Step 3: Implement the renderer**

Reuse `GeoKbSection`, existing field/readout primitives, card recipe, colors,
spacing, and desktop-table/mobile-card pattern. Do not add a second design
system or render raw pack JSON.

**Step 4: Verify GREEN**

Run focused component and browser-wire privacy tests in English and Chinese.

### Task 10: Close verification gates

**Files:**
- Modify only files required by failures directly caused by Tasks 1-9.

**Step 1: Run focused GEO suites**

```bash
pnpm exec vitest run --project unit apps/marketing/src/lib/geo-tools/kb-knowledge-*.test.ts apps/marketing/src/lib/geo-tools/kb-prepared-contract.test.ts apps/marketing/src/lib/geo-tools/kb-preparation.test.ts apps/marketing/src/lib/geo-tools/kb-generation*.test.ts apps/marketing/src/lib/geo-tools/kb-versioned-read.test.ts apps/marketing/src/lib/geo-tools/kb-complete-read.test.ts apps/marketing/src/components/tools/geo-knowledge-pack*.test.tsx apps/marketing/src/components/tools/geo-kb-version-content.test.tsx apps/marketing/src/components/tools/geo-knowledge-base-v2.test.tsx
```

Expected: PASS with no warnings attributable to the change.

**Step 2: Run Marketing gates**

```bash
pnpm --filter @sf/marketing typecheck
pnpm --filter @sf/marketing lint
pnpm --filter @sf/marketing build
```

Expected: all PASS.

**Step 3: Run repository safety gates**

```bash
pnpm secrets:scan
pnpm verify:docs
pnpm verify:authority
pnpm verify:spec
```

Expected: all applicable gates PASS; any pre-existing unrelated failure is
reported with exact evidence rather than repaired out of scope.

**Step 4: Review the final diff and permission ledger**

Confirm every changed line traces to the knowledge pack or typography request,
no attachment example claim was introduced, no unrelated dirty work was
overwritten, and the release handoff names the exact commit, migration, and
deployment boundaries. Commit, push, deployment, migration, production crawl,
and production provider calls each require explicit authorization; one does not
silently authorize the others.

### Final downstream and recovery acceptance

- Validate the complete stored v1/v2 question-set union before projecting the
  common public fields; never mutate frozen v2 or expose its provenance IDs.
- Use v2 `questionLabel` for English question-generation readiness instead of a
  localized display label.
- Exercise frozen v2 → Visibility → Brief → Draft in the browser harness.
- Show only customer-readable recovery state. Never render idempotency keys,
  generation IDs, draft versions, hashes, or raw provider errors.
- Prove a successful response lost in transit resumes with no duplicate role or
  knowledge billing, while `outcome_unknown` stays queryable and is never
  automatically retried.
