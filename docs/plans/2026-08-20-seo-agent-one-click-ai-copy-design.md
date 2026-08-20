# SEO Agent one-click AI copy design

Date: 2026-08-20

Status: approved by the owner through “复制文本给 AI 按照方案 A 来做”.

## Outcome

Give the selected SEO audit issue one obvious, one-click handoff to AI while
keeping the existing evidence, implementation and authority boundaries.

The primary action copies a task built from:

- the selected SEO check;
- exact affected URL or Site-level observations;
- measured evidence and source/truth state;
- the proposed fix;
- validation steps;
- impact, risks and limits;
- the explicit no-commit, no-push and no-deploy boundary.

It does not copy the full 80-check report and does not ask an AI to summarize
the report. The unit of action remains one selected, evidenced issue.

## Current state

The capability already exists but the interaction is more complicated than the
On-Page Checker reference:

- two separate buttons are always visible: Chatbot and Code Agent;
- two previews sit above them;
- the entire copy panel is the last section in the Stage 04 right column;
- a visitor has to understand the audience distinction before the first click.

The existing builder is authoritative and remains unchanged unless a regression
test proves a payload defect:

- schema: `seo_ai_action_copy.v1`;
- Chatbot and Code Agent receive different fixed instructions;
- all visitor/page/provider data stays inside fenced JSON;
- Code Agent is withheld for source-gated, unavailable or illustrative
  evidence;
- payloads are bounded by UTF-8 bytes;
- no copy action calls a provider, LLM or persistence API.

## Reference: On-Page Checker

Reuse these interaction properties from the On-Page Checker:

- one primary copy button beside the useful result;
- immediate clipboard write without requiring a preview first;
- mounted live status;
- the exact copied text in a read-only textarea when clipboard access fails;
- select the fallback text when it receives focus;
- no network request from the copy action.

Do not reuse its payload shape. On-Page copies a whole one-page audit report;
SEO Agent copies one selected implementation task with stronger evidence and
authority gating.

## Proposed interaction

Place the AI handoff directly below the Stage 04 header and before the
two-column solution body, so it is reachable before the long evidence and
validation sections on desktop and mobile.

```text
Stage 04 header

┌────────────────────────────────────────────────────┐
│ Copy the selected SEO fix for AI                   │
│ Issue + affected URLs + fix + validation           │
│                                                    │
│ [ Copy text for AI ]          Copied / failed      │
│                                                    │
│ ▸ Advanced copy options                            │
│   - Preview Chatbot task                           │
│   - Preview Code Agent task                        │
│   - Copy for Chatbot                               │
│   - Copy for Code Agent                            │
└────────────────────────────────────────────────────┘

Stage 04 two-column body
```

### Primary action selection

The label is `Copy text for AI` / `复制文本给 AI`.

Selection is deterministic:

1. If the Code Agent task is available, copy the Code Agent task.
2. Otherwise, if the Chatbot investigation task is available, copy that task.
3. Otherwise disable the primary action and show the existing refusal reason.

This means an evidenced SEO defect becomes an implementation task in one click.
An unavailable/source-gated check becomes an investigation task rather than an
unsupported implementation claim.

### Advanced options

Keep the existing capabilities inside one collapsed disclosure:

- exact Chatbot preview;
- exact Code Agent preview or refusal copy;
- explicit `Copy for Chatbot` action;
- explicit `Copy for Code Agent` action.

The advanced section is optional. A visitor does not have to open it before
using the primary action.

## Copy contents

The primary Code Agent copy remains selected-issue-only. It contains:

1. issue identity and result/engine/truth state;
2. target and confirmed run context;
3. exact affected URL observations and evidence values;
4. the proposed fix and implementation preview;
5. validation, impact, risks and limits;
6. fixed instructions to inspect the repository, map URLs to owners, implement
   the minimum change and run focused tests;
7. explicit refusal to commit, push, deploy or edit production without separate
   authority.

The Chatbot fallback contains the same selected issue data but asks for a
decision-ready remediation or investigation plan rather than repository edits.

## State and failure behavior

- Preview, clipboard and fallback use the same built Markdown string.
- A new copy attempt clears stale status and fallback immediately.
- Only the latest overlapping clipboard request may update feedback.
- Switching recommendation invalidates feedback from the previous issue.
- Clipboard denied or missing renders the identical read-only textarea.
- Focusing the fallback textarea selects all text for manual copy.
- The live status stays mounted with `aria-live="polite"`.
- `context_invalid` and `serialized_too_large` disable all copy actions and do
  not masquerade as investigation states.
- Tech Agent pages do not render the SEO handoff. A Tech-primary subordinate
  check selected inside an SEO run remains valid.

## Visual behavior

- The handoff strip uses the existing Stage 04 panel tokens and remains inside
  the full-width Stage 04 border.
- Desktop and mobile both show the primary button before the long solution
  body.
- Advanced contents remain collapsed by default.
- Buttons retain keyboard focus styles and disabled semantics.
- The change does not alter the approved Stage 04 title, typography, two-column
  body or preview-only boundary.

## Non-goals

- No whole-report SEO Agent copy in this change.
- No multi-issue or top-three action packet.
- No automatic repository mapping.
- No LLM call on copy.
- No credit spend.
- No project, database, CMS, repository or production write.
- No change to audit ranking or evidence contracts.

## Acceptance criteria

1. One primary `Copy text for AI` action is visible before the Stage 04 body.
2. With actionable evidence it copies the Code Agent Markdown in one click.
3. With unavailable/source-gated evidence it copies the Chatbot investigation
   Markdown and Code Agent remains unavailable.
4. Advanced options preserve both previews and both audience-specific actions.
5. The primary action issues zero fetch/provider calls.
6. Preview, clipboard and fallback strings are byte-for-byte identical.
7. Clipboard denial/missing support shows and auto-selects the fallback.
8. Recommendation switches and overlapping clipboard requests cannot expose a
   stale issue task.
9. EN and ZH message catalogues are complete.
10. Existing Stage 04 evidence, solution draft, validation, risks, limits and
    preview-only boundaries remain unchanged.
11. 1440px and 390px views have no horizontal overflow or clipped action.

