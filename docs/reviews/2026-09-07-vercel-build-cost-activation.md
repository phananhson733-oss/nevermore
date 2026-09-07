# Vercel build filtering activation checkpoint

The user explicitly waived external ChatGPT Pro collaboration and confirmed
continuation with native independent review. No external source upload occurred.

## Implementation and normal-build evidence

- PR: https://github.com/phananhson733-oss/nevermore/pull/314
- Reviewed implementation:824c8ba0ea7c4f728678dc511310fa37abd143fc.
- Main merge:4ba9416fc2a2ad8944480713a565ae66477803e8; application tree matches
  the reviewed implementation.
- Normal PR previews both reached READY:
  Marketing `dpl_EydY9nsJwUHxYEhWF484NYmw7uKa`,
  Product `dpl_Ahta48sMW6DBb5ZjLQx56p9T1JPU`.
- Each build log ran the configured Node guard before dependency installation.
  First-branch history was missing, so both continued building as designed.

## Main branch evidence

- Marketing's redundant main preview
  `dpl_7mwpiZTKGMhYz5MssnXc9Qp62Nw3` was CANCELED with
  `[vercel-build] skip: redundant Marketing main preview`.
  The log ended before dependency installation/Next compilation.
- Marketing production `dpl_3CjExUe4FpMMEWh5Gez3UCxP2wK4` reached READY on
  the merge SHA and holds gengrowth.ai/www.gengrowth.ai.
- Product candidate `dpl_FyLv17VcsXodKMoSvVjYs486nr8Y` reached READY on the
  merge SHA. Its automatic custom-domain assignment remains disabled; no
  authenticated-app promotion, Worker or database change was requested.
- The production builds continued because this change modifies build scripts
  and configuration, which must never be treated as documentation-only.

## Documentation-only probe

This checkpoint changes only one Markdown file in docs/reviews. With the above
successful main deployments now available as baselines, its follow-up deployment
logs should show documentation-only cancellation for both projects. Actual logs
must be checked before declaring that acceptance criterion complete.

Ignored builds still create Vercel deployment records and may perform cloning
and early checks. The verified saving is avoiding installation and compilation,
not eliminating every deployment record or guaranteeing zero platform cost.

Local validation, the existing secret-scan fixture exception and safe fallback
conditions are recorded in `2026-09-07-vercel-build-cost-local-validation.md`.
