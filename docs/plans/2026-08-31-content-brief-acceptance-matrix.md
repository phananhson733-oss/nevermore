# Content Brief Artifact acceptance matrix

This is the full-goal acceptance checklist, not a completion report. Exact fixture/source bytes, executed commands, and resulting revision/deployment identities must be attached as the work progresses. Backend rows reflect the proposed repair semantics; final contract freeze must record any clarified choice rather than silently weakening a row.

## Fixed-input product cases

| ID | Frozen input | Independent expected outcome | State |
| --- | --- | --- | --- |
| Q01 | Three headings: “How long does Search Console take to update?”, “When will fresh GSC numbers appear?”, “What is the reporting delay in Google Search Console?” | A relevant update-delay question can be represented despite different wording; page bindings retain the three actual observations. No requirement to invent three separate questions. | Pending |
| Q02 | Repeated “Related articles”, “Subscribe”, “About us” headings plus real article paragraphs | Template headings do not become must-answer questions or satisfy writing readiness. | Pending |
| Q03 | Relevant sampled PAA question, no matching competitor heading | Question appears with PAA provenance and can be mapped into outline/Draft coverage. It does not increase observed competitor coverage or authorize factual claims. | Pending |
| Q04 | Same PAA text repeated, an unreadable element, and a missing block | Raw provider order/duplicates preserved in the source ledger; consumer grouping and unreadable/unknown counts remain explicit. Missing evidence is not zero PAA. | Source tests passing; consumer pending |
| Q05 | Only one usable, relevant evidence-backed question | Do not suppress an outline solely because there are fewer than three questions; preserve explicit source constraints. | Pending |
| Q06 | No usable question evidence at all | No invented question set or fabricated “ready” state; explain which evidence is missing and how to adjust the run. | Pending |
| P01 | Primary query absent; supporting query has an observed owned-page match | Show which supporting query matched. Do not claim the primary ranks, or that no self-competition exists. Use actual page content to resolve the action. | Pending |
| P02 | Existing relevant owned page with average position beyond the old cap | A low position alone does not prove a new page cannot compete. Existing page remains visible in decision evidence. | Pending |
| P03 | Update action with fetched current page containing retained, incomplete and missing sections | Explicit keep/add/rewrite plan with source-bound reasons; Draft uses that target and plan. | Pending |
| P04 | Update target fetch unavailable or replaced by redirect | No silent new-page fallback or assertion about unread content. An unresolved rewrite remains unresolved until the user addresses it. | Pending |
| P05 | No GSC selected | Neutral not-used source state. Page ownership is unverified, not zero exposure. Question research remains usable within its independent source limits. | Presentation in progress; business pending |
| E01 | Edit H2 wording and reorder outline sections | Questions/evidence unchanged; changed content/order covered by a new fingerprint and explicit confirmation; export and Draft bind the same revision. | Pending |
| E02 | Forged question/source refs, duplicated coverage, stale pre-edit Draft or altered fingerprint | Exact rejection before paid Draft work. Do not repair untrusted payloads into a passing object. | Pending |
| E03 | Real historical Content Brief v1 JSON | Original v1 validation remains exact; no fabricated v2 evidence. Compatibility behavior must be explicit and tested. | Pending |
| E04 | GEO Brief JSON with schemaVersion marketing-geo-brief.v1 | Specific incompatible-tool explanation and correct entry link; no schema coercion. GEO-to-Draft capability is outside this first-tool repair. | Pending |
| L01 | Chinese query with Chinese page headings/body and PAA | Question and outline path is not blocked by whitespace-tokenization assumptions. Length uses a clearly named appropriate measure, not mislabeled English words. | Pending |
| S01 | Partial page reads and no observed gap in their bounded excerpts | Describe only the inspected scope. Do not assert that entire competitor pages or the whole site lack the topic. | Pending |
| S02 | Owned-page URL without fetched content | The URL proves a target exists, not that the page owns an inferred topic. Suggestions and verified page-content claims remain distinct. | Pending |
| F01 | Format distribution 4/3/3 | Report no dominant format and preserve the actual distribution/candidates; do not imply an observed exclusive recommendation. | Pending |

## Presentation and interaction cases

| ID | Check | State |
| --- | --- | --- |
| U01 | Latest supplied React Artifact structure, approximately 880px content width, compact three-field row, question table, clear outline and handoff | Local fixture pass, 1705aa31 |
| U02 | Completed run collapses settings; reopening and editing controls never submits automatically | Local fixture pass, 1705aa31 |
| U03 | Keyword and page action precede large detail surfaces; runtime and evidence disclosures default closed | Local fixture pass, 1705aa31 |
| U04 | Not-requested profile is neutral “not used”; no attempted-unknown error; selected-but-failed source remains a distinct failure | Local fixture pass, 1705aa31 |
| U05 | Partial summary lists only actual limitations with actual counts | Local fixture pass, 1705aa31 |
| U06 | Browser-computed evidence paragraph size matches compact design despite global p rules | Local fixture pass, 1705aa31 |
| U07 | 390px and desktop, EN and ZH, light and dark: no page horizontal overflow; long URLs/ids readable; native disclosure keyboard interaction works | Local browser pass across 8 combinations, 1705aa31 |
| U08 | Visible source/coverage counts, exported JSON, and Draft intake agree on the exact same confirmed revision | Pending |

## Release and real canary gates

- [ ] Exact canary keyword/supporting/market/language/profile/GSC/owned-page scope and paid-call allowance confirmed before execution.
- [ ] Fixed-source cases above pass with independent expected outcomes; tests do not merely echo generator decisions.
- [ ] Real produced questions are relevant and exclude template headings; output remains source-honest.
- [ ] Real outline can be edited/reordered/confirmed, exported and handed off with the same final fingerprint.
- [ ] Correct create/update action drives Draft; insufficient rewrite evidence does not become a new-page draft.
- [ ] Applicable typecheck/lint/unit/browser/build/security gates rerun on the final bytes; unrelated baseline failures are explicitly separated.
- [ ] Independent spec review and then code-quality review closed.
- [ ] Reviewed PR merge SHA matches READY Marketing deployment and canonical aliases.
- [ ] Product deployment identity independently retained; no database/CMS/Worker expansion.
- [ ] Sanitized report ties every claim to local, fixed-fixture browser, or real production evidence. None of these tiers substitutes for another.

Only when these full-scope requirements are proven may the active goal be marked complete.
