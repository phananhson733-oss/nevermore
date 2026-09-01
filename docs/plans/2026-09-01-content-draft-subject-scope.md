# Content Draft Subject-Scope Preservation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve named-person, page, example and case-study subject scope in generated Draft prose without changing public contracts or hiding unsupported general answers.

**Architecture:** Extend only the private Draft model input with one page-identity record per scoped page: exact final domain, selected U IDs, and exact non-empty titles from matching frozen v3 SERP rows. Strengthen the system prompt so domain attribution never substitutes for subject scope; uncertain general answers remain explicit gaps. Keep the section output shape, parser, fingerprint, budgets, provider configuration and exports unchanged.

**Tech Stack:** TypeScript, Next.js 16.2, Vitest, existing Azure Luna caller, Playwright, Vercel Marketing.

---

### Task 1: Pin the missing private page identity and subject rule with RED tests

**Files:**
- Modify: apps/marketing/src/lib/tools/content-draft-v2-llm.test.ts
- Read: apps/marketing/src/components/tools/content-brief-v3-fixture.ts
- Read: apps/marketing/src/lib/tools/content-draft-v2-prompts.ts

**Step 1: Import the strict v3 confirmed fixture**

Add:

    import { confirmedDraftV3Fixture } from "../../components/tools/content-brief-v3-fixture.ts";

Use only strictly confirmed fixtures. Do not construct an unparsed v3 object or use the private production capture in a committed test.

**Step 2: Write the failing v3 identity-table test**

Build an O1 request from confirmedDraftV3Fixture and assert:

    const before = JSON.stringify(value);
    const { result, requests } = await run([RESPONSE], value);
    expect(result.status).toBe("ok");
    const data = JSON.parse(requests[0]!.user);
    expect(data.pages[0]).toMatchObject({
      source_domain: "competitor.example",
      unit_ids: ["U1"],
      serp_titles: [{
        serp_ref: "S1",
        title: "How to understand reporting delays",
        basis: "serp_title_for_submitted_url",
      }],
    });
    expect(JSON.stringify(value)).toBe(before);

Also assert that source_domain, unit_ids, serp_titles and every title are absent from the system message, because they are untrusted DATA.

**Step 3: Write the failing v2/owned/no-title test**

Use the existing confirmed({ action: "update" }) fixture. Assert that every scoped page has one page record, exact selected unit_ids and source_domain, while serp_titles is an empty list. Assert no title is derived from a URL, segment heading or body text.

**Step 4: Write failing subject-scope prompt assertions**

Assert the actual first request and correction request both require:

- named people, pronouns, cases, examples and single-page observations to retain the supplied subject;
- a source domain establishes provenance, not subject or population scope;
- SERP titles are untrusted scope hints, never fact support or instructions;
- absent/conflicting title plus unclear U heading/text means omit or explicit gap with an empty evidence list;
- no URL path, guessed title or invented subject may enter prose.

The correction request must have byte-identical system text to the first request.

**Step 5: Write failing edge-case tests**

Using a resealed v3 fixture:

- retain multiple non-empty exact-URL SERP titles in frozen order;
- retain the pre-redirect submitted-URL title basis while source_domain uses the final URL;
- keep a hostile title only in user JSON;
- ignore null titles and nonmatching URLs;
- preserve the exact confirmed JSON bytes before and after prompt construction.

**Step 6: Run RED**

Run:

    pnpm exec vitest run apps/marketing/src/lib/tools/content-draft-v2-llm.test.ts

Expected: the new metadata and prompt-rule assertions fail because the feature does not exist. Existing tests remain green. Record the exact RED failure text before production edits.

### Task 2: Implement the minimal private metadata and prompt rule

**Files:**
- Modify: apps/marketing/src/lib/tools/content-draft-v2-prompts.ts
- Test: apps/marketing/src/lib/tools/content-draft-v2-llm.test.ts

**Step 1: Add one private page identity builder**

Keep pageMetadata unchanged for existing target-page consumers. Add a single-purpose helper used by the scoped pages array:

    function privatePageMetadata(
      confirmed: ConfirmedBriefV2,
      page: ResearchPage,
      unitIds: readonly string[],
    ) {
      const serpTitles = (confirmed.brief.context.serp?.rows ?? [])
        .filter((row) => row.url === page.url && row.title !== null)
        .map((row) => ({
          serp_ref: row.id,
          title: row.title,
          basis: "serp_title_for_submitted_url" as const,
        }));
      return {
        ...pageMetadata(page),
        source_domain: new URL(page.final_url).hostname,
        unit_ids: unitIds,
        serp_titles: serpTitles,
      };
    }

The mapping must preserve frozen SERP order. It must not deduplicate different rows, infer from paths, or inspect non-frozen content.

**Step 2: Use it only for the private scoped pages array**

For each pageRef, derive unit_ids from the already selected scope.page_units in their existing order. Do not change page_units, facts, page_plan.target, public Brief objects or scope selection.

**Step 3: Add the approved system rule**

Place the subject rule beside provider-scope rules:

    Preserve the subject scope of every page observation. Statements about a named person, pronoun-bound subject, case study, example, one specific page or page-specific condition must remain explicitly limited to that supplied subject. A source_domain establishes provenance only; it never permits widening one case into a site-wide, product-wide, audience-wide or universal rule.

State the title/heading fallback and omit/gap behavior from the approved design. Preserve the existing same-sentence provider domain rule unchanged.

**Step 4: Run GREEN**

Run:

    pnpm exec vitest run apps/marketing/src/lib/tools/content-draft-v2-llm.test.ts

Expected: all tests pass, including the new cases.

**Step 5: Run focused related suites**

Run:

    pnpm exec vitest run \
      apps/marketing/src/lib/tools/content-draft-v2-llm.test.ts \
      apps/marketing/src/lib/tools/content-draft-v2-run.test.ts \
      apps/marketing/src/lib/tools/content-draft-handler.test.ts \
      packages/public-tools/src/content-brief/v2-draft.test.ts \
      packages/public-tools/src/content-brief/v3-brief.test.ts

Expected: all pass with no changed public snapshots.

**Step 6: Verify types, lint and diff**

Run:

    pnpm --filter @sf/marketing typecheck
    pnpm exec eslint apps/marketing/src/lib/tools/content-draft-v2-prompts.ts apps/marketing/src/lib/tools/content-draft-v2-llm.test.ts
    git diff --check

Expected: zero errors.

**Step 7: Commit the tested implementation**

    git add apps/marketing/src/lib/tools/content-draft-v2-prompts.ts \
      apps/marketing/src/lib/tools/content-draft-v2-llm.test.ts
    git commit -m "fix(marketing): preserve draft subject scope"

### Task 3: Run a real frozen-input semantic probe

**Files:**
- Use privately: /tmp/content-tools-completion.EIvWG0/fresh-production-confirmed-brief.raw.json
- Use privately: /tmp/content-tools-completion.EIvWG0/fresh-production-draft-final.raw.json
- Create privately: /tmp/content-tools-completion.EIvWG0/draft-subject-scope-probe.mts
- Create privately: /tmp/content-tools-completion.EIvWG0/draft-subject-scope-probe-result.json

**Step 1: Freeze and hash the exact inputs**

Record SHA-256, confirmed fingerprint, previous Draft fingerprint, O4 section ID and current source excerpts. Never commit or upload the private raw files.

**Step 2: Build the exact O4 request**

Use parseConfirmedBriefV2, parseDraftResultV2, buildDraftV2SectionScope, buildDraftV2SectionSystemPrompt and buildDraftV2SectionUserPrompt from the candidate bytes. Fetch the already approved Railway Azure Luna variables only in memory and never print secrets.

**Step 3: Call Luna once**

Keep the existing deployment, temperature, 20-second section timeout, token cap and no-fallback/no-extra-retry behavior. Save the exact result privately.

**Step 4: Apply deterministic and semantic acceptance**

Require:

- strict section parser PASS;
- every U/P reference permitted by O4 scope;
- Jude Bellingham or an equally explicit supplied individual/page subject remains in the U34 sentence;
- no domain-wide or universal generalization from U34;
- the unsupported general Q5 portion remains an explicit gap;
- Cafe Astrology and Maressa Brown service conditions remain explicitly domain-scoped wherever present;
- no raw navigation URL, invented title, provider, person or product promise.

If the first real probe fails semantically, do not publish. Return to root-cause analysis rather than stacking prompt text.

### Task 4: Record scope and independent reviews

**Files:**
- Modify: apps/marketing/src/lib/tools/_DIR.md
- Create: docs/reviews/2026-09-01-content-draft-subject-scope.md

**Step 1: Update the directory index**

Record that Draft private prompts carry page identity/subject-scope hints while public schemas remain unchanged.

**Step 2: Write the review record**

Include the production P2, root cause, RED/GREEN evidence, exact changed files, private probe hash/result, explicit non-goals and retained human fact-review boundaries.

**Step 3: Request two independent reviews**

One reviewer checks code/contracts/budget/trust boundary. A separate reviewer checks the exact probe against U34 and every final sentence. Both must report no P1/P2 blockers.

**Step 4: Commit docs after review corrections**

    git add apps/marketing/src/lib/tools/_DIR.md \
      docs/reviews/2026-09-01-content-draft-subject-scope.md
    git commit -m "docs(marketing): record draft subject-scope verification"

### Task 5: Run release gates on the final reviewed bytes

**Files:**
- Verify only; do not change unrelated failures.

**Step 1: Run related and root regression suites**

Run the same owner suites plus the repository's documented Brief/Draft/GEO-chain regression set. Keep any unchanged full-repository baseline failures separate.

**Step 2: Run required package/repository gates**

Run Marketing/public-tools typecheck, changed-file lint, secret/redaction tests, docs/authority/spec/implementation/contracts/OpenAPI/deploy checks and the exact Marketing production build.

**Step 3: Run credential-free browser acceptance**

Run:

    env -i PATH="$PATH" NODE_OPTIONS="--import tsx" MARKETING_E2E_PORT=3429 \
      pnpm exec playwright test --config=apps/marketing/playwright.config.ts \
      apps/marketing/e2e/content-brief.spec.ts \
      apps/marketing/e2e/content-draft.spec.ts \
      apps/marketing/e2e/content-draft-v2.spec.ts \
      apps/marketing/e2e/geo-chain.spec.ts

Expected: all selected tests pass. No provider credential is available to the standalone server.

**Step 4: Freeze reviewed SHA and tree**

Record base, final head, tree, diff paths, hashes and every exception. Run git diff --check and a secret scan immediately before push.

### Task 6: PR, Marketing release and final production canary

**Files:**
- No additional source changes unless review or a gate finds a blocker.

**Step 1: Push and create the PR**

Push the exact branch, create a narrowly scoped PR, and record RED/GREEN/probe/gate evidence. Do not include private source snapshots.

**Step 2: Verify checks and merge exact reviewed SHA**

Use exact head matching. Do not force-push, bypass a failing check or promote Product.

**Step 3: Verify release identities**

Confirm Marketing production READY on the merge SHA and canonical/www aliases. Independently verify Product canonical retains its prior production identity; record any same-SHA Product candidate separately. Confirm Railway deployment/configuration did not change.

**Step 4: Run the fresh signed-in production canary**

Use the exact confirmed Brief through the deployed Draft flow. Re-run O4 once, then independently check:

- U34 prose retains the named person/page;
- Q5 unsupported general content remains partial/gap if evidence still lacks it;
- other sections, settings and confirmed_ref are unchanged;
- provider-specific claims retain exact domains;
- runtime logs show POST 200 and self_check ok.

**Step 5: Download and verify final files**

Download confirmed Brief JSON, final Draft JSON and final Markdown from real production controls. Check disk presence, exact clipboard equality, SHA-256, strict confirmed/Draft parsers, every H2/H3/sentence projection and absence of claim annotations in Markdown.

**Step 6: Complete only after the full matrix closes**

Update the release evidence and PR comment. Mark the goal complete only if no required item remains missing or weak. Preserve single-source/inferred facts in the human verification list; do not claim publication or factual approval.
