# GEO Brief Artifact presentation — local acceptance

Date: 2026-08-31

**Outcome after user clarification:** Completed and verified using the current website style in both light and dark themes. The Artifact supplies information structure, not a separate palette. The previous black/gold screenshots are superseded. This is not a deployment or live-provider report.

## Scope and identity

- Release integration base: main b35c359f; branch fix/geo-brief-ui-release-20260831.
- Final production-build ID: FZShu_pbVMUALOyQTKDuq.
- User explicitly authorized Codex and native subagents in place of external ChatGPT Pro for this task. No source was uploaded externally.
- The app-only patch was applied cleanly to the isolated release worktree on current main. The original development worktree and unrelated dirty checkout were preserved.
- At local validation time no external release action had occurred. The user subsequently authorized commit and deployment; see release-preflight.md for that boundary. No database/configuration changes or paid provider calls are included.
- [Source and screenshot hashes](source-manifest.json) bind this report to the inspected files and final screenshots.

## What changed

The first local repair incorrectly adopted the prototype’s fixed black/gold palette. Following the user’s clarification, the two Brief stylesheets now inherit the existing Marketing colors, fonts, corner radii and button styles. They no longer override global theme tokens or force a dark color scheme. Information structure and all functional repairs remain in place; global styles and neighboring tools were not changed.

1. Input/result views use a compact title and contract header. Successful generation selects Result. Switching views preserves the result without another request; editing the selected snapshot, question or manual text invalidates the old result and gap context.
2. Input rows now show the target question, verified gap, frozen audience role and knowledge-base/question-set version. On mobile, long selected questions also appear as wrapping full text below the native selector.
3. A common server-side projector reads role labels/segments and prompt-set schema/registry/hash from the exact frozen snapshot. No current editable draft is substituted.
4. An exact handoff load resolves the owned A/D gap before generation, with no quota debit, sampling or assembly. Wrong owner/snapshot/question/run and B/C selections are refused. The generation path still independently validates ownership.
5. Results restore origin/evidence/version rows, lead-answer requirement and entity chips, a four-column must-answer table, a three-column fact table, and H2-to-Q outline rows. Null facts, failed samples and absent observations remain explicit.
6. JSON, Markdown, clipboard and Draft staging retain the same validated Brief object. Optional readable role labels only affect display.
7. Shared-route explanatory copy no longer claims that every Brief makes one new ChatGPT sampling call. Existing shared generation reuses owned observations and does not resample visibility.

No output-contract version, parser, assembler, model configuration, facts, Q IDs/wording, fingerprints, gap routing or provider behavior was changed to imitate the example.

## Verification

| Check | Final result | Evidence scope |
| --- | --- | --- |
| Related unit/contract/component tests | 64 files, 876 tests PASS | Actual logic and deterministic fixtures; no remote store/provider |
| Marketing TypeScript | PASS | Standalone typecheck and final build TypeScript stage |
| Owned ESLint | 14 TS/TSX files PASS; final modified component/spec rerun PASS | Changed/new source and browser tests |
| Marketing production build | PASS, 299 prerendered pages | Build ID above; not deployed |
| Browser regression | 20/20 PASS, 49.3 seconds | Final build, actual UI/handlers with offline authentication/store/provider seams |
| Layout checks | 20/20 PASS | en/zh × desktop/mobile, light/dark input and result views |
| Exports | PASS | Browser-downloaded JSON strictly parsed; Markdown and clipboard compared by exact text; existing full-chain tests verify same-object Draft handoff |
| Source review | PASS | Independent spec review, then independent code-quality/security review; no remaining actionable findings |
| Secret scan / diff whitespace | PASS | Final source scan and git diff check |

The integrated browser run also verified the 12 current-main Page Citability cases. The original eight GEO chain cases covered four new Artifact cases (en/zh at 1440px and 390px) plus four existing full-chain cases (A/D through Brief → shared Draft → Citability, B directly to Citability, and C third-party work only). All four Artifact cases recorded zero unexpected API requests and zero unexpected page errors. Loading context and switching views never caused generation. Changing a question and selecting the original question again did not resurrect its previous run context.

Browser evidence uses reserved test domains and synthetic accounts. Each Artifact case exercised 90 offline visibility samples and two offline Brief assemblies; these are test dependency invocations, not live provider calls or billable usage.

The theme correction was independently reviewed with no actionable findings. The browser test first reproduced the local black background surviving a real switch to the site’s light theme. Final checks compare actual root/body/workspace/result colors and native color schemes, not a hardcoded alternative palette. Theme switches do not regenerate or mutate the Brief. Screenshots finish finite CSS color transitions before capture.

## Problems caught and repaired during verification

- Missing input metadata/views and result semantics were first reproduced with failing tests.
- The first browser run caught a real mobile layout defect: an implicit Grid track expanded the document to 698px on a 390px viewport. An explicit minmax(0, 1fr) track now confines the wide tables to their own horizontal scroll regions. The final document width equals its viewport in all 20 captures.
- Final visual inspection caught long questions being clipped inside mobile native selects. An added browser assertion failed before the wrapping preview was implemented; both mobile cases now verify the complete selected question. Manual mode removes the preview.

## Screenshots and remaining evidence limits

- [Chinese desktop input — light](zh-desktop-gap-input-light.png)
- [Chinese desktop result — light](zh-desktop-result-light.png)
- [Chinese desktop result — dark](zh-desktop-result-dark.png)
- [Chinese mobile input — light](zh-mobile-gap-input-light.png)
- [Chinese mobile result — light](zh-mobile-result-light.png)
- [Chinese mobile result — dark](zh-mobile-result-dark.png)
- [Final browser ledger and layout measurements](browser-evidence.json)

Screenshot values are local fixtures, not AstrologyWiki production data. A question without an attached frozen role explicitly displays that absence.

The existing Visibility-only test fixture changes signed-out SSR authentication props and produces one known React #418 hydration retry per Artifact case. The test records that exact injected Visibility-path error separately, allows at most one, and rejects every other page error. No GEO Brief-page error is exempted. This does not establish production login or production hydration behavior.

This local acceptance report does not establish production deployment identity, real authentication, hosted database state or paid model behavior; the subsequent release report records production checks separately. Current generation-language restrictions are unchanged. Full-repository Product/database tests were not run because this patch is confined to the Marketing Brief presentation and existing read adapters.

## Reproduction

From this worktree root:

    pnpm exec vitest run --project unit apps/marketing/src/lib/geo-tools apps/marketing/src/components/tools/geo-brief apps/marketing/e2e/geo-chain-fixtures.test.ts apps/marketing/e2e/geo-chain-ssr.test.ts packages/public-tools/src/content-brief/parse-geo-brief.test.ts apps/marketing/src/lib/tools/content-brief-handoff.test.ts
    pnpm --filter @sf/marketing typecheck
    env -i PATH="$PATH" HOME="$HOME" pnpm --filter @sf/marketing build
    env -i PATH="$PATH" NODE_OPTIONS=--import=tsx MARKETING_E2E_PORT=3112 pnpm --filter @sf/marketing exec playwright test e2e/geo-brief-artifact.spec.ts e2e/geo-chain.spec.ts e2e/page-citability-check.spec.ts --output=test-results/geo-brief-release-final
    node scripts/secrets-scan.mjs
    git diff --check

Do not reuse these screenshots as evidence after source changes without rebuilding, rerunning the affected browser checks and updating the manifest.
