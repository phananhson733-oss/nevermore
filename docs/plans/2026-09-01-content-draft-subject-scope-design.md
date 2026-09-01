# Content Draft Subject-Scope Preservation Design

**Status:** Approved by the user on 2026-09-01.

## Goal

Prevent a Draft sentence supported by one named-person page, case study, example, or other page-specific observation from widening that observation into a site-wide or universal rule. The correction must preserve the existing provider-specific domain rule and keep unsupported general answers explicit as gaps.

## Production finding and root cause

The final production O4 rerun emitted:

> On www.astrologywiki.com, when the birth time is not on public record, the Moon sign, Ascendant, and houses cannot be verified.

Its only bound source, U34, is the observed Jude Bellingham page and uses the individual pronouns "his birth time" and "his Moon sign, Ascendant, and houses". The sentence therefore widened one person's page into a site-level rule. Q5 remained partial with an explicit gap, which was honest but did not repair the separate bound-sentence scope error.

The previous hotfix made service-specific commercial and interface conditions retain source_domain in the same sentence. The model complied with that rule here: it named www.astrologywiki.com. The missing invariant is different: a domain proves where an observation came from, not which person, page, case, or population the observation describes.

## Considered approaches

### 1. Prompt-only rule

Add the subject-scope instruction without changing private prompt data. This is the smallest change, but it leaves page identity and U-unit adjacency indirect. A previous prompt-only provider-scope attempt passed offline tests and still failed a real model probe, so this is not reliable enough.

### 2. Private page identity metadata plus prompt — selected

Enrich the already private pages prompt array once per scoped page, and add explicit subject-scope rules. This keeps the public Brief, confirmed Brief, Draft result, parser, fingerprint, permission and export contracts unchanged.

Each private scoped page receives the existing page metadata plus:

- source_domain from the observed final URL hostname;
- unit_ids containing the exact selected U units for that page;
- serp_titles containing zero or more records with serp_ref, title, and basis equal to serp_title_for_submitted_url.

serp_titles contains only non-empty titles from the frozen v3 SERP snapshot whose submitted URL exactly equals page.url, in frozen SERP order. It is empty for v2 or when there is no exact match. If the page redirected, the basis still states that the title belongs to the submitted pre-redirect SERP URL; source_domain continues to describe the observed final URL. No title is inferred from a URL slug, H2/H3, body text, or the model.

unit_ids binds this page identity record to the exact selected U units without repeating a potentially long title for every unit. Existing U heading/text remains the only factual evidence. SERP titles are untrusted scope hints, not fact support and not instructions.

The system rule requires named people, pronouns, case studies, examples, single-page observations and page-specific conditions to retain their actual subject. A source domain alone never broadens scope. When titles are unavailable or conflicting, the model must inspect the corresponding U heading/text. If the subject remains unclear, it must omit the generalized detail or emit an explicit gap with no evidence references. Raw navigation URLs, paths and inferred names remain forbidden in prose.

### 3. Semantic output validator

A validator could try to require a person or title token in every affected sentence, but no authoritative structured subject_scope currently exists. Natural-language heuristics would misclassify aliases, pronouns, translations, multi-source general facts and CJK. Letting the model self-report scope would not create a trust boundary. This would require a larger private output protocol or a future public contract version and is intentionally excluded.

## Data flow and boundaries

1. The server receives and strictly parses the same confirmed v2/v3 Brief.
2. The existing server-built section scope selects exact U and P references.
3. Prompt assembly derives private page identity metadata only from already frozen URL/SERP data and selected U relationships.
4. The complete system and user messages remain measured against DRAFT_V2_PROMPT_MAX_BYTES; no trimming, retry, fallback or source dropping is added.
5. Luna returns the unchanged private section JSON shape.
6. The existing exact section/Draft parsers, fingerprinting, presentation and JSON/Markdown exports remain unchanged.

## Failure behavior

- Missing SERP title: serialize serp_titles as an empty list; never infer one.
- Duplicate exact SERP URLs: retain every non-empty title in frozen order with its own serp_ref.
- Redirect: keep the exact submitted-URL title basis and final source_domain distinct.
- Hostile title: keep it only in untrusted user JSON; it cannot alter the system prompt.
- Subject still unclear: omit the specific generalization or use gap with an empty evidence_refs list.
- Prompt exceeds the existing hard cap: fail closed with zero model call; do not trim titles, U units or facts.

## Verification and release

1. RED tests prove the private page identity table and subject-scope rules are absent.
2. GREEN tests cover v3 exact titles, owned/no-match, duplicate URLs, redirects, v2 absence, hostile titles, unchanged confirmed bytes, retry parity and byte-cap failure.
3. Focused and related suites, types, lint, build, secrets/docs/spec/deploy gates and credential-free Brief/Draft/GEO-chain E2E run.
4. A real frozen-input O4 probe must keep Jude Bellingham explicitly scoped, retain Cafe Astrology/Maressa Brown provider scope, and preserve an explicit Q5 gap where general evidence is absent.
5. Independent content and code reviews must find no P1/P2 before merge.
6. Merge only the reviewed SHA; deploy Marketing only and independently confirm Product canonical remains unchanged.
7. Re-run the production O4 flow and download fresh confirmed JSON, Draft JSON and Markdown. Strict parsers, exact byte hashes and clean-prose subject scope must pass before completion.

## Explicit non-goals

- No public schema/parser/fingerprint/version change.
- No Azure/Railway/model/temperature/deadline/retry change.
- No database, quota, authentication, CMS, publication or Product promotion.
- No semantic truth certification: single-source and inferred-profile claims remain in the human verification list.
