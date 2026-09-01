# Content Draft subject-scope follow-up

## Status and scope

This is the candidate verification record for the subject-scope correction approved by the user on 2026-09-01. The reviewed production-code head is `fcbf33513f0acc7b48cd76e0dfca796ccd97862e` with tree `f7084cb8ee5c75ce53dc73f2052a3541fb72f564`. The initial tested patch was `881444e0`; its equivalent patch on the current base is `529a06ed`, followed by retry-contract pin `d6ff5044` and the real-probe correction `fcbf3351`.

This record contains no private source body, product-profile facts, provider endpoint or credential. It is candidate evidence, not proof that the correction is already deployed or that a generated article is factually approved.

## Production P2 and root cause

The signed-in production O4 result had a valid U34 reference but widened one named person's page observation into a site-level rule about unknown birth times. Naming the source domain established where the observation came from; it did not preserve whom that observation described. A ref-free general Q5 gap remained honest, but it did not repair the separate bound-sentence scope error. The already downloaded Draft JSON and Markdown containing this P2 are retained only as defect evidence and must not be treated as final deliverables.

The existing strict section parser correctly checked the closed shape, claim labels and allowed evidence references. It did not, and cannot, prove that natural-language prose retained the source subject or that a supported statement is true. The missing invariant therefore belonged in the private model context and writing rule, with an independent semantic review after parsing.

## Surgical correction and trust boundary

Only these production/test paths changed before this review record:

- `apps/marketing/src/lib/tools/content-draft-v2-prompts.ts`
- `apps/marketing/src/lib/tools/content-draft-v2-llm.test.ts`

Each private scoped-page record now binds the already selected unit IDs to the final observed hostname and to non-empty v3 SERP titles whose frozen submitted URL exactly matches that page. Titles remain untrusted scope hints in user JSON: they never enter the system message, never become factual support or instructions, and are checked against the corresponding unit heading/text. No title is inferred from a path or prose.

The prompt now requires a case-specific bound sentence to retain the actual supplied name or an equally unmistakable identifier. Anonymous stand-ins such as a generic person, page, case or example do not satisfy that rule. If the frozen evidence supplies no explicit subject, the model must omit the case-specific detail or emit an explicit ref-free gap. The initial request and validation-correction request use byte-identical system rules and identical page/unit metadata; only the existing rejection record changes. All new private metadata remains inside the existing 96 KiB exact prompt cap and fails closed before a model call if it does not fit.

No public Brief, confirmed-Brief or Draft schema, parser, fingerprint, handoff, presentation or export format changed. There is also no change to authentication, authorization, quota, database, model/deployment selection, temperature, token cap, deadline, retry count, Railway, Product canonical, CMS or publication behavior.

## TDD and quality evidence

The first RED run of `content-draft-v2-llm.test.ts` had 108 tests: all five new subject-identity assertions failed while 103 existing tests passed. After the private metadata and base subject rule were implemented, the owner suite passed 108/108 and the five related files passed 253/253. Marketing typecheck, ESLint on the two changed files, `git diff --check` and commit show checks passed.

The retry-contract supplement in `d6ff5044` pinned identical pages and page units across the first attempt and correction attempt. The owner suite again passed 108/108 and the related set passed 253/253.

The first real probe then exposed a semantic ambiguity that the structural tests did not cover. A new targeted RED test failed alone (107 existing tests passed) until the rule rejected anonymous subject placeholders and required the actual name or an unmistakable identifier. At `fcbf3351`, the owner suite passed 108/108, the related five files passed 253/253, and Marketing typecheck, two-file ESLint, diff and show checks passed. The final expanded matching regression passed 66 files / 1,972 tests.

Independent code/contract review, final-delta quality review and final semantic review each reported PASS with no P1/P2 blocker. The code reviews confirmed that exact submitted-URL title matching, redirect/final-domain separation, hostile-title containment, retry parity and byte-cap failure stay within the approved private-input boundary.

## Frozen-input real-provider probes

Both probes used the same exact confirmed Brief bytes (`45302519c84162cbc6b3858382a862b349bcedee03402e7c39afcb064293bdb8`) and previous Draft bytes (`b71545972a8902c83df9fb0e66ed3154c018c2985945265f4a37b2ee04becfe8`) for O4. Neither acquired new evidence or changed the frozen inputs.

### Probe 1 — semantic FAIL, not published

Candidate `d6ff5044` produced a strict-parser PASS in 17.295 seconds with one Luna call, zero retries, 3,187 input tokens and 1,245 output tokens. The saved result SHA-256 is `a830129d3a0364f8c266b7c11b5da6c133ffd0b134c5e314c8306382d9de54b0`; the raw response SHA-256 is `7bb06bdf6d7bdb4b94259033972f7551abf88d7b3c973259d65ecc84b286db8e`.

Independent semantic review marked it P2: the U34 bound sentence avoided a site-wide rule but used an anonymous subject with no in-sentence antecedent. This result localized the remaining problem to rule ambiguity. It was not released and is retained as negative evidence that parser acceptance does not prove semantic subject scope.

### Probe 2 — semantic PASS

Candidate `fcbf3351` completed in 14.646 seconds with one Luna call, zero retries, 3,273 input tokens and 996 output tokens. Strict section parsing passed. The saved result SHA-256 is `2b97126752994231f2f51b44d7c4ba704062111b3e91117f9c1dac730800d2ef`; the raw response SHA-256 is `d931b49e21e6f3f6fc9fc41abd25911587f510c39091479d52734ac4397f84a5`.

The exact three-sentence result was reviewed sentence by sentence without copying private prose into this repository:

- the U34 bound sentence retained the supplied named individual in the same sentence and did not widen the observation;
- the unsupported general Q5 portion remained an explicit gap with no evidence references;
- the U42 bound sentence retained its own source and subject scope.

All references were inside the frozen O4 scope; no anonymous placeholder, raw URL/path, guessed title, provider, person or product promise was invented. Independent semantic review therefore reported PASS with no P1/P2.

## Retained human-review and release boundary

The parser proves only closed structure, lineage and reference admissibility. The model's wording, semantic entailment, provider-specific conditions, single-source observations and any user-supplied or inferred product-profile facts still require human factual/semantic review. A verification list is not factual certification, and clean Markdown can remove annotations that otherwise reveal these limits.

Release closure still requires exact-head review and Marketing-only deployment, an independent Product-canonical identity check, a fresh signed-in production O4 rerun, runtime success evidence, and new on-disk confirmed JSON, Draft JSON and Markdown. Those fresh files must pass byte/hash, strict-parser and prose-projection checks. The earlier P2 downloads cannot satisfy that final gate.
