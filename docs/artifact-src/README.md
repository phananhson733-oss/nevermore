# GenGrowth Customer Artifact Source

This directory is the repository-owned source for the complete, Chinese-first
GenGrowth customer Artifact. The generated deliverables are:

- `docs/artifacts/GenGrowth-Interactive-Artifact.html`
- `docs/artifacts/GenGrowth-Product-Manual.html`

Both outputs must be rebuilt from this directory. The historical visualization
directory is provenance only and must not be read by normal build, verification,
test, or CI commands.

## Imported baseline

The initial executable source was imported on 2026-07-27 from the historical
Codex visualization session:

`2026/07/20/019f7ff0-3874-7623-90f3-1ebdea7c313f`

Original SHA-256 values:

| File | Historical SHA-256 |
| --- | --- |
| `styles.css` | `6ab30a111835edad17f773e92aef2ba37c85b9d4b253a55e5cf25fef3671c276` |
| `workspace-data.js` | `d750d60d2e2d64d5a4f01367457d05fb0517491162aeb83c09c87a4cb939d9ef` |
| `client-app.js` | `fdeef541662cca9008929bfb802727567cc0f7307cfb86ac5d79dd0afb5fa1e6` |

The repository copy intentionally changes the historical internal project
labels (`Nevermore` and the legacy `signalframe` family) to the customer brand
`GenGrowth`. Subsequent changes are reviewed product-source changes and are not
expected to preserve the original hashes.

## Source-of-truth rules

- `workspace-data.js` owns every scenario entity, count, URL, Keyword,
  Competitor, Artifact, revision, release, campaign, receipt, and result.
- `client-app.js` renders and mutates session state; it must not invent a second
  scenario dataset or silently imply external publication.
- `styles.css` owns the self-contained responsive presentation.
- The customer UI is Chinese-first. English remains appropriate for the English
  Blog deliverable, standards, provider names, URLs, Keywords, and code.
- Scenario data must stay clearly labelled as scenario data. A simulated share,
  approval, publish, PR, receipt, campaign, or result must never be described as
  a real external write.
- Generated HTML must contain no remote assets, workstation paths, internal
  project names, credentials, or dependency on another checkout.

## Rebuild and verification

Run from the repository root:

```bash
pnpm artifact:regen
pnpm artifact:verify
pnpm test:e2e:artifact
```

Generation must be deterministic: running `pnpm artifact:regen` twice must leave
the worktree clean.
