# Content Brief V3 sampled SERP snapshot decision

This is a bounded implementation decision under the Content Tools Artifact completion plan. Local contract verification is not production or provider evidence.

## Version boundary

- New Briefs use `gengrowth.content_brief/v3` and require `context.serp = { rows, read }`.
- Historical `gengrowth.content_brief/v2` forbids that field and retains its exact source semantics, fingerprints and import bytes. No V2 metadata is invented during import.
- A V3 Brief is confirmed only inside `gengrowth.confirmed_brief/v3`; V2 keeps its V2 wrapper. Inner and outer schema mismatches fail closed even with recomputed checksums.
- Draft remains `gengrowth.content_draft/v2`, accepts an exact confirmed V2 or V3 revision, and freezes the actual confirmation schema in `confirmed_ref`. Cross-version reference substitution is rejected.
- Existing 224 KiB Brief and 256 KiB confirmation ceilings remain unchanged.

## Source and parser rules

The new snapshot reuses the existing `SerpObservation`, `SerpReadMeta`, ordered classifier and `buildSerpObservations`. It is bounded to ten sampled organic rows. The parser recomputes sequential S IDs, format values and ordered rule IDs from the exact retained URL, domain and title. Ranks must be unique safe positive integers; available read counts and complete/partial status must agree. Unavailable reads retain their reason and nullable attempted count and contain no rows.

V3 raw vendor URL strings are source-only data, limited to 2,048 UTF-16 code units; titles and domains retain the existing 2,000-unit bounds. An unusable vendor URL is not rewritten into another URL and does not invalidate unrelated retained evidence. Display consumers validate a URL before linking, and crawl transport retains its independent safety checks. Historical V1 HTTP URL decoding is unchanged.

Each retained competitor `Cn` must bind to sampled `Sn`, with `ResearchPage.url` exactly matching the sampled URL. `final_url` remains the observed crawl destination and may differ after a permitted redirect. Owned pages remain independently GSC-scoped. The displayed run SERP read must agree with the frozen snapshot read; source bytes are covered by the existing causal checksum, not authenticated by it.

## Presentation scopes

- V3 format distribution uses all returned sampled SERP rows, including owned-site rows and repeated URLs at different ranks. It is a URL/title/domain heuristic, not a full-SERP search-intent measurement or the model's writing recommendation.
- Unknown classified rows remain in the returned-row denominator. A majority requires strictly more than half that denominator. Without a majority, expose all actually observed known candidates; unresolved provider rows stay explicit in read metadata, not fabricated as classified observations.
- Question coverage uses a separate denominator: distinct retained competitor final URLs, using the same URL serialization and fragment removal as the research validator. PAA and owned pages do not increment it.
- Observed length remains competitor-only, complete-body-only and unit-separated. Quantiles use `h = (n - 1) * p` with linear interpolation and no pre-display rounding. A partial excerpt budget does not erase a reliable complete-body acquisition length.
- Historical V2 uses an explicitly labeled retained-page URL-only fallback because it has no sampled SERP titles or observed H1 field. H2/H3 and prose are never promoted into invented page titles.

## Local verification

The V3 tests pin pre-change V2 Brief, confirmation and Draft hash/byte oracles, V3 round trips, malformed source metadata, source bindings, checksum tampering and cross-version rejection. The observation tests separately pin numeric quantiles, mixed units, partial bodies, duplicate identities, unknown formats and the two distinct denominators. Real model, browser, build and deployment acceptance remain owned by the encompassing plan.
