# Vercel build cost local validation

Baseline:4e2412f7018266783f68dcc251a4a190e94e0caa. Isolated branch codex/vercel-build-cost-20260907. The original dirty checkout was preserved.

## Local evidence

- Dependency-free Node fixture suite:16passed,0failed. It creates real temporary Git repositories and invokes the actual CLI from both app roots.
- Historical repository replay with each commit's first parent supplied explicitly as the successful deployment baseline: PR294 docs-only skips both; PR312 Marketing+review builds Marketing and skips Product; PR311 shared-source change builds both. These are local replays, not actual Vercel cancellation evidence.
- Node syntax check, changed-file ESLint and git diff check passed.
- Marketing and Product production builds both passed without changing application source or environment variables.
- verify:docs14/14, verify:authority, verify:spec and deploy:check passed.
- secrets:scan is NOT green: one existing JWT-shaped fixture in apps/marketing/src/components/agents/agent-issue-prompt.test.ts:495 is detected. The entire file matches the untouched baseline. No unrelated scan-rule/test edits were made.
- Native independent review found no blocking defect; plan wording was corrected so manual Git-backed main previews are not promised exemption. Vercel's redeploy Ignore Build Step bypass is the documented explicit escape.

## Permission and remaining work

The user approved the two build optimizations. External ChatGPT Pro source upload was not authorized. AGENTS.md requires an explicit waiver before substituting a Codex-only workflow; the user explicitly confirmed the waiver in this task. Native review is recorded as native review, not external Pro review.

At this local-validation checkpoint, no commit, push, PR, Vercel configuration mutation, app publication, database or Worker change had occurred. Subsequent activation is recorded separately. The user has confirmed continuation; the implementation must still be committed/activated and verified in actual Vercel logs: main preview skipped, pure-doc builds skipped, affected code builds normally, and canonical-domain identities rechecked.

## Rollout boundary

Both projects currently expose system environment variables and have affected-project detection enabled. Their Ignored Build Step is currently unset. The authenticated app domain remains on dpl_DzMBdEeuhxshcsqSt8UVttk75cc7; do not promote an app candidate as a side effect of installing the build guard. No production data/provider calls are required.

Replay rows:

```json
[
  {
    "sha": "1f569e7846c688d9a47943912c3d38c40dbff93a",
    "project": "marketing",
    "exitCode": 0,
    "decision": "[vercel-build] skip: only plan/review Markdown since last successful deployment"
  },
  {
    "sha": "1f569e7846c688d9a47943912c3d38c40dbff93a",
    "project": "web",
    "exitCode": 0,
    "decision": "[vercel-build] skip: only plan/review Markdown since last successful deployment"
  },
  {
    "sha": "4365536691accf541d2cb3764e4385ad5ff22e1a",
    "project": "marketing",
    "exitCode": 1,
    "decision": "[vercel-build] build: app or dependency changes"
  },
  {
    "sha": "4365536691accf541d2cb3764e4385ad5ff22e1a",
    "project": "web",
    "exitCode": 0,
    "decision": "[vercel-build] skip: no app or dependency changes after excluding plan/review Markdown"
  },
  {
    "sha": "11e60521039903f89d6422c34232fe81c28f12f9",
    "project": "marketing",
    "exitCode": 1,
    "decision": "[vercel-build] build: app or dependency changes"
  },
  {
    "sha": "11e60521039903f89d6422c34232fe81c28f12f9",
    "project": "web",
    "exitCode": 1,
    "decision": "[vercel-build] build: global or unknown changes"
  }
]
```
