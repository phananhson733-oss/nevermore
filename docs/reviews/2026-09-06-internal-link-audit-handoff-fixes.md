# Internal Link Audit handoff review fixes

Scope: the Marketing URL ledger and its copied AI handoff. Base: `11e60521039903f89d6422c34232fe81c28f12f9`.

## Findings addressed

- Grouped findings carry a primary source/anchor sample, not a separate sample for every member URL. Previously the copied per-URL paragraphs repeated that sample without identifying its owner. Each paragraph now references its finding ID; a separate sample section lists the finding ID, primary node ID and URL, source URL, and anchor once. Unresolved source/target sets remain explicitly non-pairwise.
- The legacy hidden textarea selected during every copy stole keyboard focus. Copy now uses the Clipboard API directly. After a confirmed write, focus returns to the copy button if disabling it left focus on the document body. Focus on another control is preserved. Denied, unavailable, and timed-out writes reveal and select the readonly handoff.
- Copy status and the manual-copy field now sit between the result header and table. A long report no longer separates the copy control and fallback field by thousands of pixels.

## Regression evidence

- A five-page raw crawl passed through the real `buildInternalLinkAuditPayload` exposed a grouped low-inbound finding. Before the fix, `/article-b` inherited the primary `/hub-a` sample's source and anchor. The new test failed on that misattribution, then passed after sample ownership was retained.
- The browser copy-success test failed because the copy button was inactive after Enter; it now verifies focus after a delayed Clipboard write.
- The long mobile report test measured a 7,095 px gap between the button and manual-copy field before the fix; it requires the field within 200 px and the status in the viewport.

## Verification

- Marketing build, TypeScript and full Marketing ESLint passed.
- Full unit suite with four workers: 1,178 files, 18,855 tests passed.
- All 16 Internal Link Audit browser tests passed. The suite covers the two fixed defects, nearby mobile fallback, existing denial/timeout/stale-result handling, the 25-row fixture, dual-theme Axe checks, responsive widths, and route/API boundaries.
- Independent read-only review of the complete four-file code/test diff against the base SHA returned no findings.
- The repository secret scanner still detects the unchanged test JWT in `apps/marketing/src/components/agents/agent-issue-prompt.test.ts:495`. Running the same scanner rules over all four changed code/test files returned zero findings. No scanner rule or threshold was changed.

Production release identity and domain verification are recorded separately after deployment. Browser report fixtures verify UI behavior without issuing a production crawl.
