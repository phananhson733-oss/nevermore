# GEO Brief quality correction — approved execution plan

Goal: apply the prior quality audit recommendations and ship them, retaining current site styles and historical evidence readability.
Base: 977f0bc4. Worktree: geo-brief-quality-20260831. Native Codex/subagent review remains authorized; commit/deploy explicitly requested. No authority rewrite, production migration, silent old-snapshot rewrite or invented facts. Provider spending requires a bounded verification decision; do not automatically rerun user generation.

## Implementation and ownership

1. Question-quality worker: kb-questions, kb-contract, question-quality helper, KB freeze/wire/editor and tests. Check actual language-bearing terms while allowing explicit proper names; promote only question-relevant entities; new policy identity; old snapshots read unchanged. Persisted draft quality checked before freezing.
2. Readiness worker: shared parse-geo-brief and geo-readiness tests. New derive marks empty facts missing; strict reader accepts only exact historical empty-facts readiness in addition to corrected form, without rewriting bytes/fingerprint or relaxing unrelated invariants.
3. Result worker: brief-quality projection, results/style/tests and Markdown export. Readiness counts derive from fact/evidence arrays, not legacy gaps. Distinguish no outline, structure-only, partial/limited and evidence-present. Localize primary labels/reasons/source derivations; compact actual paragraph sizes; retain raw data in technical details and unchanged JSON.
4. Root: exact frozen/context fact integrity and summary read projection; input preflight display; bad-question refusal before quota/provider work; context mismatch refusal instead of fallback; real snapshot audit via allowed access; Draft intake/guard clarity; catalog integration; overall tests/review/release.

## Data and historical boundaries

- A source kb label describes source material, not proof that a generated opening template was separately confirmed. Present Q1 as system rule based on frozen question; other KB decision requirements and observed topics remain distinct.
- Outline section IDs remain structural writability for wire compatibility. Empty facts must not look evidence-complete; structure-only actions must say what they cannot write.
- A bare old Brief cannot safely classify non-Latin proper names. The server resolves question quality from its exact owned frozen payload and the UI receives that diagnosis. Old exports remain readable; new paid operations on defective frozen questions are refused with an actionable code.
- Context facts must match the frozen payload mapping. An empty context cannot silently erase facts, and an empty-array fallback cannot silently change source authority.
- Source preflight counts come from exact frozen/context/Profile refs. Missing provider/store data stays unavailable, never zero.
- Production Supabase connector currently exposes only retired projects and rejects access to pxgzmoypkyyutpcmqexa. Do not query retired databases or bypass permissions. Existing authenticated application readers can expose the required bounded lineage counts after the fix; no raw profile/secret extraction.

## Validation

Tests first for every behavioral change: supplied mixed-language input, irrelevant entities, generic role, empty/null facts, precise source labels, no-run entry, exact historical fingerprint, context mismatch, and pre-quota refusal. Check shared Draft behavior, localized catalogs, production build and light/dark desktop/mobile UI. Run an explicit completion matrix; verify actual deployed source/alias, browser input, exact snapshot counts and zero-cost refusal/recovery paths. If a real generation test is needed, freeze its inputs and use the smallest authorized call. Keep local/offline evidence separate from production/provider evidence.

## Release

Current project scope includes apps/marketing and pure GEO logic in packages/public-tools, which Product does not import; verify that dependency and Product deployment identity rather than assuming non-impact. Preserve other worktrees. Merge only reviewed exact source, verify Marketing READY and canonical aliases, then audit production and report remaining real data/user-confirmation limits accurately.
