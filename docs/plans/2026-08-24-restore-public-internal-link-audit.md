# Restore Public Internal Link Audit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore the no-login standalone Internal Link Audit and make every UI element named Internal Link Audit, including the highlighted header mega-menu card, link directly to its canonical tool route.

**Architecture:** Reopen only the page and API boundaries that commit `082234b0` retired. Keep the current v3 scanner, handler, cache, crawl gates, SSRF protection, and result UI. Remove the retired-route policy, restore sitemap discovery, and update narrowly scoped navigation/copy contracts while preserving `/agents/tech` as a non-primary compatibility route.

**Tech Stack:** Next.js 16 App Router, React 19, next-intl, TypeScript strict, Vitest 4, Playwright 1.61, pnpm 10.

---

### Task 1: Specify the restored page and API boundaries

**Files:**
- Create: `apps/marketing/src/app/[locale]/tools/internal-link-audit/page.test.ts`
- Modify: `apps/marketing/src/app/api/tools/legacy-audit-routes.test.ts`
- Modify: `apps/marketing/src/app/[locale]/tools/internal-link-audit/page.tsx`
- Modify: `apps/marketing/src/app/api/tools/internal-link-audit/route.ts`

**Step 1: Write the failing page contract**

Add a source contract that requires the route to import/render
`InternalLinkAuditTool`, expose `generateMetadata`, and contain no
`permanentRedirect`.

**Step 2: Write the failing API delegation contract**

Split the legacy API test so `/api/tools/seo-audit` still delegates to
`handleAgentAuditRequest(request, "seo")`, while
`/api/tools/internal-link-audit` delegates to
`handleInternalLinkAuditRequest(request)`.

**Step 3: Verify RED**

Run:

```bash
pnpm exec vitest run --project unit \
  'apps/marketing/src/app/[locale]/tools/internal-link-audit/page.test.ts' \
  apps/marketing/src/app/api/tools/legacy-audit-routes.test.ts
```

Expected: FAIL because the page is a redirect shim and the API still delegates
to the authenticated Tech Agent handler.

**Step 4: Restore the page composition only**

Restore the pre-retirement page composition from parent commit `e284f32e`, but
keep all imported current modules. The resulting page must continue to use the
current `InternalLinkAuditTool`, `getInternalLinkAuditContent`, JSON-LD helpers,
and current shared layout primitives.

**Step 5: Restore the API boundary only**

Use this minimal route:

```ts
import { handleInternalLinkAuditRequest } from "../../../../lib/tools/internal-link-audit-handler.ts";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  return handleInternalLinkAuditRequest(request);
}
```

Do not restore an older handler or scanner.

**Step 6: Verify GREEN**

Re-run the Task 1 command and require both files to pass.

**Checkpoint:** Review the diff. Do not commit without explicit authorization.

### Task 2: Remove the retired-route policy and restore canonical discovery

**Files:**
- Modify: `apps/marketing/src/retired-marketing-routes.test.ts`
- Modify: `apps/marketing/src/proxy.test.ts`
- Modify: `apps/marketing/next.config.test.ts`
- Modify: `apps/marketing/src/config/sitemap-tools.test.ts`
- Modify: `apps/marketing/src/app/sitemap.test.ts`
- Modify: `apps/marketing/src/retired-marketing-routes.ts`
- Modify: `apps/marketing/next.config.ts`
- Modify: `apps/marketing/src/lib/legacy-en-migration.ts`
- Modify: `apps/marketing/src/config/sitemap-tools.ts`

**Step 1: Write failing routing assertions**

Require:

- `getRetiredMarketingRouteDisposition("/tools/internal-link-audit")` and the
  Chinese equivalent to return `null`;
- the proxy to leave both canonical locale forms active rather than emit 308;
- genuine `/en/tools/internal-link-audit` requests to redirect permanently in
  one hop through next-intl/Proxy to `/tools/internal-link-audit`, while
  `next.config` has no explicit rule for that source;
- the legacy EN migration table to match that canonical destination.

**Step 2: Write failing sitemap assertions**

Require `internal-link-audit` in `SITEMAP_TOOLS`, remove it from the
redirect-only test set, and require EN/ZH canonical sitemap URLs.

**Step 3: Verify RED**

Run:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/retired-marketing-routes.test.ts \
  apps/marketing/src/proxy.test.ts \
  apps/marketing/next.config.test.ts \
  apps/marketing/src/config/sitemap-tools.test.ts \
  apps/marketing/src/app/sitemap.test.ts \
  apps/marketing/src/lib/legacy-en-migration.test.ts
```

Expected: FAIL on the old Agent redirects and sitemap exclusion.

**Step 4: Implement the minimal routing change**

Delete only the Internal Link Audit entry from `REDIRECT_ROUTE_EXACT`. Keep the
SEO Audit and comparison redirects. Remove the explicit Next redirect and the
repair override for `/en/tools/internal-link-audit`; the normal 2026-07-31
default-locale cutover records and performs the one-hop canonicalization. Add
the tool slug to `SITEMAP_TOOLS`.

**Step 5: Remove the obsolete route-level redirect test case**

Keep `legacy-agent-redirects.test.ts` for SEO Audit only; the restored Internal
Link Audit page is covered by its new page contract.

**Step 6: Verify GREEN**

Run the Task 2 suite plus
`apps/marketing/src/app/[locale]/tools/legacy-agent-redirects.test.ts`.

**Checkpoint:** Review the diff. Do not commit without explicit authorization.

### Task 3: Correct the Tools hub, On-Page handoff, and header mega menu

**Files:**
- Modify: `apps/marketing/src/app/[locale]/tools/tools-hub-contract.test.ts`
- Modify: `apps/marketing/src/app/[locale]/tools/on-page-seo-check/related-tools.test.ts`
- Modify: `apps/marketing/src/config/navigation.test.ts`
- Modify: `apps/marketing/src/app/[locale]/tools/page.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`
- Modify: `apps/marketing/src/config/navigation.ts`

**Step 1: Write failing Tools and On-Page link assertions**

Require the Tools card to describe a no-login standalone Internal Link Audit
and use a run-tool CTA. Require the On-Page related item named Internal Link
Audit to use `/tools/internal-link-audit` in both locales.

**Step 2: Write the failing mega-menu assertion**

Require the third item in the highlighted header menu to be:

```ts
{
  slug: "internal-link-audit",
  href: "/tools/internal-link-audit",
  labelKey: "nav.agentsMenu.internalLinkAudit.label",
  descriptionKey: "nav.agentsMenu.internalLinkAudit.description",
  icon: "Wrench",
}
```

Require the group copy to be `Website audits` / `网站审查`. Require the Tech
Agent route to remain present on disk but exempt from primary-menu parity.

**Step 3: Verify RED**

Run:

```bash
pnpm exec vitest run --project unit \
  'apps/marketing/src/app/[locale]/tools/tools-hub-contract.test.ts' \
  'apps/marketing/src/app/[locale]/tools/on-page-seo-check/related-tools.test.ts' \
  apps/marketing/src/config/navigation.test.ts
```

Expected: FAIL because all three surfaces still target or describe the Tech
Agent compatibility view.

**Step 4: Implement only the named copy and destinations**

Update EN/ZH messages, the Tools card, the On-Page related item, and the
navigation item. Do not sweep links labelled `Technical focus` elsewhere; they
continue to describe `/agents/tech`.

**Step 5: Verify GREEN and locale parity**

Run the Task 3 suite plus `apps/marketing/src/i18n/messages.test.ts`.

**Checkpoint:** Review the diff. Do not commit without explicit authorization.

### Task 4: Update current authority without rewriting historical evidence

**Files:**
- Modify: `README.md`
- Modify: `docs/marketing-legacy-en-migration.md`
- Keep: `docs/plans/2026-08-24-restore-public-internal-link-audit-design.md`

**Step 1: Update the active product statement**

State that SEO Audit remains registration-gated, while Internal Link Audit is
a no-login public tool that may store temporary abuse-control/rate-limit state
and completed crawl results in a shared cache, but creates no App project and
writes no canonical product data. Keep the broader Marketing Agent and App
boundaries unchanged.

**Step 2: Update the legacy EN matrix**

Document `/en/tools/internal-link-audit -> /tools/internal-link-audit`.

**Step 3: Verify documentation**

Run:

```bash
pnpm verify:docs
git diff --check
```

Expected: PASS.

**Checkpoint:** Review the diff. Do not commit without explicit authorization.

### Task 5: Fresh verification of the full restored story

**Files:**
- Modify only if a failing requirement-specific regression test exposes a real
  gap.

**Step 1: Run focused Internal Link Audit coverage**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/tools/internal-link-audit-handler.test.ts \
  apps/marketing/src/components/tools/internal-link-audit-tool.test.ts \
  apps/marketing/src/components/tools/internal-link-audit-tree.test.ts \
  packages/public-tools/src/internal-link-audit/scan.test.ts
```

**Step 2: Run the complete focused routing/navigation suite**

Re-run every test named in Tasks 1-3 in one fresh command.

**Step 3: Run static gates**

```bash
pnpm --filter @sf/marketing typecheck
pnpm --filter @sf/marketing lint
pnpm --filter @sf/marketing build
pnpm test
```

**Step 4: Run mocked browser regression**

Use the existing Internal Link Audit Playwright spec against a local Marketing
server with mocked/fixture network behavior. Verify EN and ZH page identity,
form access without authentication, mocked v3 report rendering, and header
mega-menu destination. Do not call a live customer target or production crawl
API.

**Step 5: Inspect final state**

```bash
git status --short
git diff --check
git diff --stat
git diff
```

Confirm that every changed line maps to the approved restoration. Report local
working-tree state separately from commit, push, and deployment state.
