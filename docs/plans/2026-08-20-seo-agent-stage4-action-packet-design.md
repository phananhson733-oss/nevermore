# SEO Agent Stage 04 Action Packet Design

Date: 2026-08-20

Status: approved by the owner through “按照方案 A 修复” and the preceding
requirement that detected URLs, concrete remediation, and selected-problem AI
handoffs be shown instead of copying a generic report.

Baseline: branch `fix/seo-agent-remediation-20260820`, Git SHA
`76ea48ea5009302f2daf5aefca83d63b85ee421f`.

## Outcome

Make the selected SEO recommendation a compact, Artifact-aligned and directly
usable action packet:

- the four stages stack vertically;
- Stage 04 is a full-width numbered stage with the approved typography,
  spacing and two-column reading rhythm;
- Stage 02 and Stage 04 expose the actual affected URL observations and their
  measured values;
- the selected solution says where the change belongs and how to implement and
  verify it without inventing repository paths or page facts;
- the visitor can copy one selected issue as a purpose-built task for a
  Chatbot or Code Agent;
- copied text is an implementation brief, not a dump of the whole audit;
- no copy or button applies, commits, pushes, deploys, or writes to an App
  Product Profile.

## Authorities and boundaries

The customer visual authority is the approved Unified SEO Agent Artifact:

`/Users/wzb/Documents/gengrowth-tools/artifacts/designs/2026-08-17-unified-seo-agent-onpage`

In particular:

- `finalized.html` Stage 04 owns the numbered stage, header/body rhythm and
  two-column solution drawer;
- `design-spec.md` §8.2 requires evidence, impact, proposed change, validation,
  risks and limits to be reviewed together;
- current code, wire contracts and tests remain authoritative for real fields,
  provenance, permissions and available observations.

The Artifact's minimal Implementation/Validation body is therefore a visual
reference, not permission to delete the additional evidence and safety fields
required by the current product contract.

## Current defects

### 1. Global paragraph rules override the intended compact module type

`globals.css` gives every paragraph a responsive body size and gives Chinese
paragraphs a 1.75 line-height. `DetailSection` sets its parent to 12px/1.65,
but its child `<p>` elements match the global rule directly, so the parent size
does not win. The rendered body becomes roughly 15.5–17.4px/1.75 while the
Stage title is only 18px. The hierarchy is inverted: body copy approaches the
headline while the actual stage headline is suppressed.

### 2. Stage 04 uses the selected check as its Stage headline

The existing localized `stage4Title` is unused. The specific check title is
rendered as the main h3, although the Artifact makes the Stage purpose the
headline and places the selected issue inside the body.

### 3. Stage 03 and Stage 04 are side by side

At 981px the recommendation surface uses a 39/61 two-column layout. The design
spec requires the four stages to stack top-to-bottom. Stage 04 consequently
looks like a narrow audit-detail sidebar and grows excessively tall.

### 4. A detected issue is not yet a complete action packet

The current Stage 04 shows at most three observation cards and the Stage 02
detail shows no record observations at all. Generic advice can therefore sit
beside an issue without the exact affected URL, observed values, target scope,
or a deterministic handoff for the tool that will implement it.

## Visual design

### Stage stacking

`AgentRecommendations` becomes a vertical stack:

```text
Stage 03 · prioritized recommendations
Stage 04 · selected solution and validation
```

Stage 03 remains a selector. Stage 04 is full width and follows the approved
stage-panel visual language.

### Stage 04 header

The header contains:

- circular `04` index;
- mono eyebrow `Stage 04 · Selected solution & validation`;
- localized `stage4Title` as the main heading;
- the existing explanatory `stage4Body` below it;
- the existing Preview only / Unavailable investigation badge on the right.

Target typography:

| Element | Mobile | Desktop | Line height |
|---|---:|---:|---:|
| Stage eyebrow | 10px mono | 10px mono | 1.2 |
| Stage headline | 26px | 32px | 1.12–1.16 |
| Selected check title | 18px | 19px | 1.25 |
| Section heading | 14px | 14px | 1.4 |
| Body / list / factual text | 13px | 13px | 1.65 |
| Evidence label | 10px mono | 10px mono | 1.3 |
| Evidence value / code | 12px | 12px | 1.65 |

Every paragraph/list/value in the module receives an explicit class. The
module does not rely on inheriting a size from a parent and therefore cannot be
re-expanded by the global `p` rule or Chinese paragraph rule.

### Spacing

- header: 22px × 18px on mobile, 30px 32px 26px on desktop;
- body: 22px × 18px on mobile, 30px × 32px on desktop;
- two-column gap: 14–20px depending on viewport;
- section rhythm: 16px between related sections, 24px only at major group
  boundaries;
- nested fact padding: 12–14px;
- code preview: 16px padding, 12px/1.65 mono.

### Stage 04 body

Desktop uses two equal columns; mobile uses one column.

Left column:

1. selected problem and reason;
2. exact evidence and affected URLs;
3. proposed change / implementation preview;
4. optional generated content draft when the existing draft contract supports
   the solution kind.

Right column:

1. applicable Product/search/page context;
2. validation steps;
3. impact surface;
4. risks;
5. limits and unknowns;
6. AI action handoff.

The full set remains present. No required field is hidden solely to imitate
the Artifact's synthetic minimal example.

## Exact evidence and affected URLs

### One shared projection

Add one pure projection from the selected check's `evidenceRecordIds` and the
run's joined record ledger:

```ts
interface AgentAffectedObservation {
  recordId: string;
  url: string | null;
  values: readonly { label: string; value: string | number | boolean | null }[];
}
```

Rules:

- preserve the exact observed URL spelling returned by the audit;
- deduplicate the same canonical URL across sibling records while retaining
  every record/value group;
- keep `url: null` as an explicit Site-level observation; never fabricate a
  URL from `siteOrigin` or `targetUrl`;
- page-scope checks remain filtered to the inspected target page through the
  existing recommendation evidence seam;
- observed counts and omitted counts remain explicit;
- no observation means No displayable observation, not zero affected.

### Presentation

Stage 02 focused detail and Stage 04 Evidence use the same component:

- heading `Affected URLs` with exact count;
- first 5 URL rows expanded by default;
- `Show all N` exposes the full bounded in-memory set;
- each row shows the URL, record title, and labeled observed values;
- URLs are openable in a new tab with `noopener noreferrer`;
- Site-level aggregate evidence is shown in a separate row and never presented
  as a page URL;
- for a large template-wide issue, the UI says that the listed pages are
  observations and that the implementation owner may be a shared template.

The full run remains browser-local. No new persistence or download endpoint is
introduced.

## Where and how to change

Stage 04 derives an honest target statement:

- one affected URL: name that exact page;
- several URLs: name the count and show the concrete list; say `inspect the
  shared route/template if these pages have a common owner` rather than
  inventing a file;
- target-page record: name the inspected target URL;
- Site-level observation: say `site/template/configuration level; repository
  location was not observed`;
- unavailable/source-gated evidence: provide an investigation task, not an
  implementation claim.

The solution template continues to own recommendation, preview, validation,
impact, risks and limits. A deterministic preview may show code/config/content,
but it is never described as applied.

## Selected-problem AI action brief

### Why this is not report copy

The copied document contains only the selected check and the context required
to act on it. It excludes unrelated health totals, recommendation rows and raw
page/report payloads.

### Pure builder

Add a pure module modeled on the existing GEO copy-brief trust boundary:

```ts
type SeoAiActionAudience = "chatbot" | "code_agent";

interface SeoAiActionBriefInput {
  audience: SeoAiActionAudience;
  locale: "en" | "zh";
  selectedCheck: AgentAuditEvaluatedCheck;
  evidenceRecords: readonly SeoAuditRecord[];
  targetUrl: string;
  profile: AgentProfileDraft;
  solution: AgentSolutionTemplate;
}
```

Output is bounded Markdown with a versioned schema marker:

`seo_ai_action_copy.v1`

All instructions are repository constants outside fenced blocks. Every value
that came from a visitor, crawled page, Search Console or another provider is
inside escaped fenced JSON and preceded by `UNTRUSTED_DATA_NOTICE`. The brief
uses the shared byte-budget helper and never lets hostile page text become an
instruction.

### Shared action packet

Both audiences receive:

1. task identity and selected check;
2. severity, engine and truth states;
3. exact target URL and affected URL observations;
4. measured values and evidence sources;
5. proposed change and implementation preview;
6. applicable confirmed context;
7. validation steps;
8. impact, risks, limits and unknowns;
9. explicit no-write/no-deploy authority.

### Chatbot brief

The Chatbot instruction asks for:

- a decision-ready remediation plan or final copy proposal for this issue;
- per-URL or shared-template treatment;
- unsupported assumptions and facts the user must provide;
- a validation checklist;
- no claim that anything was edited or deployed.

It does not ask the Chatbot to summarize the report.

### Code Agent brief

The Code Agent instruction asks it to:

- inspect the supplied repository before choosing files;
- map each affected URL to its route/template/content owner;
- prefer one shared-template fix when evidence shows a repeated pattern;
- implement the minimal change;
- preserve observed facts and never invent file paths, claims, prices or data;
- add focused tests and run the relevant checks;
- return files changed, commands run, unresolved facts and validation results;
- not commit, push, deploy or alter production without separate authority.

### UI

Stage 04 includes:

- `Copy task for Chatbot`;
- `Copy task for Code Agent`;
- a collapsed preview showing the exact text that will be copied;
- live copied/failed status;
- a read-only textarea containing the identical brief if Clipboard access is
  denied.

If evidence is unavailable, the Code Agent implementation action is withheld;
the Chatbot action becomes an explicitly labeled investigation brief.

The existing on-demand `AgentSolutionDraft` remains available for the two
content shapes it can truthfully draft. It is not replaced by the action brief,
and no new LLM call is made merely to copy a task.

## Data flow

```text
validated Agent result
  -> allAgentAuditRecords(data)
  -> selected evaluated check.evidenceRecordIds
  -> exact evidence records / affected observations
  -> Stage 02 affected-URL detail
  -> ranked selected recommendation
  -> Stage 04 two-column solution
  -> solution template + action packet
  -> Chatbot brief OR Code Agent brief
  -> Clipboard only (fallback textarea on denial)
```

## Error and honesty states

- no observation: say no displayable observation; do not manufacture the
  target URL;
- Site-level observation: name it as Site-level;
- more URLs than the action-brief budget: include as many complete rows as fit,
  publish included/omitted counts, and state that the sample is incomplete;
- malformed/oversized brief: disable copy with a localized explanation;
- Clipboard denied: render the exact same string in a read-only textarea;
- source-gated/unavailable: investigation brief only;
- a generated draft is preview-only and distinct from the deterministic AI
  task brief;
- no button writes to a project, repository, CMS, customer site or production
  environment.

## Explicit non-goals

- No automatic site edit, repository write, PR, commit, push or deployment.
- No repository OAuth or Code Agent connector in this change.
- No copying of the whole report as the primary action.
- No hidden LLM call or credit spend from either copy button.
- No fabricated file path, template identity, URL or page fact.
- No removal of evidence, context, impact, risk or limitation fields.

## Acceptance evidence

1. At desktop, Stage 03 and 04 stack vertically and Stage 04 is full width.
2. Stage 04 renders numbered header, `stage4Title`, Preview-only badge and the
   approved type/spacing scale in EN/ZH and dark/light.
3. No Stage 04 paragraph inherits the global responsive paragraph size or
   Chinese 1.75 line-height.
4. At 390px, the two-column body becomes one column with no horizontal
   overflow and no clipped copy actions.
5. A real URL-bearing record shows the exact URL and observation values in
   both Stage 02 and Stage 04.
6. A Site-level record remains Site-level and does not receive a fabricated
   URL.
7. Show all exposes every bounded observation in the current result.
8. Chatbot and Code Agent copies are different, selected-issue-only briefs.
9. Copied text uses constant instructions plus fenced untrusted JSON; hostile
   page strings cannot escape the fence.
10. Code Agent copy names exact URLs, proposed change, validation, risks and
    no-deploy authority without inventing repository files.
11. Clipboard fallback displays the exact same string.
12. No copy action issues an API/provider request or persists state.
13. Existing solution draft behavior and Agent execution/report contracts stay
    green.
