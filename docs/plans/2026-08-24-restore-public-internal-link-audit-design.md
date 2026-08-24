# Restore Public Internal Link Audit Design

Date: 2026-08-24

Status: Owner-approved through the current conversation. This decision supersedes
the 2026-08-12 registration-gated redirect policy for
`/tools/internal-link-audit` only. It does not restore the retired public SEO
Audit and does not remove the `/agents/tech` compatibility route.

## Goal

Restore `/tools/internal-link-audit` as the no-login, standalone Internal Link
Audit, and replace the primary-navigation `Technical focus` card with a direct
Internal Link Audit destination.

## Product boundary

- `/tools/internal-link-audit` is again a canonical public tool in English and
  Chinese.
- The public tool uses the current `internal_link_audit.v3` scanner, result
  model, cache, concurrency gate, SSRF protection, and evidence boundaries.
- Public runs require no login. They may store temporary operational
  abuse-control/rate-limit state and completed crawl results in a shared cache,
  but they do not create an App project or write canonical product data.
- `/agents/tech` remains reachable as the technical-first compatibility view of
  the unified SEO Agent, but it is no longer promoted in the primary navigation.
- `/tools/seo-audit` remains registration-gated and redirected to `/agents/seo`.
- The unrelated Agent Search Console OAuth return path is outside this change.

## Architecture and data flow

The restored page renders the existing current `InternalLinkAuditTool` and
localized landing copy. The client posts to `POST /api/tools/internal-link-audit`.
That route delegates to the existing current `handleInternalLinkAuditRequest`,
which owns URL normalization, public crawl admission, cache behavior, timeouts,
error mapping, and the `internal_link_audit.v3` report. No older handler, scanner,
or result component is restored from Git history.

```text
/tools/internal-link-audit
  -> InternalLinkAuditTool
  -> POST /api/tools/internal-link-audit
  -> handleInternalLinkAuditRequest
  -> current v3 scanner/cache/gates
  -> dedicated depth distribution, findings, and page tree
```

## Route and discovery contract

- Remove `/tools/internal-link-audit` from the retired-route redirect table.
- Remove the explicit Next redirect for `/en/tools/internal-link-audit`.
  Genuine legacy `/en` requests are canonicalized once by next-intl/Proxy to
  `/tools/internal-link-audit`; an explicit Next rule also fires on next-intl's
  internal `/en` rewrite and creates a redirect loop.
- Restore the route-level page instead of calling `permanentRedirect()`.
- Add `internal-link-audit` to the canonical tools sitemap inventory.
- Keep `/agents/tech` cross-canonical to `/agents/seo` and absent from the
  sitemap.

## Navigation and copy

- The Tools hub card keeps the formal name `Internal Link Audit` / `内链审计`,
  describes the dedicated public result, and uses a run-tool CTA.
- The header mega menu replaces its `Technical focus` card with
  `Internal Link Audit` / `内链审计`, an explicit
  `/tools/internal-link-audit` href, and public-tool copy. The group title becomes
  `Website audits` / `网站审查` so it no longer labels a Tool as an Agent.
- The On-Page SEO Checker related item already named `Internal Link Audit` /
  `内链审计` changes its href from `/agents/tech` to the restored tool.
- Links explicitly labelled `Technical focus` elsewhere continue to target
  `/agents/tech`; this change does not silently reclassify all technical Agent
  guidance as an Internal Link Audit.

## Documentation authority

Update the active README and legacy English migration documentation so future
work does not reapply the superseded redirect. Preserve the historical design
and review records as historical evidence instead of rewriting them in place.

## Verification

Use test-first changes for:

1. the page rendering the standalone tool rather than redirecting;
2. the public API delegating to `handleInternalLinkAuditRequest`;
3. proxy/retired-route and `/en` redirect behavior;
4. sitemap inclusion;
5. Tools hub and On-Page related destinations;
6. mega-menu label, description, group title, and explicit tool href;
7. EN/ZH message parity;
8. browser behavior for the restored page, form, mocked report, and navigation.

Then run the focused unit suite, Marketing typecheck/lint/build, full unit suite,
and a mocked Playwright regression. Do not call the production crawl API or any
billable provider during verification.
