# GEO Brief Marketing release preflight

User authorization: commit and deploy this task. Scope: apps/marketing only; retain current website styles and Artifact information structure. Native Codex/subagent review was explicitly allowed earlier in the same task. No database migration, environment change, Product/Worker deployment or paid provider run is authorized or required.

Integration base: b35c359ffc3d07296aa07f06e1824c9b99846e3f. The Draft request-proxy fix (PR267) and Page Citability presentation fix (PR268) are retained. en/zh message edits merged in disjoint keys; no old catalog replaced current main.

Before release, Marketing gengrowth.ai resolves to dpl_8WYgJ6VT29qguNLPgc9sAPFm1Tyn at b35c359ffc3d07296aa07f06e1824c9b99846e3f. Product app.gengrowth.ai resolves independently to dpl_DzMBdEeuhxshcsqSt8UVttk75cc7 at de82f380bf2d531907bfad825dc4b755deced053. Team: team_DiJchcMOf6mt4u2ulO7Bq5XK. Marketing project: prj_HzRnuXaewqxu27P013fUwh6D2fWV. Product project: prj_US92arhXEoBqryGZrMeLvJVg8jnd.

Fresh gates: 64 files/876 related tests; 20 browser cases; Marketing production build and its TypeScript stage; changed-file ESLint (14 files); docs consistency; implementation consistency; deployment config; secret scan plus 75 redaction tests. All passed. Full browser results retain the documented Visibility-auth-fixture-only React418 exception; no Brief error is exempted. No real provider was called.

Known main-baseline failures, not introduced by this app patch:

- Full Marketing lint: unused pressEnter in competitor-keyword-gap-tool.test.tsx; unused OnPageCheck in on-page-check-list.tsx; unused PLACEHOLDER and no-control-regex in lib/agents/draft-handler.ts. All three files are byte-identical to origin/main.
- verify:spec: root package.json hash a74695ffc0e01f84abdb369177ef1e512a4a9540c20bd60ae4b91d80b517b064 differs from lock expectation 767220c889b6d323a09fad5dfdb3a9b5e89969d9154cabbc204521271e867ccc. package.json is byte-identical to origin/main. No authority/package/version files are changed to mask this existing mismatch.

GitHub Actions CI is workflow_dispatch-only; no automatic Actions run is claimed. Merge must bind the reviewed PR head, Marketing Vercel readiness, and Product Not affected evidence. Production verification will reload actual GEO Brief input, check site themes and auth boundaries without triggering generation, then inspect deployment identity and runtime logs. Any missing login is reported rather than presented as a successful authenticated run.
