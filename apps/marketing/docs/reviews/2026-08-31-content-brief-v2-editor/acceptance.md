# Content Brief v2 editor — local product acceptance

## Evidence boundary

This is the real Marketing application built locally from the v2 producer/handler commits 4aca120a and 09b6e348 plus the editor changes. Network/provider completions are fixed offline evidence; the standalone browser server receives no provider credentials. This is not a production canary or proof that live model output is semantically relevant.

The original Artifact remains the visual/interaction reference. frontend-design was applied within the existing 880px editorial layout, Marketing typography and light/dark tokens; no global CSS or font changes were made.

## Implemented and exercised

- Explicit v2 API request and complete async response validation, not a v1 wrapper.
- Keyword/page recommendation first, compact question table, honest source labels and observed word/character length.
- H2/H3 wording and order edits with immutable generated base, stable O/Q mappings, and default-collapsed H3 controls with readable summaries.
- Explicit new-page resolution for undecidable recommendations; update keeps its actual target and source-bound rewrite instructions.
- Confirmed revision 1, exact repeat exports, edit invalidation, revision 2, and failed confirmation recovery.
- Minified JSON copy/download using the same confirmed object; a near-limit fixture reproduced the previous 265077-byte pretty export exceeding the 262144-byte intake limit before the fix.
- Stale async confirmations and unmounted/replaced results cannot publish.
- Failed reruns preserve the previous confirmed/exportable result. Tests cover signed-out, auth-required, rate limit, malformed response and network failure.
- Invalid/legacy/fingerprint-bad HTTP 200 responses cannot replace a validated result.
- Closed technical/evidence disclosures retain the whole supplied run/context data, including GSC scope/window and profile lineage.

## Fresh checks

On 2026-08-31, after the last source change:

- Relevant unit regression: 38 files / 1177 tests passed. This includes the separate in-progress v2 Draft sentence tests; it is not proof of a finished Draft consumer.
- Marketing and public-tools typechecks passed.
- Changed frontend/E2E file ESLint passed.
- Secret scan plus 75 redaction tests passed.
- Marketing production build passed, generating 297 static pages.
- Playwright content-brief.spec.ts on loopback port 3417: 28/28 passed against that fresh standalone build.

Browser cases include 1280px/390px × EN/ZH × light/dark, actual computed text sizes, no horizontal overflow, keyboard result focus and disclosure traversal, real editing/ordering, downloaded JSON validated by the confirmed parser, exact retained revision after a failed rerun, auth dialogs, quota/network recovery, and refresh clearing local state.

The first browser run exposed an outdated test assumption about the first Tab target. The actual first interactive result element is now the page-evidence disclosure. The test verifies opening/closing that disclosure and then tabbing to the first question evidence, rather than weakening the focus check.

The initial screenshots were obscured by the Cookie banner. They were not accepted as visual proof. The final eight visual cases select Necessary Only through the actual button, use a local consent response fixture, assert the banner is gone, and capture fresh screenshots. Root inspected desktop and mobile ZH dark images.

## Retained screenshots

- desktop-zh-dark.png — 880px-wide result. SHA-256 fd709f60d1a4be28750d96a4b4ba4f7cfe3a41366746a92f3a92516a0eb54920
- mobile-zh-dark.png — 342px-wide result in the 390px viewport. SHA-256 a054d93ef04fc100d74df92c427b2b31a1f5232c06bd44e25aa3ecb4d6aa95d2

Verified source bytes:

- content-brief-v2-results.tsx — 4f33801dd03fabfb67c2a45fd2f1958d953262ac1f13f7cf66a0b5a25747829a
- content-brief-v2-editor.tsx — a876a3f0e3ce713b9b157e5e8eb5fc789104b4a9c722e4676fb4fb9d9a7c5abf
- content-brief-tool.tsx — 6d4294ca82b638d9324fe9ec5c6a03c47f6855de68f3c12e922d0568c890b2f7

## Reviews and remaining work

Independent read-only spec and quality review passed. Spec findings about erased results on failed reruns and vacuous legacy-selector assertions were reproduced and fixed; the revised controller test and browser retained-download case verify them.

The new confirmed Brief has NOT yet been connected to the Draft v2 intake, generation, coverage or section-rerun path. No misleading Draft navigation has been added. The cross-tool GEO import explanation, complete Brief-to-Draft browser flow, live provider relevance/writability canary, PR/merge and Marketing-only production release remain required before the active goal can be completed.
