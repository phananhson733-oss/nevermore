# Internal Link Audit Tools IA Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove Internal Link Audit from the Agents navigation and prove that it remains discoverable through Resources -> Tools -> Internal Link Audit.

**Architecture:** Change only the header navigation contract and its dedicated EN/ZH message keys. Preserve the Resources catalogue, Tools hub, standalone tool route, API, sitemap, technical Agent compatibility route, and all crawl internals.

**Tech Stack:** Next.js 16 App Router, next-intl, TypeScript strict, Vitest 4, Playwright 1.61, pnpm 10.

---

### Task 1: Specify the corrected navigation boundary

**Files:**
- Modify: `apps/marketing/src/config/navigation.test.ts`
- Modify: `apps/marketing/e2e/internal-link-audit.spec.ts`

**Step 1: Write the failing unit contract**

Require `agentsMenuGroups` to resolve to exactly:

```ts
[
  { slug: "seo", href: "/agents/seo" },
  { slug: "geo", href: "/agents/geo" },
]
```

Require both locale catalogues to omit
`nav.agentsMenu.internalLinkAudit`, while retaining the Tools product copy at
`nav.toolsMenu.internalLinkAudit`. Keep the Resources-menu assertion unchanged.

**Step 2: Write the failing browser contract**

Replace the old test that opens Internal Link Audit from the Agents menu. The
new Chinese journey must prove:

1. the expanded Agents menu has no Internal Link Audit link;
2. the expanded Resources menu exposes the generic Tools link at `/zh/tools`;
3. the Tools hub exposes Internal Link Audit at
   `/zh/tools/internal-link-audit`;
4. clicking it opens the standalone tool page without calling the audit API.

**Step 3: Verify RED**

Run:

```bash
pnpm exec vitest run --project unit apps/marketing/src/config/navigation.test.ts
pnpm --filter @sf/marketing build
pnpm --filter @sf/marketing test:e2e internal-link-audit.spec.ts
```

Expected: the unit and browser contracts fail because Internal Link Audit is
still promoted inside the Agents submenu.

### Task 2: Implement the minimal IA change

**Files:**
- Modify: `apps/marketing/src/config/navigation.ts`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`

**Step 1: Remove the Agents-menu item**

Delete only the `internal-link-audit` object from `agentsMenuGroups`. Update the
nearby comment so it describes the exact two Agent destinations and the retained
non-promoted `/agents/tech` compatibility route.

**Step 2: Remove the now-unused Agents copy**

Delete only `nav.agentsMenu.internalLinkAudit` from both locale catalogues. Do
not change `nav.toolsMenu.internalLinkAudit` or any Tools-page copy.

**Step 3: Verify GREEN**

Re-run the exact Task 1 commands and require zero failures.

### Task 3: Verify scope and repository health

**Files:**
- Modify only if a requirement-specific test exposes a real gap.

**Step 1: Run focused navigation and locale coverage**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/config/navigation.test.ts \
  apps/marketing/src/i18n/messages.test.ts \
  'apps/marketing/src/app/[locale]/tools/tools-hub-contract.test.ts' \
  apps/marketing/src/config/sitemap-tools.test.ts
```

**Step 2: Run static gates**

```bash
pnpm --filter @sf/marketing typecheck
pnpm exec eslint \
  apps/marketing/src/config/navigation.ts \
  apps/marketing/src/config/navigation.test.ts \
  apps/marketing/e2e/internal-link-audit.spec.ts
pnpm --filter @sf/marketing build
```

**Step 3: Re-run the browser story**

```bash
pnpm --filter @sf/marketing test:e2e internal-link-audit.spec.ts
```

**Step 4: Inspect the final local state**

```bash
git status --short
git diff --check
git diff --stat
git diff
```

Confirm that every changed line maps to the approved IA adjustment. Do not
commit, push, create a PR, deploy, or claim production changed.

