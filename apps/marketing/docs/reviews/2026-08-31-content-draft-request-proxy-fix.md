# Content Draft Next Request proxy correction

## Authority and baseline

The user authorized code changes, PR creation/merge, Marketing production deployment and the combined post-deploy canary. They explicitly waived the repository's external ChatGPT Pro workflow for this repair; review is native Codex review, not an external Pro delivery. No source package was uploaded and no credentials, provider configuration, Product, Railway, database or CMS change is included.

The starting source is `75fd5d9d2a7cda32f04cfdae44f663cb0fa6ff6b`, with Marketing production `dpl_HAk2Deq6bJdsFGBCZfqGEdfSBWgN`. After Railway-derived Luna parameters were synchronized, a real Brief succeeded and a real confirmed-v2 cross-tab handoff passed, but authenticated Draft run immediately returned 503 with sanitized `TypeError`.

## Reproduced root cause and minimal correction

Next 16.2.11's app-route machinery wraps NextRequest in a Proxy. Its ReflectAdapter reads getters with the target receiver and binds returned functions. Node 24's native `Request` constructor still requires private Request state on its input object, which a Proxy does not possess.

Draft uniquely rebuilt the streamed request to count raw wire bytes: `new Request(request, { body: countedBody, duplex: "half" })`. On the Next-matching proxy this throws `Cannot read private member #state from an object whose class did not declare it` before JSON parsing, quota or model generation. Both plain Request and unproxied NextRequest pass, explaining why the prior isolated tests missed the production boundary. The exact real Brief also passed offline model/assembly checks, so no parser relaxation or content repair is justified.

The fix constructs the counter request from `request.url` and copies method, headers, signal and counted body explicitly. All existing wire limits, authentication order, GEO owner verification, quota, model deadlines/configuration, result parsers and rerun lineage remain unchanged. No route dynamic/cache setting or shared reader contract is changed.

## Fresh verification

- Five new Next-proxy regressions first failed against the old handler with 503: complete v2 run, v2 section rerun, request metadata/abort propagation, and both GEO raw-whitespace ceilings. After the fix the handler suite passes 50/50.
- Focused handler, real bounded reader, v2 orchestrator and model boundary: 190/190 pass.
- Expanded Brief/Draft domain, model, handler and UI suites: 62 files / 1,766 tests pass with `--maxWorkers=1` after the build completed. The first simultaneous build/test run had three strict performance-budget failures and one async UI wait failure; no assertions or timing budgets were changed.
- Marketing/public-tools typechecks, changed-source ESLint and diff check pass. Marketing production build succeeds with 299 generated pages.
- Docs, active authority, implementation consistency, generated contracts, OpenAPI lint and deployment-config checks pass. Secret scan plus 75 redaction tests pass.
- `verify:spec` still reports the known root `package.json` hash drift: baseline/current `a74695ffc0e01f84abdb369177ef1e512a4a9540c20bd60ae4b91d80b517b064`, lock `767220c889b6d323a09fad5dfdb3a9b5e89969d9154cabbc204521271e867ccc`. Neither file changed in this repair; no authority rebaseline was performed. The full repository unit suite was not rerun for this narrow patch.
- Independent native read-only review found no blocking issue and separately passed 50 handler tests, 150 reader/v2 model/language/orchestrator tests, Marketing typecheck and production build. This is local review evidence, not live-provider proof.
- Fresh isolated browser regression passes 60/60 across Brief, SEO v1/v2 Draft and the shared GEO chain. The runner uses `env -i`, the documented `NODE_OPTIONS='--import tsx'`, dedicated port 3419 and the newly built standalone server; all provider/API responses remain offline fixtures.

Production acceptance is recorded separately after it actually completes. The existing signed-in confirmed Brief can be reused without buying another SERP/GSC run. A successful release must still demonstrate real Draft, one-section rerun and honest export/handoff behavior; it must not imply factual verification or publication of the model's content.
