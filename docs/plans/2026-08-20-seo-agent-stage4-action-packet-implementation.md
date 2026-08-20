# SEO Agent Stage 04 Action Packet Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align SEO Agent Stage 04 with the approved Artifact while showing exact affected URLs and producing selected-problem implementation briefs for a Chatbot or Code Agent.

**Architecture:** Reuse the existing evaluated-check and joined record ledger to derive one browser-safe affected-observation projection shared by Stage 02 and Stage 04. Recompose Stage 04 as a full-width two-column stage and add a deterministic, injection-safe Markdown action-brief builder that copies only the selected issue; no copy action calls a provider or writes externally.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, next-intl, Tailwind utilities, Vitest, Playwright, Clipboard API.

---

### Task 1: Project exact affected observations

**Files:**
- Create: `apps/marketing/src/components/agents/agent-evidence-details.tsx`
- Create: `apps/marketing/src/components/agents/agent-evidence-details.test.tsx`
- Modify: `apps/marketing/src/components/agents/agent-diagnosis.tsx`
- Modify: `apps/marketing/src/components/agents/agent-results.tsx`
- Modify: `apps/marketing/src/components/agents/agent-recommendations.tsx`
- Modify translations: `apps/marketing/src/i18n/messages/en.json`, `zh.json`

**Step 1: Write RED projection tests**

Cover:

- duplicate URL observations across sibling records merge under one URL while
  preserving each record's values;
- `url: null` stays Site-level;
- page-scope evidence contains only the selected target page;
- empty evidence renders No displayable observation;
- first five rows show by default and Show all exposes the full bounded set.

**Step 2: Run RED**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/agents/agent-evidence-details.test.tsx
```

Expected: missing component/projection or current Stage 02 has no evidence
rows.

**Step 3: Implement one pure projection and component**

Export:

```ts
export function agentAffectedObservations(
  check: AgentAuditEvaluatedCheck,
  records: readonly SeoAuditRecord[],
  targetUrl?: string,
): readonly AgentAffectedObservation[];
```

Reuse existing comparable-URL semantics rather than inventing another
normalizer. Render exact URLs, Site-level rows, localized labels/values and the
explicit shown/total count.

**Step 4: Wire Stage 02 and Stage 04**

Pass `allAgentAuditRecords(data)` into `AgentDiagnosis`; derive evidence from
the active check. Replace Stage 04's private three-observation `EvidenceList`
with the shared component.

**Step 5: Run GREEN and focused regressions**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/agents/agent-evidence-details.test.tsx \
  apps/marketing/src/components/agents/agent-results.test.tsx \
  apps/marketing/src/components/agents/agent-recommendations.test.tsx
```

Expected: all pass with exact URL and Site-level behavior.

**Step 6: Commit**

```bash
git add apps/marketing/src/components/agents/agent-evidence-details* \
  apps/marketing/src/components/agents/agent-diagnosis.tsx \
  apps/marketing/src/components/agents/agent-results.tsx \
  apps/marketing/src/components/agents/agent-recommendations.tsx \
  apps/marketing/src/i18n/messages/en.json \
  apps/marketing/src/i18n/messages/zh.json
git commit -m "feat(marketing): show exact Agent evidence targets"
```

### Task 2: Build selected-problem AI action briefs

**Files:**
- Create: `apps/marketing/src/lib/agents/seo-ai-action-copy.ts`
- Create: `apps/marketing/src/lib/agents/seo-ai-action-copy.test.ts`
- Reuse: `apps/marketing/src/lib/copy-brief/fenced-json.ts`, `budget.ts`

**Step 1: Write RED builder tests**

Test exact requirements:

- Chatbot and Code Agent outputs differ;
- both name the selected check, exact target/affected URLs, measured values,
  proposed change, validation, impact, risks and limits;
- unrelated report checks are absent;
- user/page/provider values appear only inside fenced JSON;
- a value containing backticks or `ignore previous instructions` cannot escape
  the fence;
- Site-level evidence is not rewritten as a URL;
- oversized URL sets state included/omitted counts within a UTF-8 byte budget;
- unavailable evidence returns an investigation brief and refuses Code Agent
  implementation mode.

**Step 2: Run RED**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/lib/agents/seo-ai-action-copy.test.ts
```

Expected: module missing.

**Step 3: Implement the pure builder**

Use constant localized instruction chrome outside `fencedJson(...)`. Put all
run values inside one or more fenced JSON blocks. Return:

```ts
type BuildSeoAiActionCopyResult =
  | { ok: true; markdown: string; includedUrls: number; omittedUrls: number }
  | { ok: false; reason: "evidence_unavailable" | "serialized_too_large" };
```

No network, browser or message-catalogue dependency in the builder.

**Step 4: Run GREEN**

Run the RED command plus existing copy-brief tests.

**Step 5: Commit**

```bash
git add apps/marketing/src/lib/agents/seo-ai-action-copy*
git commit -m "feat(marketing): build selected SEO action briefs"
```

### Task 3: Add Chatbot and Code Agent copy controls

**Files:**
- Create: `apps/marketing/src/components/agents/agent-ai-action-copy.tsx`
- Create: `apps/marketing/src/components/agents/agent-ai-action-copy.test.tsx`
- Modify: `apps/marketing/src/components/agents/agent-recommendations.tsx`
- Modify translations: `apps/marketing/src/i18n/messages/en.json`, `zh.json`

**Step 1: Write RED interaction tests**

- preview equals copied text exactly;
- Chatbot and Code Agent buttons copy their respective briefs;
- clipboard denial renders the identical read-only textarea;
- copied/failed status is announced through a mounted live region;
- unavailable evidence hides/blocks Code Agent implementation copy and offers
  an investigation brief;
- clicking copy makes zero fetch calls.

**Step 2: Run RED**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/agents/agent-ai-action-copy.test.tsx
```

**Step 3: Implement and wire**

Build both briefs once with `useMemo`; use the same string for preview,
clipboard and fallback. Mount under the right column of Stage 04.

**Step 4: Run GREEN and Agent regressions**

Run the RED command plus `agent-recommendations.test.tsx` and
`agent-solution-draft.test.tsx`.

**Step 5: Commit**

```bash
git add apps/marketing/src/components/agents/agent-ai-action-copy* \
  apps/marketing/src/components/agents/agent-recommendations.tsx \
  apps/marketing/src/i18n/messages/en.json \
  apps/marketing/src/i18n/messages/zh.json
git commit -m "feat(marketing): copy SEO tasks for AI agents"
```

### Task 4: Align Stage 04 visual hierarchy with the Artifact

**Files:**
- Modify: `apps/marketing/src/components/agents/agent-recommendations.tsx`
- Create: `apps/marketing/src/components/agents/agent-stage4-design.test.tsx`

**Step 1: Capture before screenshots**

Use the deterministic signed-in Agent fixture to render Stage 03/04 at:

- 1440px dark zh;
- 1440px light en;
- 390px dark zh.

Persist the before files outside the repository evidence bundle.

**Step 2: Write RED structural/style tests**

Assert:

- Stage 03/04 container has no desktop side-by-side split;
- Stage 04 has circular 04 index, `stage4Title`, badge and separate selected
  check title;
- desktop body has a two-column breakpoint and mobile stays single-column;
- every Stage 04 body paragraph/list/value carries an explicit 13px/1.65 or
  compact evidence/code class rather than inheriting the global paragraph
  rule;
- header/body padding matches approved mobile/desktop tiers.

**Step 3: Run RED**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/agents/agent-stage4-design.test.tsx
```

**Step 4: Implement the minimal TSX/class change**

- remove the 39/61 desktop grid from the recommendation wrapper;
- make Stage 04 a full-width stage with gradient left rule;
- render the approved header and stage index;
- move selected check title into Issue;
- group existing fields into the approved two-column body;
- give every child paragraph/list/fact explicit typography classes;
- keep every semantic test ID and interaction.

**Step 5: Capture after screenshots and verify**

Compare the same three viewports against the Artifact hierarchy. Assert no
horizontal overflow, clipped copy control or unreadable contrast.

**Step 6: Commit**

```bash
git add apps/marketing/src/components/agents/agent-recommendations.tsx \
  apps/marketing/src/components/agents/agent-stage4-design.test.tsx
git commit -m "style(design): align SEO Stage 04 with Artifact"
```

### Task 5: Integrated verification and release

**Step 1: Focused test matrix**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/agents/agent-evidence-details.test.tsx \
  apps/marketing/src/lib/agents/seo-ai-action-copy.test.ts \
  apps/marketing/src/components/agents/agent-ai-action-copy.test.tsx \
  apps/marketing/src/components/agents/agent-stage4-design.test.tsx \
  apps/marketing/src/components/agents/agent-recommendations.test.tsx \
  apps/marketing/src/components/agents/agent-results.test.tsx \
  apps/marketing/src/components/agents/agent-solution-draft.test.tsx \
  apps/marketing/src/components/agents/agent-messages.test.ts
```

**Step 2: Full gates**

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm secrets:scan
pnpm --filter @sf/marketing build
MARKETING_E2E_PORT=<free> pnpm exec playwright test \
  apps/marketing/e2e/agents.spec.ts \
  --config apps/marketing/playwright.config.ts
git diff --check
```

**Step 3: Independent reviews**

Run spec compliance first, then code-quality/security, then a final visual
review against the before/after screenshots. Fix and re-review every finding.

**Step 4: Push and deploy Marketing only**

Push `fix/seo-agent-remediation-20260820`, deploy `gengrowth-agents` from the
exact SHA, and do not merge `main` or deploy `apps/web`.

**Step 5: Production canary**

- verify Stage 03/04 vertical flow in current bundle;
- verify Stage 04 desktop two-column and 390px single-column layout;
- verify exact affected URL and values on a URL-bearing check;
- verify Site-level evidence remains Site-level;
- preview and copy both Chatbot and Code Agent selected-issue briefs;
- verify clipboard fallback through deterministic browser denial rather than a
  production browser permission change;
- verify no copy action issues a network request;
- prove `app.gengrowth.ai` deployment identity remains unchanged.
