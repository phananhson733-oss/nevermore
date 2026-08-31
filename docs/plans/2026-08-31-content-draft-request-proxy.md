# Content Draft Request Proxy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore authenticated Draft run/section requests on Next 16 and Node 24 without changing any brief contract, byte limit, model configuration or authorization boundary.

**Architecture:** The shared Draft admission path counts raw bytes through a TransformStream. Next's app-route request proxy cannot be used as native Request constructor input because Node's internal private state is not present on the proxy. Construct the counting Request from the original URL and explicit method, headers, signal and counted body instead. Keep the original request for client-IP/header decisions and keep all existing gates.

**Tech Stack:** Next.js 16.2.11, Node 24.12+, TypeScript, Vitest, existing Marketing-only Vercel release workflow.

---

## Approved scope and alternatives

The user authorized code changes, PR creation/merge, Marketing production release and combined canary; on this continuation they explicitly waived the external ChatGPT Pro workflow in favor of Codex plus native independent review. No external source upload is authorized or performed. Railway, Product, database, provider/model parameters, unrelated tools and CMS publishing remain outside the mutation boundary.

Prefer the URL-based Request construction because it preserves the current stream counter with a surgical change. Changing route caching/dynamic behavior would couple admission correctness to a framework setting. Changing the shared JSON reader's return contract would expand the patch to unrelated tools. Neither alternative is needed.

Baseline: clean `75fd5d9d2a7cda32f04cfdae44f663cb0fa6ff6b`; production Marketing `dpl_HAk2Deq6bJdsFGBCZfqGEdfSBWgN`. The real confirmed Brief passed its parser and offline generator/assembler. Production Draft returned 503 with sanitized `TypeError`. A Next-matching Request proxy locally reproduces Node's private-state TypeError before model work, while URL-based reconstruction succeeds.

## Task 1: Red regression

**Files:** `apps/marketing/src/lib/tools/content-draft-handler.test.ts`.

1. Add a NextRequest proxy helper matching Next's property receiver and function binding behavior.
2. Cover authenticated full-run and section-rerun with real `readPublicToolJson`, existing offline generation seams and independent result parser assertions.
3. Cover original request URL/method/content-type/abort-signal preservation and raw-whitespace byte ceilings for the proxy path.
4. Run `pnpm exec vitest run --project unit apps/marketing/src/lib/tools/content-draft-handler.test.ts` and verify the new successful-run assertions fail with 503 before the fix.

## Task 2: Green surgical fix

**Files:** `apps/marketing/src/lib/tools/content-draft-handler.ts`, `apps/marketing/src/lib/tools/_DIR.md`.

1. Replace `new Request(request, ...)` with `new Request(request.url, { method: request.method, headers: request.headers, signal: request.signal, body: countedBody, duplex: "half" })`.
2. Explain the Next proxy / native Request private-state boundary in the local comment; update the file header and directory index.
3. Re-run the failing tests plus Draft v2 run/model/parser and shared request-reader suites. Preserve all existing byte/auth/lineage tests.

## Task 3: Verification and independent review

1. Run Marketing/public-tools typechecks, changed-file lint, secret/redaction checks, related units and a fresh Marketing build.
2. Run the existing isolated Brief/Draft/GEO browser regression harness on the new build. Fixtures are not production-provider proof.
3. Obtain native read-only diff review; fix actionable regressions and repeat affected gates. Record known pre-existing blog-count and authority-lock failures separately without rebaselining.

## Task 4: Marketing release and real canary

1. Commit only scoped source/tests/docs, create PR, inspect CI and merge only the reviewed SHA.
2. Verify exact Marketing merge SHA, READY state and canonical aliases; independently retain Product's prior canonical deployment.
3. Reuse the already confirmed production Brief without a new SERP/GSC generation; execute full Draft, one section rerun, JSON/Markdown export and explicit-URL On-Page popup. Never publish content or auto-run an On-Page audit.
4. Report provider receipts, semantic/evidence limitations and every unverified browser capability separately. Do not claim full acceptance if a stage fails.
