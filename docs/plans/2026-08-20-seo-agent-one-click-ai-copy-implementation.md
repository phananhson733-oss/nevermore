# SEO Agent one-click AI copy implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add one primary `Copy text for AI` action that turns the selected SEO audit issue and its fix into the appropriate existing Code Agent or Chatbot task in one click.

**Architecture:** Keep `buildSeoAiActionCopy()` as the only payload builder and add one deterministic primary-target projection in `AgentAiActionCopy`. Recompose the component so the primary action is immediately available while audience-specific previews and buttons live inside a collapsed advanced disclosure, then move the single component directly below the Stage 04 header without duplicating builder state.

**Tech Stack:** React 19, Next.js 16 App Router, next-intl, Tailwind CSS, Clipboard API, Vitest, Playwright.

---

### Task 1: Add the deterministic one-click primary action

**Files:**

- Modify: `apps/marketing/src/components/agents/agent-ai-action-copy.tsx`
- Modify: `apps/marketing/src/components/agents/agent-ai-action-copy.test.tsx`
- Modify: `apps/marketing/src/i18n/messages/en.json`
- Modify: `apps/marketing/src/i18n/messages/zh.json`
- Test: `apps/marketing/src/components/agents/agent-messages.test.ts`

**Step 1: Write failing primary-action tests**

Add tests to the existing component suite that prove:

```ts
it("copies the Code Agent task from the primary one-click action", async () => {
  render();
  click("Copy text for AI");
  expect(writeText).toHaveBeenCalledWith(codeAgentPreview);
});

it("falls back to the Chatbot investigation task when implementation evidence is unavailable", async () => {
  render(check("unavailable"));
  click("Copy text for AI");
  expect(writeText).toHaveBeenCalledWith(chatbotPreview);
});

it("disables the primary action when neither task can be built", () => {
  renderWithInvalidContext();
  expect(primaryCopyButton()).toBeDisabled();
});
```

Also assert the primary click calls zero `fetch` requests.

**Step 2: Run RED**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/agents/agent-ai-action-copy.test.tsx
```

Expected: failures because `Copy text for AI` does not exist and unavailable evidence has no primary fallback action.

**Step 3: Implement the smallest primary-target projection**

In `AgentAiActionCopy`, derive:

```ts
const primaryTarget: CopyTarget | null = codeAgent.ok
  ? "code_agent"
  : chatbot.ok
    ? "chatbot"
    : null;
```

Render a primary button before the advanced disclosure:

```tsx
<button
  type="button"
  disabled={primaryTarget === null}
  onClick={() => {
    if (primaryTarget !== null) void copy(primaryTarget);
  }}
>
  {t("copyTaskPrimary")}
</button>
```

Do not add another builder invocation or another feedback state. The primary and explicit audience buttons must call the same existing `copy()` function.

**Step 4: Add exact EN/ZH copy**

Add catalogue keys under `agents.workbench.recommendations`:

```json
{
  "copyTaskPrimary": "Copy text for AI",
  "copyTaskAdvanced": "Advanced copy options"
}
```

```json
{
  "copyTaskPrimary": "复制文本给 AI",
  "copyTaskAdvanced": "高级复制选项"
}
```

Update the intro to say the copied unit is the current SEO issue, its affected URLs, fix and validation rather than a generic report.

**Step 5: Run GREEN**

Run the RED command plus message completeness:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/agents/agent-ai-action-copy.test.tsx \
  apps/marketing/src/components/agents/agent-messages.test.ts
```

Expected: all pass.

**Step 6: Commit**

```bash
git add \
  apps/marketing/src/components/agents/agent-ai-action-copy.tsx \
  apps/marketing/src/components/agents/agent-ai-action-copy.test.tsx \
  apps/marketing/src/i18n/messages/en.json \
  apps/marketing/src/i18n/messages/zh.json
git commit -m "feat(marketing): add one-click SEO AI copy"
```

### Task 2: Collapse audience-specific controls into advanced options

**Files:**

- Modify: `apps/marketing/src/components/agents/agent-ai-action-copy.tsx`
- Modify: `apps/marketing/src/components/agents/agent-ai-action-copy.test.tsx`

**Step 1: Write failing disclosure tests**

Assert:

- the primary button is visible without opening anything;
- `Advanced copy options` is closed by default;
- Chatbot preview, Code Agent preview and their explicit buttons are inside the disclosure;
- opening the disclosure reveals both previews and buttons;
- primary copy works while the disclosure remains closed;
- refusal copy remains visible inside the advanced preview when a target cannot be built.

**Step 2: Run RED**

Run the Task 1 component command.

Expected: failure because both previews and explicit buttons are currently always mounted outside one advanced disclosure.

**Step 3: Recompose without changing packet state**

Use one `<details>` with a localized summary:

```tsx
<details data-testid="agent-ai-copy-advanced">
  <summary>{t("copyTaskAdvanced")}</summary>
  <div>
    <details>...</details>
    <details>...</details>
    <button>Copy for Chatbot</button>
    <button>Copy for Code Agent</button>
  </div>
</details>
```

Keep both inner previews collapsed. Do not remove preview/copy fidelity, refusal wording, investigation badge, request-token handling or packet-identity reset.

**Step 4: Make fallback manual copy match the On-Page reference**

Add:

```tsx
onFocus={(event) => event.currentTarget.select()}
```

to the existing read-only fallback textarea.

Add a test that focuses the fallback and proves its full value is selected.

**Step 5: Run GREEN and regressions**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/agents/agent-ai-action-copy.test.tsx \
  apps/marketing/src/lib/agents/seo-ai-action-copy.test.ts
```

Expected: all pass, with copied Markdown unchanged.

**Step 6: Commit**

```bash
git add \
  apps/marketing/src/components/agents/agent-ai-action-copy.tsx \
  apps/marketing/src/components/agents/agent-ai-action-copy.test.tsx
git commit -m "refactor(marketing): simplify SEO AI copy controls"
```

### Task 3: Move the handoff before the Stage 04 solution body

**Files:**

- Modify: `apps/marketing/src/components/agents/agent-recommendations.tsx`
- Modify: `apps/marketing/src/components/agents/agent-recommendations.test.tsx`
- Modify: `apps/marketing/src/components/agents/agent-stage4-design.test.tsx`

**Step 1: Write failing structural tests**

Assert the Stage 04 direct children are ordered:

```text
header
AI handoff
two-column body
```

Also assert:

- there is exactly one `agent-ai-action-copy` component;
- it appears before `agent-stage4-body` in DOM order;
- the Stage 04 body remains `lg:grid-cols-2`;
- Tech Agent renders no SEO handoff;
- a Tech-primary subordinate check in an SEO run still renders it;
- existing Stage 04 evidence, draft, context, validation, impact, risks and limits remain present.

**Step 2: Run RED**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/agents/agent-stage4-design.test.tsx \
  apps/marketing/src/components/agents/agent-recommendations.test.tsx
```

Expected: failure because the AI component currently sits at the bottom of the right body column.

**Step 3: Move the existing component, do not duplicate it**

Render the SEO-only component once between the header and body:

```tsx
{recommendation.agent === "seo" ? (
  <div className="border-b ...">
    <AgentAiActionCopy ... />
  </div>
) : null}

<div data-testid="agent-stage4-body">...</div>
```

Remove the old copy component from the right column. Keep the same resolved solution strings and builder inputs.

**Step 4: Run GREEN**

Run the RED command plus component and draft/evidence regressions:

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/agents/agent-stage4-design.test.tsx \
  apps/marketing/src/components/agents/agent-recommendations.test.tsx \
  apps/marketing/src/components/agents/agent-ai-action-copy.test.tsx \
  apps/marketing/src/components/agents/agent-solution-draft.test.tsx \
  apps/marketing/src/components/agents/agent-evidence-details.test.tsx
```

Expected: all pass.

**Step 5: Commit**

```bash
git add \
  apps/marketing/src/components/agents/agent-recommendations.tsx \
  apps/marketing/src/components/agents/agent-recommendations.test.tsx \
  apps/marketing/src/components/agents/agent-stage4-design.test.tsx
git commit -m "style(design): surface SEO AI handoff earlier"
```

### Task 4: Integrated verification and visual acceptance

**Files:**

- Verify only unless a regression test demonstrates a required fix.
- Store screenshots outside the repository under the current visualization bundle.

**Step 1: Run the focused matrix**

```bash
pnpm exec vitest run --project unit \
  apps/marketing/src/components/agents/agent-ai-action-copy.test.tsx \
  apps/marketing/src/lib/agents/seo-ai-action-copy.test.ts \
  apps/marketing/src/components/agents/agent-stage4-design.test.tsx \
  apps/marketing/src/components/agents/agent-recommendations.test.tsx \
  apps/marketing/src/components/agents/agent-solution-draft.test.tsx \
  apps/marketing/src/components/agents/agent-evidence-details.test.tsx \
  apps/marketing/src/components/agents/agent-messages.test.ts
```

**Step 2: Run static gates**

```bash
pnpm --filter @sf/marketing typecheck
pnpm --filter @sf/marketing lint
pnpm --filter @sf/marketing build
git diff --check
```

**Step 3: Run the Agent browser regression**

```bash
MARKETING_E2E_PORT=<free-port> pnpm exec playwright test \
  apps/marketing/e2e/agents.spec.ts \
  --config apps/marketing/playwright.config.ts
```

Extend the existing signed-in SEO fixture assertion to prove the primary
`Copy text for AI` button is visible and enabled after the run, while Tech has
no SEO copy panel.

**Step 4: Capture visual states**

Using the deterministic production-build fixture, capture:

- 1440px, ZH, dark;
- 1440px, EN, light;
- 390px, ZH, dark.

Assert:

- the primary action is above the Stage 04 body;
- advanced options are collapsed by default;
- no horizontal overflow;
- no clipped button or status;
- the approved Stage 04 title and body layout remain unchanged.

**Step 5: Independent reviews**

Run spec compliance first, then code quality/security/a11y and final visual
review. Fix and re-review every real finding.

**Step 6: Final commit if tests/evidence required a correction**

Stage only named files and keep any correction in its own atomic commit. Do not
push or deploy without explicit release authority for this new change.

