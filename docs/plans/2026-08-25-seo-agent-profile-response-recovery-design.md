# SEO Agent Profile Response Recovery Design

## Problem

Production `POST /api/agents/seo/profile-refresh` returned HTTP 502 twice on
2026-08-25 from Marketing deployment commit
`a9f42f7810a11d04134415b7777ed5aa071eea94`. The public response was
`profile_response_invalid`. The deployed code does not log which internal
validation stage produced that response.

The model-output parser currently treats the 22-field response atomically. One
missing, duplicated, malformed, or off-crawl field rejects every otherwise
valid field and repeats the same model request once. This is unnecessarily
fragile because the public wire contract already supports field-level
`unavailable` states.

## Approved Approach

Use field-level fail-closed recovery while keeping the browser/API contract
strict:

- Preserve every model field that independently satisfies the existing field
  and crawl-citation contract.
- Replace each missing, duplicated, or invalid field with a deterministic
  `unavailable` field. Never retain its value or citation.
- Continue to reject a malformed root object or a reply with no independently
  valid fields. Those cases still retry once and then return HTTP 502.
- Add concise output guidance so the 22-field JSON is less likely to be
  truncated or to exceed field/list limits.
- Bump the prompt version so cache identity cannot mix the old all-or-nothing
  prompt with the recovery behavior.
- Emit safe structured diagnostics for each backend
  `profile_response_invalid` stage. Log only the stage, Agent, counts, and
  usage; never log model/page content, field values, URLs, request bodies,
  cookies, or credentials.

## Scope

Only the Marketing-owned profile-diagnosis path changes:

- `apps/marketing/src/lib/agents/profile-refresh-prompt.ts`
- `apps/marketing/src/lib/agents/profile-refresh-prompt.test.ts`
- `apps/marketing/src/lib/agents/profile-refresh-handler.ts`
- `apps/marketing/src/lib/agents/profile-refresh-handler.test.ts`

The authenticated Product app, databases, DataForSEO behavior, audit result
contract, UI layout, and customer-visible error copy remain unchanged.

## Data Flow

1. The guarded crawler returns bounded public pages.
2. The model returns a JSON object containing candidate profile fields.
3. The parser checks each expected path independently against the existing
   strict contract and exact crawl URL set.
4. Valid candidates remain unchanged. Invalid/missing/duplicate candidates are
   replaced with an `unavailable` object carrying no value or evidence URL.
5. The completed 22-field array passes the unchanged wire-contract guard.
6. The handler derives availability/counts, writes only the validated payload
   to cache, and returns the strict envelope.

## Failure and Observability Semantics

- Partially usable model reply: return `200` with valid fields plus explicit
  unavailable fields.
- Root is not the expected JSON object, or no field is independently valid:
  retry once; after the second failure, return the existing
  `502 profile_response_invalid`.
- Cache identity/captured-at failure, reconstructed cache contract failure, and
  fresh envelope contract failure retain their existing safe 502 behavior.
- Each 502 path writes a bounded structured stage marker to Vercel runtime
  logs, without retaining user or provider payloads.

## Acceptance

- A reply with 21 valid fields and one invalid field returns a strict 22-field
  result; the bad field is `unavailable` and no second model call occurs.
- Missing and duplicate paths cannot leak a model value or citation.
- An all-invalid or malformed reply still retries once and fails closed.
- The final browser/API envelope remains accepted by
  `isAgentProfileRefreshData`.
- Focused prompt, handler, contract, and workbench tests pass, followed by
  Marketing lint, typecheck, and build gates.
- Work remains local: no commit, push, PR, deployment, environment change, or
  production request is authorized by this design approval.
