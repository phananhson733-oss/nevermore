# Content Brief Production QA Remediation Design

## Context

The 2026-08-30 production QA on `gengrowth.ai` exercised keyword-only, GSC-only, confirmed-profile-only, and combined GSC/profile Content Brief runs. The supported paths can complete, but current production also recorded two `503 brief_unavailable` responses at the same exact-parser path. Public black-box QA found every Tools Hub card link unnamed in Chrome's accessibility tree, and mobile sign-in can lose focus after its Sheet opener is unmounted.

The owner explicitly authorized code changes, commits, push, PR creation and merge, and a Marketing-only production release after these findings and root causes were reported.

## Goals

1. Make every crawl excerpt and heading produced under a shared character cap acceptable to the exact Content Brief parser, including astral Unicode characters.
2. Give every Tools Hub card link a stable accessible name equal to its tool title.
3. Restore focus to a stable mobile Header control after the sign-in dialog closes when the original Sheet button has unmounted.
4. Preserve the existing public contracts, visual design, route shapes, auth flow, Brief output schema, and Marketing-only release boundary.

## Non-goals

- Do not change GSC, profile, DataForSEO, LLM, quota, or persistence behavior.
- Do not change the public Content Brief schema or fingerprint domain.
- Do not globally redefine every non-model `text()` decoder.
- Do not restructure the whole Tools Hub card DOM or visual layout.
- Do not attempt to make Escape events cross the Google cross-origin iframe boundary.
- Do not change `apps/web`, database migrations, Railway Worker, or production environment variables.
- Do not include unrelated existing lint/E2E baseline fixes.

## Considered approaches

### A. Surgical boundary alignment and explicit accessible/focus metadata (selected)

- Add a non-model code-point-counting text decoder and use it only for crawl strings already bounded by `boundChars`: excerpt heading/text and page H2/H3 arrays.
- Give the existing ToolCard link `aria-label={title}` so its accessible name does not depend on Chrome traversing an inner `article` sectioning root.
- Add an optional close-focus target to `SignInDialog`; the Header supplies the persistent mobile menu trigger only when mobile sign-in opened the dialog.

This directly closes each proven root cause while preserving data and visual structure.

### B. Global parser and component restructuring

- Change the shared `text()` decoder to count code points everywhere.
- Rewrite ToolCard as `article > Link`.
- Convert all seven controlled SignInDialog owners to Radix DialogTrigger composition.

This could remove broader classes of drift but changes many unrelated contracts and interaction paths. It is too broad for a production hotfix.

### C. Producer-only truncation and partial accessibility patches

- Re-truncate crawl strings by UTF-16 length.
- Add card labels.
- Leave mobile focus behavior unchanged.

This would reintroduce the surrogate-splitting problem `boundChars` exists to prevent and would knowingly leave one accepted QA issue open.

## Selected architecture

### Crawl character contract

`boundChars` remains the producer authority and continues to bound by Unicode code point. `parse-brief-shape.ts` gains a decoder that only validates string type and code-point min/max; unlike model text, it does not reject angle brackets or normalize prose. The crawl excerpt heading/text and H2/H3 arrays use this decoder. Other identifiers, URLs, provider strings, and non-crawl fields keep the existing UTF-16 `text()` behavior.

The regression proves the contract at the exact boundary: a valid Brief whose crawl excerpt contains exactly `CRAWL_EXCERPT_MAX_CHARS` emoji is shape-valid, while one code point over the cap is rejected. A crawl producer test also proves a long astral excerpt is bounded without a broken surrogate.

### Tools Hub accessible name

The whole card remains one Next.js Link with the current `Link > article` visual DOM. The link receives `aria-label={title}`. The existing EN and ZH title strings are already localized and are the correct concise names. A real Hub Playwright assertion uses `toHaveAccessibleName` so future DOM changes cannot silently remove the name.

### Mobile sign-in focus return

`SignInDialog` accepts an optional `returnFocusRef`. When present and connected, its `DialogContent.onCloseAutoFocus` prevents the default restoration and focuses that stable element. The Header owns a ref on the always-mounted mobile menu trigger and records whether mobile or desktop sign-in opened the shared dialog. Only the mobile path supplies the fallback, so desktop and tool-level dialogs retain Radix's current behavior.

The regression opens the mobile Sheet, launches sign-in, closes the dialog, and asserts focus returns to the menu trigger rather than `BODY`. Separate characterization keeps the Google iframe Escape limitation out of the application contract.

## Error handling and safety

- No new runtime errors or user-facing error codes are introduced.
- If the optional focus ref is absent, disconnected, or hidden, Radix default close behavior remains in control.
- The parser remains fail-closed for strings exceeding the code-point cap.
- No secret values, GSC rows, profile facts, or production payloads are stored in fixtures.

## Verification and release

1. TDD red/green for each root cause.
2. Focused unit tests plus Content Brief and Content Draft exact Playwright slices.
3. Marketing and public-tools typecheck, affected-file ESLint, production build, and public-tools boundary check.
4. Independent diff review before PR.
5. PR must contain only Marketing/public-tools tests, implementation, and plan docs. No migration, Worker, or Product code.
6. Merge reviewed SHA and verify current `origin/main` matches the merge.
7. Wait for Marketing Vercel production READY on the exact merge SHA and recheck `gengrowth.ai` / `www` / EN / ZH / auth boundary / error logs.
8. Independently record Product deployment candidate and retained `app.gengrowth.ai` production identity.
9. Repeat keyword-only, GSC-only, profile-only, combined, Unicode/crawl reproduction, Hub AX, and mobile focus production QA. Update the existing QA report and baseline only from fresh evidence.
