# Content Brief Artifact UI milestone — local fixture evidence

Date: 2026-08-31. Status: local UI milestone, not production or full-goal acceptance.

## Evidence scope

- User baseline: the 1,103-line Content Tools React Artifact reattached on 2026-08-31, SHA-256 `8d2a145047bbd83765d2120644f17826df82ca0939cb505d6fa5187922227cfa`.
- Repository baseline: `807e2cdce85ed7e6cdde3016e3cfd178a0b45556`.
- Branch: `fix/content-brief-artifact-20260831`.
- UI implementation commit: `1705aa31` (includes final focus and deferred-sign-in recovery fixes).
- UI changes are in the local worktree. No push, PR, merge, deployment, live provider run, database write or CMS operation is claimed here.
- Screenshots use deterministic test data, including intentionally long synthetic domain/model strings. They prove presentation and interaction, not factual quality or production parser acceptance of that rendering fixture.
- No source package or customer data was uploaded for external ChatGPT Pro review. Native independent spec and code-quality reviewers were used; the primary agent independently ran the final browser checks.

## Accepted UI behavior

The result follows the supplied Artifact's editorial structure at approximately 880px: keyword/read summary, compact source strip, prominent page action, three writing fields, question rows, outline, gap/link sections, handoff, then collapsed boundaries. Existing Marketing light/dark themes and fonts remain intact.

Run/evidence details retain exact model, temperature, fingerprint, token and source-ledger values behind closed native disclosures. Long provenance is available without dominating each outline/link row. Not-requested sources are neutral “not used”; partial summaries describe recorded limitations. Local paragraph CSS prevents global prose sizing from stretching the source cards.

Successful runs close settings and move focus to the named result region. Reopening/editing settings does not mutate the frozen result or submit a request. Deferred auth/API/network failures reopen settings; deferred signed-out recovery remains usable after cancelling sign-in.

## Fresh verification

- `pnpm --filter @sf/marketing build`: exit 0; 296 static pages generated.
- Focused UI/i18n/source-token unit run: 10 files, 184/184 passed.
- Changed Content Brief TSX and E2E ESLint: exit 0.
- Broader Content Brief core/handler/UI and DataForSEO unit regression: 40 files, 923/923 passed.
- `pnpm secrets:scan`: secret scan passed and 75/75 redaction tests passed.
- `MARKETING_E2E_PORT=3109 pnpm --filter @sf/marketing exec playwright test --config=playwright.config.ts e2e/content-brief.spec.ts`: 20/20 passed.
- Visual matrix: 1280px / 390px × EN / ZH × light / dark. Assertions cover actual computed type sizes, no document horizontal overflow, long-value readability, default-closed disclosures, keyboard open/close, actual post-success focus, visible focus treatment and Tab progression.
- All API requests in these browser cases were stubbed or aborted; the standalone server ran without production credentials. No billable call occurred.

Previous 12-case and 19-case passes applied to predecessor UI bytes. They are not substituted for the final 20-case run.

## Review findings closed

1. A run could fail while its settings were manually collapsed, hiding the error. Deferred tests failed first; terminal failure paths now reopen native details.
2. A separate deferred signed-out path stranded the inputs after cancelling sign-in. Reopen behavior and zero-paid-request assertions cover it.
3. Successful collapse could leave focus away from the visible result. The result is now a named focusable region; real keyboard tests exercise focus and subsequent Tab.
4. Original footer ordering and long visible provenance did not match the Artifact. Handoff precedes collapsed boundaries; short source-layer badges lead, full provenance stays inspectable.

Independent spec review passed. Final code-quality recheck reported no remaining P1/P2 findings in this UI scope.

## Screenshots

- [Chinese dark desktop, 1280px viewport](./desktop-zh-dark.png)
- [Chinese dark mobile, 390px viewport](./mobile-zh-dark.png)

| File | Image size | SHA-256 |
| --- | --- | --- |
| `desktop-zh-dark.png` | 880 × 2512 | `1e422adcdb823db5bf9c4c3bee6b4dda15f1d3e7b09d711cd508549d18b47da3` |
| `mobile-zh-dark.png` | 342 × 3620 | `157988884ce01440aa57ca774f270371a9a6c0fc9408f3ed73df5353f954bdfc` |

These show the current v1 content in the repaired UI. Visible v1 rewrite limitations are not claims that the planned business repair has been implemented.

## Full-goal requirements still open

- PAA foundation exists in source commit `5180b875`, but must still be connected to the actual Brief question/outline/Draft workflow.
- Semantic question extraction and template filtering; removal of the three-page/three-question admission assumptions.
- Primary/supporting evidence, honest page ownership and a real current-page rewrite plan.
- Editable/confirmable outline with exact causal revision and Draft handoff; truthful non-whitespace-language handling.
- Specific incompatible GEO Brief import guidance without schema coercion.
- Fixed semantic oracle fixtures, real generated-output/product canary, final full checks, reviewed PR and Marketing production evidence with retained Product identity.

The active repair goal remains incomplete until those requirements are implemented and verified.
