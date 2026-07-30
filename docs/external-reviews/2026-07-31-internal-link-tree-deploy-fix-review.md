# ChatGPT Pro review and correction record

Date: 2026-07-31 (Asia/Shanghai)

Conversation:
`https://chatgpt.com/c/6a6b4faf-dfe8-83e8-852c-6747be965e1e`

## First review package

- Baseline: `4860f3e4217255b7e72b0c0d4c2d1ad01edf3121`
- Size: 152692 bytes
- SHA-256:
  `42834ad204419a9668aaaa6efbb577a578316b6f28153dcf345f2f37a737b661`
- Files: 25
- Archive validation by ChatGPT Pro: size, digest, and member count matched.
- Static TypeScript parsing by ChatGPT Pro: zero syntax errors.

## First verdict

ChatGPT Pro returned `FAIL` with three blocking findings:

1. Search and kind filters forced matching branches open while branch and global
   expand/collapse buttons remained enabled. Activating those controls changed
   hidden state but produced no immediate visual response.
2. Every recursive list level added mobile and desktop indentation. A
   constructed 24-level URL path produced internal horizontal overflow and left
   the deepest row almost unreadable on a 390-pixel viewport.
3. The consent route handled returned PostgREST errors but not thrown client or
   query exceptions. It also destructured non-object JSON and assumed every
   category was a non-null object.

The review also identified non-blocking precision issues:

- the `Depth` header represented crawl depth rather than visual tree depth;
- copy for branches outside the main hierarchy incorrectly described all
  descendants as having no inbound links;
- desktop metric headers did not include the row's horizontal padding;
- additional-inbound display depended on aggregate counts whose projected edge
  could be truncated;
- deep paths, forced expansion, and thrown persistence failures lacked focused
  regression coverage.

## Corrections applied by Codex

- Disabled per-branch and global expand/collapse controls whenever a search or
  kind filter temporarily forces ancestors open. Disabled styling and native
  button semantics make the temporary state explicit.
- Capped visual indentation at five levels while preserving the nested list
  semantics. Deeper rows use an `…/segment` visual prefix and retain the full
  path in their accessible name and title.
- Added a 25-node/24-level mobile Playwright fixture. It asserts that the
  deepest selectable row remains at least 160 pixels wide and that neither the
  tree scroller nor the document overflows horizontally.
- Validated the consent JSON object, category entries, visitor ID, and policy
  version before persistence. Client creation, IP hashing, and query execution
  now share a sanitized exception boundary.
- Added route tests for null JSON, null categories, thrown client creation,
  thrown queries, missing configuration, missing table, returned database
  errors, and successful inserts.
- Renamed the column to `Crawl depth` / `抓取深度`, corrected outside-branch
  copy, and aligned desktop headers with row padding.
- Derived the secondary badge only from other edges actually present in the
  bounded public projection. Aggregate inbound totals remain visible in their
  dedicated column.

## Independent Codex verification after corrections

- Marketing unit scope: 4 files, 25 tests passed.
- Marketing typecheck: passed.
- Marketing lint: passed.
- Marketing production build: passed.
- Internal-link Playwright suite: 3 tests passed, including the 24-level
  390-pixel mobile case.

The final corrected package was sent back to the same ChatGPT Pro conversation
for a second review before release.

## Final corrected package

- Reviewed baseline: `d26c2a4ff10efd0fda1f380117847374cec2edb3`
- Size: 180210 bytes
- SHA-256:
  `723e26e6a7c427fb93a42df652dbb314f9664b3c9385e503ea4d1bca6ad7a652`
- Files: 44
- Archive validation by ChatGPT Pro: size, digest, member count, ZIP integrity,
  and absence of path traversal all matched.

## Final ChatGPT Pro verdict

ChatGPT Pro returned `PASS WITH NON-BLOCKING ISSUES`.

It independently reported:

- all prior P1 findings closed and no new P0/P1 regression;
- 28 TypeScript/TSX files parsed with zero syntax errors;
- 38 tree-model assertions and 11 consent scenarios passed;
- the 390-pixel, 24-level rendering remained readable without tree or document
  horizontal overflow;
- search/filter expand controls were correctly disabled;
- thrown persistence failures returned sanitized errors;
- URL-path and observed-link relationships, projected secondary-inbound counts,
  copy, and desktop column alignment matched the final task.

The reviewer retained four non-blocking observations:

1. Clearing search removes the clear button and can drop keyboard focus.
2. Treating an `inboundLinks=0` path page as a tree root is semantically
   appropriate for an orphan, but differs from a purely lexical URL-path tree.
3. Legacy content-schema property names such as `demoBanner`, `mockScope`, and
   `fixedData` remain even though their visible content and runtime behavior are
   no longer mock.
4. Consent telemetry remains deliberately fire-and-forget, so users do not see
   persistence failure feedback.

ChatGPT Pro did not claim or perform Git, Vercel production, database, or
live-user verification. Those remain Codex release responsibilities.

## Release integration

Before committing, Codex fetched the remote again and rebased the uncommitted
marketing-only change onto `f5d5ad6acb441a815ed26326c75e706ee6bbab0d`.
The nine intervening commits changed `apps/web`, `apps/worker`, shared product
profile code, specifications, and root E2E configuration; none changed this
review's `apps/marketing` implementation files. Codex then repeated the
marketing unit, lint, typecheck, production build, focused browser E2E,
secret-scan, deploy-config, and full repository unit gates on the updated
baseline.
