# Historical publication candidate — non-normative design input

Status: **historical**

Normative: **false**

Executable: **false**

This directory preserves the publication/attribution candidate that existed
before the complete current implementation was atomically promoted to the
active v0.4 authority. It is retained only for review history and design
provenance.

None of these files defines the current API, database, route, worker, provider
or customer-visible state:

- `openapi.candidate.yaml` is superseded by `../openapi.yaml`.
- `schema.candidate.sql` is superseded by the generated `../schema.sql`.
- `spec-v0.4-candidate-lock.json` is a historical hash record, not an active
  lock.
- `scripts/verify-candidate.mjs` and its test are archived verifier source.
  Their original relative paths and discovery hashes intentionally refer to the
  pre-promotion layout; they are **not runnable** and are excluded from active
  CI.
- the acceptance/provider/repository documents describe review input. Any
  statement that differs from the active authority is superseded.

Current normative discovery is exclusively:

```text
authority/index.json
→ authority/implementation-spec-v0.4/
→ scripts/spec-v0.4-lock.json
```

Moving a file from this directory back into the active authority root is a
contract error and must be rejected by the active verifier.
