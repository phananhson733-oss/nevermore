# Internal Link Audit Priority and AI Handoff Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Order problem URLs by server-reported priority, make that priority visible, route the copied handoff into executable Code Agent or concise Chatbot behavior, and repair the explanatory-copy hierarchy.

**Architecture:** Keep the current public crawler, payload, one URL table, and one copy control unchanged. Add a stable presentation-only priority rank in the ledger builder, render the highest linked priority in each problem row, revise only the generated handoff instructions, and turn the form's two-column note into a full-width stacked note.

**Tech Stack:** TypeScript, React, Next.js, Tailwind CSS, Vitest, Playwright.

---

### Task 1: Stable priority ordering

**Files:**
- Modify: `apps/marketing/src/components/tools/internal-link-audit-ledger.test.ts`
- Modify: `apps/marketing/src/components/tools/internal-link-audit-ledger.ts`

**Step 1:** Change the ledger test to require the P1 orphan row before P2 unresolved and duplicate rows while preserving source order within P2.

**Step 2:** Run the focused Vitest file and verify it fails because problem rows still preserve global source order.

**Step 3:** Add a P1/P2 rank helper matching the current public contract, compute each row's highest linked priority, and stable-sort only problem rows by that rank.

**Step 4:** Run the focused Vitest file and verify it passes.

### Task 2: Executable AI capability routing

**Files:**
- Modify: `apps/marketing/src/components/tools/internal-link-audit-ledger.test.ts`
- Modify: `apps/marketing/src/components/tools/internal-link-audit-ledger.ts`

**Step 1:** Add assertions for required capability routing, scoped local repair authorization, classification of site/audit/unverified outcomes, and the separate deployment prohibition.

**Step 2:** Run the focused Vitest file and verify the new contract fails against the explanatory-only handoff.

**Step 3:** Rewrite the instruction preamble and Chatbot/Code Agent sections without changing report identity, problem evidence, source-sample ownership, unresolved evidence, or safeguards. JSON encode every external evidence string so website-controlled line breaks cannot forge a prompt section.

**Step 4:** Run the focused Vitest file and verify it passes.

### Task 3: Visible priority and explanatory-copy hierarchy

**Files:**
- Modify: `apps/marketing/e2e/internal-link-audit.spec.ts`
- Modify: `apps/marketing/src/components/tools/internal-link-audit-tool.tsx`
- Modify: `apps/marketing/src/components/tools/internal-link-audit-url-ledger.tsx`

**Step 1:** Add browser assertions that P1 rows precede P2 rows, each problem row exposes its highest priority, the note is a vertical stack, primary copy is at least 15 px, and the operational line is separate.

**Step 2:** Build Marketing and run the focused browser suite to verify the assertions fail for the current two-column note and missing priority labels.

**Step 3:** Render a compact priority badge from each row's highest priority. Shorten EN/ZH explanatory copy and replace the desktop grid with a full-width stacked layout and explicit typography.

**Step 4:** Rebuild and rerun the focused browser suite; verify the single-table/single-button, accessibility, Clipboard fallback, and responsive checks remain green.

### Task 4: Final verification and review

**Files:**
- Review all files changed from `origin/main`.

**Step 1:** Run focused unit tests, Marketing typecheck, Marketing lint, Marketing build, and the full Internal Link Audit browser suite.

**Step 2:** Run `git diff --check`, inspect the exact diff, and scan changed files for secrets.

**Step 3:** Obtain an independent read-only review of ordering, prompt authority, evidence boundaries, accessibility, and responsive presentation. Resolve confirmed findings and rerun affected checks.

**Step 4:** Keep changes local unless the user separately authorizes commit, push, PR, or deployment.
