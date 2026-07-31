# Internal-Link Audit No-Normal-Quota Review

## Scope and provenance

- Repository: `phananhson733-oss/nevermore`
- External-review baseline:
  `c89374ce1ab0c6ba12eecd587ef5dd9b4784e6d4`
- Final integration baseline:
  `7b315f63091cfc15062d6d9d342e54e3ce8b485c`
- Customer scope: `gengrowth.ai` marketing site and its internal-link audit
- Explicitly out of scope: `app.gengrowth.ai`, worker, database, migrations,
  Supabase configuration, Vercel configuration, and real user data
- External review conversation:
  `https://chatgpt.com/c/6a6c26de-31a4-83e8-b812-5f847dd718e1e`
- Baseline package SHA-256:
  `f9bc1575e7c99882bea0e780406ec1749229b2ab6ad4311b494034ec7fafb1cc`
- Candidate package SHA-256:
  `1d4acbcd29bbe1ea3d882afac81701887374f62ef950e0da29858cb4abe377b4`

The candidate archive is the exact pre-integration implementation reviewed by
ChatGPT Pro. While that review was in progress, `origin/main` gained the
independent `7b315f6` public-crawl hardening commit. Codex therefore rebased
and independently re-verified a final integration that keeps that newer
security design. The external reviewer did not claim to review the later
integrated archive.

## External review

ChatGPT Pro first reviewed the immutable baseline and returned `FAIL`. Its
blocking findings were:

1. the two-scans-per-ten-minutes normal-use quota remained;
2. rate accounting ran before the one-in-flight gate;
3. success responses exposed `X-RateLimit-Remaining`;
4. internal-link and SEO audits shared the fixed 25-page crawl profile;
5. the result still sliced pages and exposed `maxPages`;
6. the schema remained `internal_link_audit.v1`;
7. the UI still advertised 25 pages, depth four, and public-preview wording;
8. partial-coverage copy still described the fixed page allowance.

The baseline review could not execute repository tests because the external
environment had Node 22, no pnpm installation, no dependency tree, and no
registry access. Its findings were therefore treated as static review evidence,
not as executed verification.

The 14-file candidate package was then sent to the same conversation for a
second, targeted review against every baseline finding and the retained crawl
security boundaries. Pro initially returned `PASS WITH NON-BLOCKING ISSUES`,
but its remaining findings were conditional inferences contradicted by the
candidate source:

- it inferred a missing `finally`, although the handler releases the slot in a
  `finally` covering every post-acquisition path;
- it inferred duplicate scans might consume the fuse, although the duplicate
  return precedes rate accounting and a regression test asserts the call
  count;
- it inferred an imprecise full-window `Retry-After`, although the shared
  limiter calculates the exact remaining fixed-window seconds;
- it inferred `max_urls` would be exposed as a customer page allowance,
  although the value is an internal queue guard and the UI maps it to a
  localized generic collection boundary;
- it inferred budget overrides remained caller-tunable, although the fixed
  budget and request cap are applied after the test-seam spread and the HTTP
  handler accepts no crawl options.

Codex returned those exact source and test facts to the same conversation.
Pro withdrew every P0/P1 concern and issued a final `PASS`, confirming that the
candidate satisfies the product contract and retains the crawl security
boundaries. It left only two optional P2 suggestions: a domain-level internal
stop-reason abstraction and a narrower type surface for the offline engine
test seam. Neither affects the HTTP surface, correctness, safety, or current
customer behavior.

## Codex implementation and independent decisions

- The normal two-scan quota and all remaining-quota headers were removed.
- The shared public-crawl one-in-flight slot is acquired before the high abuse
  fuse, so an overlapping crawl from the same IP does not consume fuse
  capacity. A duplicate returns `409 scan_in_progress`.
- A 30-request/10-minute/IP/isolate fixed-window fuse remains as exceptional
  anonymous-abuse protection. Fixed-window behavior is acceptable for this
  defense-in-depth requirement; the product does not claim that it is a normal
  usage allowance.
- The final integration uses the newer shared, guarded synchronous public-tool
  crawler introduced on `origin/main`. It resolves a submitted entry through
  same-host or apex/`www` canonical redirects without allowing HTTPS
  downgrades, then retains SSRF/private-network, manual redirect, same-origin,
  robots, response-size, aggregate-byte, request-count, wall-clock,
  concurrency, and host-pacing controls.
- Its current server safety profile is 2,000 queued URLs, depth six, 240
  seconds, 4,500 transport requests including redirect hops, 2 MiB per body,
  128 MiB aggregate decoded bytes, five redirects, concurrency five, and 250 ms
  host pacing. These are server execution boundaries, not customer quotas.
- The internal-link result no longer slices the collected pages against a
  product allowance. It reports the pages actually returned by the guarded
  crawl. `maxPages` was removed and the schema is
  `internal_link_audit.v2`.
- The result shows the actual collected page count. Partial results show a
  localized resource stop reason and state that the evidence is not complete
  site coverage.
- Customer-visible 25-page, depth-four, `/25`, and public-preview quota copy
  was removed from the tool and its internal-link methodology content.
- Exceptional `rate_limited` responses display a localized valid
  `Retry-After`; an ordinary overlapping scan continues to use the in-progress
  message.

The dedicated wrapper from the externally reviewed candidate was deliberately
removed during integration because it normalized the origin directly and would
have bypassed the newer canonical-entry validation in `7b315f6`. Reusing the
new guarded shared wrapper is the smaller and safer final design. The
`7b315f6` commit had already changed the separate SEO audit's shared crawl
profile before this branch was rebased; this final internal-link commit neither
reverts nor further changes that SEO behavior. No code change was taken solely
on Pro authority; its conditional findings and the later integration were
checked against actual source and independently executed tests.

## Independent verification

The pre-integration candidate passed the original gate set, but those results
were not reused as proof after the rebase. Codex ran the following commands
again on the final integration based on `5ad82cc`:

- `pnpm exec vitest run --project unit` with the internal-link handler/copy,
  shared public-crawl, and internal-link scan files: 4 files, 35 tests passed.
- `pnpm test`: 501 files, 6117 tests passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `pnpm contracts:check`: passed.
- `pnpm verify:docs`: 10 tests passed.
- `pnpm implementation:check`: passed.
- `pnpm deploy:check`: passed.
- `pnpm secrets:scan`: repository scan passed; 4 redaction-test files and
  75 tests passed.
- `pnpm --filter @sf/marketing build`: production build passed.
- `pnpm --filter @sf/marketing test:e2e -- internal-link-audit.spec.ts`:
  6 Playwright tests passed against the local production application. The
  relevant UI audit responses are intercepted fixtures, so this is
  UI/contract E2E coverage, not a live crawl or production verification.
- `git diff --check`: passed.

## Retained limitations

- Crawling reads same-origin static HTML and sitemap evidence; it does not
  execute client-side JavaScript or authenticate.
- Robots rules, the SSRF/private-network guard, redirect validation, response
  size, aggregate bytes, request count, wall-clock time, concurrency, and host
  pacing can all reduce coverage.
- The in-flight slot and abuse fuse are process/isolate-local, so they are
  best-effort defense-in-depth controls rather than a globally serialized
  distributed queue.
- A partial report is useful observed evidence, not proof of complete-site
  coverage or a definitive broken-link/orphan classification.

## Release record

The immutable commit, final candidate hash, marketing deployment, production
smoke results, and exact app deployment observation are recorded after release.
