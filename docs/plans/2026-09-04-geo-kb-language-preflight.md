# GEO Knowledge Base Language Preflight Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop unsupported GEO question languages before any request and replace the raw `unsupported_language` code with actionable localized copy.

**Architecture:** Reuse the existing browser-safe English-language predicate in the editor hook and one-button component. The hook is the side-effect boundary; the component presents and disables the known-invalid action. The server-side 422 guard remains unchanged.

**Tech Stack:** React 19, TypeScript, Next.js 16, next-intl, Vitest/jsdom.

---

### Task 1: Lock the zero-request preflight behavior

**Files:**
- Test: `apps/marketing/src/components/tools/use-geo-kb-v2-editor.test.tsx`

**Step 1: Write the failing test**

Add a test that gives both the saved GEO payload and its exact Profile copy a
`zh-CN` locale, calls `editor.generateAll()`, and expects:

```ts
expect(fetch).not.toHaveBeenCalled();
expect(editor.status).toEqual({ kind: "error", code: "unsupported_language" });
expect(editor.build).toBeNull();
```

**Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run --project unit apps/marketing/src/components/tools/use-geo-kb-v2-editor.test.tsx
```

Expected: the new test fails because the current flow reaches `fetch` instead
of refusing at the orchestration boundary.

### Task 2: Lock the visitor-facing behavior

**Files:**
- Test: `apps/marketing/src/components/tools/geo-knowledge-base-v2.test.tsx`
- Modify later: `apps/marketing/src/i18n/messages/en.json`
- Modify later: `apps/marketing/src/i18n/messages/zh.json`

**Step 1: Write the failing tests**

Add bilingual component coverage asserting that unsupported input disables
`[data-generate-kb]`, displays the exact language and localized explanation,
makes no request, and never renders the raw `unsupported_language` token.

Create a retained same-key resend fixture and assert its recovery action is
also disabled. Cover the changed-input recovery branch as well. Add hook
coverage that calls normal, new-input, and same-key resend generation actions
directly and proves all return with zero requests. Also cover the language a
Profile derivation is about to apply, plus direct build and confirm calls. Add
the inverse mismatch: an English Profile derivation may keep the main build
available, but an unsupported saved draft must still block direct generation,
confirmation, and recovery dispatch.

Extend the existing mapped/unmapped-error test with a server-returned
`unsupported_language` response on otherwise eligible English input. Assert
that the response is localized and the raw code is suppressed, while the
existing unknown `teapot` assertion remains unchanged.

**Step 2: Run both focused UI suites and verify RED**

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/tools/use-geo-kb-v2-editor.test.tsx \
  apps/marketing/src/components/tools/geo-knowledge-base-v2.test.tsx
```

Expected: failures show that the button remains enabled, `generateAll()` can
reach a request, and the response renderer exposes the raw code.

### Task 3: Implement the minimal client guard and copy

**Files:**
- Modify: `apps/marketing/src/components/tools/use-geo-kb-v2-editor.ts`
- Modify: `apps/marketing/src/components/tools/geo-knowledge-base-v2.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`

**Step 1: Guard the orchestration boundary**

Import `isSupportedGeoQuestionLanguage`, derive the effective language that the
Profile build would apply as well as the saved draft language actually submitted
by direct operations. Use the effective language for `generateAll()` and
`buildFromProfile()`, and the saved language for `generate()` and `confirmAll()`.
Return with the existing error status before any other work when the applicable
language is unsupported. Expose both supported flags to the component.

**Step 2: Present the known constraint**

Disable the primary and recovery-dispatch buttons when the flag is false. Add
one localized preflight message that names the language and explicitly says no
source or model work starts. Map a fallback `unsupported_language` error to a
separate conservative message: no model call for the rejected step, but a
source refresh may already have completed. Do not print the raw code.

**Step 3: Run focused tests and verify GREEN**

Run the two focused UI suites from Task 2. Expected: all tests pass.

### Task 4: Verify the unchanged server boundary and regression surface

**Files:**
- Test only; no further production changes expected.

**Step 1: Run all directly related unit suites**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/tools/geo-knowledge-base-v2.test.tsx \
  apps/marketing/src/components/tools/use-geo-kb-v2-editor.test.tsx \
  apps/marketing/src/lib/geo-tools/kb-generation-preparer.test.ts \
  apps/marketing/src/lib/geo-tools/kb-synthesis.test.ts
```

Expected: all pass, including the existing no-adapter-call assertions.

**Step 2: Run static checks scoped to the changed product**

```bash
pnpm --filter @sf/marketing typecheck
pnpm exec eslint \
  apps/marketing/src/components/tools/use-geo-kb-v2-editor.ts \
  apps/marketing/src/components/tools/geo-knowledge-base-v2.tsx \
  apps/marketing/src/components/tools/use-geo-kb-v2-editor.test.tsx \
  apps/marketing/src/components/tools/geo-knowledge-base-v2.test.tsx
pnpm verify:docs
git diff --check
```

Expected: every command exits 0.

**Step 3: Review the final diff**

Confirm that no server/provider/persistence contract changed, no unrelated file
was touched, and no push/deploy/production operation occurred. Do not commit
without separate user authorization under this repository's `AGENTS.md`.
