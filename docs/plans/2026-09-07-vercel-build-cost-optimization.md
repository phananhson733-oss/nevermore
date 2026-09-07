# Vercel build cost optimization

User approved the two changes identified in the billing audit: avoid duplicate
Marketing previews of main, and skip changes limited to plan/review documents.

Baseline: origin/main `4e2412f7018266783f68dcc251a4a190e94e0caa` in an isolated
worktree. The original preserved checkout is dirty and is not edited.

## Design

Both Vercel projects keep automatic affected-project detection and their current
app roots. A dependency-free Node Ignored Build Step runs before installation:

- Only Marketing Git-triggered main previews without a PR/custom-environment
  identity are skipped by the duplicate-preview rule.
- For both projects, compare HEAD to VERCEL_GIT_PREVIOUS_SHA (last successful
  deployment for that project/branch), not just HEAD's parent. This preserves
  pending code changes across failed deployments and multi-commit pushes.
- Ignore only Markdown files under root docs/plans, docs/reviews,
  docs/external-reviews, or docs/superpowers/plans. Skip a docs-only diff;
  otherwise walk the app's declared transitive workspace dependencies, so a
  Marketing change plus a review does not force an unrelated Product build.
- Code, shared packages, lockfiles, executable authority, customer Artifact,
  public content, unknown inputs, first deployments, missing shallow history,
  nonancestor history and empty diffs continue building.
- Keep contexts without GitHub metadata and explicit custom environments building.
  A manual Git-backed main preview can match the early skip rule; use Vercel's
  redeploy option to bypass the ignored step when that preview is intentional.

## Verification

Run real temporary Git repository tests, including rename/delete cases,
multi-commit pushes, a previous failed code change followed by docs, shallow
history, both app working directories and process exit codes (0 skip, 1 build).
Wire the test into the manual CI workflow. Replay known documentation-only and
mixed historical commits. Run applicable docs/authority/spec/deploy/secrets gates
and validate both project settings and live deployment logs before claiming the
optimization is active. Preserve canonical-domain identities independently.

No application behavior, provider requests, database schema, Worker deployment,
domain assignment or build machine size is part of this change. The user explicitly waived external ChatGPT Pro collaboration and authorized
continuation with the completed local implementation and native independent review.
No source was uploaded externally.

## References

- https://vercel.com/docs/project-configuration/project-settings#ignored-build-step
- https://vercel.com/docs/environment-variables/system-environment-variables#vercel_git_previous_sha
- https://vercel.com/kb/guide/how-do-i-use-the-ignored-build-step-field-on-vercel

## Rollback

Remove only the new ignoreCommand entries (or restore the previous project Ignore
Build Step setting). Unknown or failed policy execution must permit a build,
never silently suppress a production update.
