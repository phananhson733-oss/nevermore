# Content Brief v2 production-canary correction

The initial Artifact-alignment release was PR #265 / `55b490ae1f8293f7852af97a83b69afe3d3fc4ab`, Marketing deployment `dpl_FSqZatF6ity2gyokHhpULieqVFBS`. Local 60-case browser acceptance was fixture-based and did not prove real provider completion.

The first real canary (`geo`, supporting `seo / growth`, US/en, existing GSC, no selected profile) returned no generated Brief after 19.46 seconds: source reads completed, then the model hit the old 15-second limit. Run `80c3f488-cd92-401f-a19f-06b2a85823c2` reported one attempt but zero calls because shared transport exceptions default to empty usage. The provider's actual token bill is unknown; the only known cost is DataForSEO USD 0.002. No Draft or section rerun was attempted from that unavailable result.

## Narrow correction

- Give only Brief v2 a maximum 30 seconds for its one model request, bounded by the same 45-second run deadline minus the 5-second envelope and 100ms receipt-settlement margin. Change both inner and outer watchdogs. Keep the legacy v1 limit at 15 seconds, existing 4,000 output-token limit, 48 KiB prompt limit, provider/model/env and no-retry policy.
- Count real attempted transport requests on timeout/network/HTTP/response errors, preserving unknown tokens as null. Configuration preflight and exhausted pre-call budget remain zero attempts/calls. This is V2-local; it does not alter the shared client behavior of unrelated tools.
- Reject the observed HTTP-200 Google reCAPTCHA interstitial as insufficient evidence before research admission. Require its browser-check title, Google challengepage base/canonical identity and actual CAPTCHA element. No CAPTCHA is executed or bypassed. Normal articles quoting the wording and embedding ordinary CAPTCHA remain readable. This is a narrow known-interstitial check, not a claim to classify every bot-protection provider.

## Reproduced verification

- Before repair, new deadline/accounting regressions failed against the real client factory with offline fetch seams. After repair, a 20-second successful completion passes the complete Brief parser; a 30-second abort reports attempts 1 / calls 1 / unknown tokens and also passes the parser.
- Outer uncooperative-runner watchdog is bounded at 30.1 seconds, or 40 seconds if 30 seconds was already used; provider abort with the latter remaining budget settles at 39.9 seconds, preserving all five seconds of envelope time.
- Legacy 15-second behavior is pinned. Focused model/run/legacy/shared-client suites: 203/203 PASS.
- The challenge-page regression failed for both competitor and owned roles before repair; crawl/extractor suites pass 115/115 afterward, including the ordinary-article counterexample.
- Root broad regression: 46 files / 1,296 tests PASS; Marketing build PASS (299 pages), Marketing/public-tools typechecks PASS, changed-source ESLint/diff check PASS, secret scan plus 75 redaction tests PASS.
- Fresh isolated browser regression: 60/60 PASS across Brief, both SEO Draft versions and the shared GEO chain. These offline results do not establish that the production timeout is resolved; the repaired live replay is a separate gate.

No secrets, private raw GSC data, source upload, environment modification, DB/Worker/CMS action or automatic retry is included in this patch.
