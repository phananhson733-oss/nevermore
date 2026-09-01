# Marketing GEO boundaries

Website Profile owns product facts. GEO owns matching overrides, frozen questions and measured evidence. Historical v1 payloads remain readable; new source-conditioned freezes are additive. This directory does not authorize provider calls, production migrations or deployment.

- `asset-context.ts` — browser-safe inherited Profile view, provenance subset and supported question-language predicate.
- `snapshot-context.ts` — source-conditioned immutable context; only exact matching server receipts grant crawl/GSC provenance, and missing GSC skips problem/evaluation.
- `asset-context-store.ts` — owner-scoped immutable context/receipt reads, digest validation and service-only receipt RPC writes; missing required context is unavailable, not legacy null.
- `kb-contract.ts` — bounded canonical KB payloads, optional competitor aliases preserving legacy bytes and source-aware freeze blockers.
- `kb-handler.ts` — authenticated same-origin HTTP contracts, draft CAS, expected Profile reference and exact context-hash admission.
- `kb-handler-deps.ts` — runtime Website/KB/context integration; new source state does not silently replace what the editor saw.
- `kb-store.ts` — immutable v1 payload parsing/storage and exact current/revision/snapshot-ID reads.
- `kb-freeze-context.ts` — new atomic snapshot/context path; verifies current draft and maps Profile drift or missing canonical Website to actionable refusal.
- `kb-history.ts` — bounded paginated owned frozen-version history for both selectors; unreadable or over-budget history never becomes an empty or silently truncated list.
- `kb-profile-copy.ts`, `kb-profile-copy-server.ts` — complete immutable Website Profile copy, bounded JSONB size and server-verified source/hash identity; old partial payloads remain separate.
- `kb-profile-suggestions.ts` — explicit opt-in proposals for supported GEO fields and a user-selected competitor subset; complete source retention is not automatic measurement adoption.
- `kb-question-language.ts` — deterministic English placeholder readiness for new freezes; no translation or rewriting of historical questions.
- `kb-question-placeholders.ts` — unchanged category wording shared by generation and registry-bound input admission; overlong proposals require explicit correction instead of silent template loss.
- `visibility-context.ts`, `visibility-context-handler.ts` — private all-website preparation state and exact selected frozen input, with current Profile kept separate and strict identity/count/budget checks.
- `visibility-history-contract.ts`, `visibility-history.ts` — bounded account-owned V1 summary and V2 recorded-report history; reopening only reads persisted evidence and never starts paid work.
- `kb-enrichment-contract.ts` — strict bounded, hash-bound source receipts and explicit unavailable reasons.
- `kb-enrichment.ts` — actual homepage identity/fact extraction and deterministic query-interest clusters; no inferred persona or typed URL is a crawl receipt.
- `kb-enrichment-handler.ts` — verified Google-subject equality, exact 90-final-day GSC scope, source gates and persistent receipt admission.
- `kb-enrichment-deps.ts` — real safe public fetch and granted GSC adapters; no automatic source read from an editor render.
- `visibility-v2-contract.ts` — multi-engine observations and explicit nullable evidence; v1 remains separate.
- `visibility-v2.ts` — grouped engine/pooled measurements, actual question coverage, conditional-answer SOV and observed list position.
- `visibility-sampling-v2.ts` — exactly one paid request per stable engine/question/sample slot; no ambiguous network retry.
- `visibility-sov.ts` — conservative question-cluster ratio bounds and paired SOV comparison; replicas do not increase the independent-question count.
- `visibility-export.ts` — strict recomputation and untrusted local imports; JSON/Markdown reflect actual recorded fields.
- `visibility-wire.ts` — compact bounded wire representation retaining sample identities once, with explicit evidence omission counters.
- `visibility-store-v2.ts` — private append-only V2 report persistence, stable run UUID dedupe and exact owner-scoped reads.
- `site-index.ts` — bounded actual own-site/reference/T2 evidence, completeness and feature-priority hints; absent evidence is not absent content.
- `gap-classify.ts` — deterministic evidence-conditioned B/A/D/C precedence, with unsupported cases unattributed rather than causal assertions.
- `owned-gap.ts` — recomputed server-owned A/D evidence bridge; imported files and C/B actions cannot start a content generation.
- `gap-handoff.ts` — scoped one-use browser pointers; B selects the explicit GEO-gap T2 protocol, A/D selects shared Brief.
- `brief-shared.ts` — deterministic v1.1 GEO origin, frozen Q1/requirements, fact table, actual sample topics, honest unavailable fields and site-index links.
- `brief-shared-handler.ts` — versioned exact selection and source resolution before quota/model work; manual input has no observed run evidence.
- `brief-shared-deps.ts` — actual frozen/context/run/gap resolver and shared outline model adapter.
- `brief-reference.ts` — shared Draft's server verification; rebuilds immutable evidence from owned records rather than trusting a client fingerprint.
- `citability-handler.ts` — anonymous safe URL plus optional question, no model call, actual raw/render adapter and deterministic rule report.
- `citability-render.ts` — authenticated isolated-service adapter, raw hash/URL binding, strict capture validation and nullable ratio.
- `citability-render-rule.ts` — actual two-sided SSR text measurement, with partial/empty captures excluded from passing conclusions.
- `citability-causes.ts` — deterministic groups of shared evidence/possible dependencies while retaining every original check and fix.
- `citability-conclusion.ts` — measured issues versus heuristic review, independent coverage and traceable priorities; not a citation probability or factual verification.
- `citability-ai-contract.ts` — strict bounded semantic-review receipts, excerpt references and fixed no-search/no-fact-verification scope.
- `citability-ai-evidence.ts` — server-owned raw hash, exact input fingerprint and bounded disjoint excerpts with explicit coverage.
- `citability-ai-provider.ts` — single bounded DataForSEO call, model identity validation, observed cost/task provenance and unknown-outcome errors without retries.
- `citability-ai-handler.ts` — explicit authenticated same-origin review, safe refetch/hash binding and durable per-user/IP/snapshot admission before spending.
- `site-index-validate.ts` — exact historical unversioned rule identities remain readable; new T2 evidence explicitly marks the corrected v2 heuristic inventory.

The isolated Chromium service and enforced Linux runtime live in `apps/marketing/scripts/citability-renderer*`, not in the Next bundle. Local SQL and mocked-provider/browser evidence are documented separately from production evidence in the alignment review directory.
