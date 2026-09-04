# GEO Knowledge Base Language Preflight Design

**Status:** Approved by the user on 2026-09-04 (option A).

## Problem

The GEO Knowledge Base one-gesture flow accepts a click when the saved GEO
question language is not English. The server correctly rejects that language
before model dispatch with `unsupported_language`, but the client has already
had an opportunity to save the draft and refresh website/Search Console
sources. The page then exposes the internal error code beside a generic error.

## Goals

- Reject a known unsupported question language before any request is made.
- Explain the English-only boundary in the visitor's UI language and include
  the actual saved question language.
- Keep the existing server-side English-only gate as defense in depth.
- Preserve the existing one-gesture sequence for `en` and `en-*` locales.

## Non-goals

- Do not add Chinese question generation.
- Do not silently rewrite a Profile or GEO language to English.
- Do not change provider, persistence, billing, source-receipt, or freeze
  contracts.
- Do not push, deploy, or change production configuration in this task.

## Selected design

The client hook reuses `isSupportedGeoQuestionLanguage()` from the existing
browser-safe GEO asset contract. The main build checks the effective language
that the Profile derivation would apply, not merely the pre-derivation draft
value. Direct generation, confirmation, and recovery actions instead check the
saved draft language they actually submit. The hook exposes both supported
states and checks them before `generateAll()`, every direct `generate()` action,
`buildFromProfile()`, and `confirmAll()`. If the applicable language is
unsupported, the hook records the existing `unsupported_language` status and
returns before save, source refresh, generation, recovery dispatch, or freeze.

The one-gesture and explicit recovery-dispatch buttons are disabled while the
language is unsupported. A visible localized explanation beside the primary
button names the actual language, says that no website/Search Console/model work
will start, and directs the visitor back to the Product Profile only when the
website language should really be English. The existing server guard remains
unchanged for stale clients and races.

If the server nevertheless returns `unsupported_language`, the generic error
renderer uses a separate conservative explanation: the rejected model step was
not called, while an earlier source refresh may already have completed. It
suppresses the raw code without making a false zero-side-effect claim. Truly
unknown codes remain visible for support diagnosis.

## Verification

- Hook test: `zh-CN` makes `generateAll()` return with zero `fetch` calls and an
  `unsupported_language` status.
- Hook test: normal, new-input, and same-key resend generation actions also
  return with zero `fetch` calls.
- Hook tests: the Profile-derived language, direct build, and direct confirm
  paths all refuse before any request.
- Inverse mismatch tests: a Profile-derived English language keeps the main
  build available while an unsupported saved draft still blocks direct
  generation, confirmation, and both recovery actions.
- Component tests: English and Chinese UI show localized, actionable copy,
  disable primary plus both recovery actions, and never render the raw code.
- Fallback test: a server `unsupported_language` response on otherwise eligible
  English input is localized honestly in both UI locales without changing
  unknown-code behavior.
- Regression: existing English one-gesture, synthesis, and server-preparer tests
  remain green.
