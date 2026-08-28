# Keyword Opportunity Results Layout Design

Date: 2026-08-27
Status: Approved in conversation
Target: `apps/marketing` on `gengrowth.ai`
Base: `origin/main@4136e166894095d46fcff4f6d38232e3c669f156`

## Goal

Turn the low-competition keyword result from a ten-column evidence dump into a
compact, comparable opportunity list. Keep every provider, GSC, SERP, and model
provenance fact inspectable, but move technical detail out of the always-visible
row and into a per-row evidence expansion.

## Authority and input boundary

- The current `keyword_opportunity_map.v2` result contract and Marketing source
  code control data meaning and availability semantics.
- The user-provided Claude Artifact and screenshots control visual direction
  only. Their mock weekly refresh, credits, persistence, history, automatic
  Brief creation, and open product questions are not implementation authority.
- This change is local-only. It does not authorize commit, push, PR, deploy,
  migration, provider calls, or production data writes.
- The target is `apps/marketing` only. `apps/web`, Worker, database, Supabase,
  and `app.gengrowth.ai` remain out of scope.

## Problem evidence

The current `RowTable` uses a `min-w-[1480px]` ten-column SEO table. Its signal
and AI Overview cells add their own `min-w-[270px]` and `min-w-[220px]` blocks.
Provider intent, SERP interpretation, model id, prompt version, full community
URL/title, availability, answer assessment, coverage, and remaining decisions
all compete in the same always-visible row.

The result is not primarily a colour-theme problem. It is an information
hierarchy problem:

1. decision facts are mixed with raw evidence;
2. raw evidence is mixed with technical provenance;
3. narrow columns wrap Chinese labels one character at a time;
4. one row can fill most of a desktop viewport;
5. adjacent keywords cannot be compared without horizontal and vertical
   scanning.

The existing competitor keyword gap result demonstrates the desired visual
language: explicit table typography, compact source badges, data chips distinct
from state pills, one locally scrollable table container, and progressive rows.

## Chosen direction

Use a compact decision table with per-row evidence expansion.

Rejected alternatives:

- Restyling the existing ten columns leaves the information hierarchy intact.
- A second mobile-only card DOM duplicates content and semantics for a bounded
  presentation change.
- New sorting, scoring, cross-tool actions, or Brief generation would change
  product behaviour without a supporting contract.

## Result reading order

1. Degraded-run verdict, only when the run is not fully available.
2. Compact run context and outcome counts.
3. Collapsed screening process containing the existing nine honest funnel
   counts.
4. SEO opportunity table.
5. GEO question table.
6. Incomplete candidates, lexical groups, withheld candidates, and next links,
   preserving their current semantics.

The CSV export remains adjacent to the included result, and its deterministic
order remains shared with the UI.

## Compact run context

Merge the current context summary and eligible summary into one result header.
It shows:

- site;
- market and language;
- fetched pages and product pages;
- included opportunities;
- incomplete candidates;
- withheld candidates;
- CSV export.

Selection accounting and early stop facts remain visible below the scope strip.
The nine-stage funnel moves into a native `<details>` element labelled as the
screening process. A missing stage continues to render as not measured, never
as zero.

## SEO table

The SEO table has six columns:

| Column | Always-visible content |
| --- | --- |
| Keyword and intent | Keyword, provider intent, separately labelled SERP-interpreted intent |
| Monthly volume | One right-aligned tabular provider value or an explicit unavailable state |
| Competition context | KD, weakest known domain rank, domain, and page-one position |
| Low-competition evidence | Compact young-domain, low-traffic-domain, and community-result states |
| AI Overview | Provider availability and separately labelled answer assessment |
| Coverage and review | Coverage state, remaining decisions, and evidence expansion control |

The table target is approximately `1120-1200px`, down from `1480px`. The page
must never scroll horizontally; only the focusable table container may scroll
at narrower widths.

## GEO table

GEO rows do not fabricate SEO metrics they do not own. They use five columns:

| Column | Always-visible content |
| --- | --- |
| Question and intent | Question, provider intent, separately labelled SERP-interpreted intent |
| Supporting page | Bounded readable host/path or an explicit unavailable state |
| Evidence | The same three independent signal states |
| AI Overview | Provider availability and model assessment, kept separate |
| Coverage and review | Coverage state, remaining decisions, and expansion control |

SEO and GEO remain separate sections so their distinct contracts stay obvious,
but they share typography, chips, row rhythm, and the expansion interaction.

## Evidence expansion

Each main row has a real button with `aria-expanded`, `aria-controls`, a visible
focus ring, and a minimum 44px touch target. When opened, a following full-width
table row is mounted and shows:

- provider intent and SERP interpretation provenance;
- model id and prompt version;
- young-domain registration date, observed time, and age;
- low-traffic domain, ETV, threshold, market, and observed time;
- community URL, title, position, and detection source;
- AI Overview availability, assessment, reason, discount, model id, and prompt
  version;
- the full remaining-decision list;
- full supporting-page URL where applicable.

Closed detail rows are absent from the DOM. This preserves inspectability
without making every result pay the layout and accessibility cost of expanded
evidence.

## Visual language

- Explicit table base typography: about `13px / 1.45`.
- Keyword: about `15.5px / 1.25 / 600`.
- Metadata: about `12px / 1.35`.
- Headers: `11-12px`, semibold/monospace, no character-by-character wrapping.
- Numeric cells: right aligned and tabular.
- Rectangular chips represent reported data.
- Rounded pills represent states.
- Green, amber, red, and muted tones always include text; colour is never the
  only carrier of meaning.
- Existing brand tokens control both light and dark themes. No new font, colour
  system, gradient, or page shell is introduced.

## Evidence honesty

The layout must preserve these distinctions:

- measured zero;
- provider no data;
- not observed in a bounded sample;
- stage not run;
- evidence unavailable.

Provider intent and SERP-inferred intent remain separately labelled even when
they share the keyword cell. AI Overview provider availability and LLM answer
assessment remain separately labelled even when they share the AI column.
Technical provenance moves to details; it is not deleted or reinterpreted.

## Accessibility and responsive behaviour

- Preserve semantic `<table>`, `<thead>`, `<th scope="col">`, and `<caption>`.
- Give the horizontal container `tabIndex={0}`, `aria-labelledby`, and a visible
  focus outline.
- Keep headers, metrics, and chips on one line; only keywords and short evidence
  descriptions may wrap naturally.
- Do not expose full URLs in compact rows.
- Maintain document-level horizontal overflow of zero at desktop and 390px.
- Expanded content must be keyboard reachable and announced through the button
  state.

## Non-goals

- No API, handler, provider, cache, GSC, LLM, or contract changes.
- No paid request or production canary.
- No opportunity score or changed deterministic ordering.
- No automatic Brief, App Action, database write, or cross-tool handoff.
- No changes to incomplete/withheld classification or CSV data.
- No commit, push, PR, or deployment without separate authorization.

## Acceptance

- SEO renders six compact columns and GEO renders five.
- The main row does not contain model ids, prompt versions, full community URLs,
  or full supporting-page URLs.
- Opening a row mounts the complete technical evidence and closing it unmounts
  that evidence.
- All existing ordering, availability, empty-state, grouping, retry, and CSV
  tests remain green.
- EN/ZH message parity remains green.
- Focused tests, typecheck, Marketing build, and browser checks pass.
- Browser checks cover EN/ZH, light/dark, 1440px, 1024px, and 390px with no
  document-level horizontal overflow.
