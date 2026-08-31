# Page Citability: optional DataForSEO semantic review

This is a separate, explicit result action. The public page check never starts a
paid model call automatically. A model assessment of selected page excerpts is
neither a factual-verification result nor observed inclusion in an AI answer.

## Runtime prerequisites

- The existing Marketing sign-in flow must yield a server-verified user through
  `getServerAuthenticatedUser`. Browser-supplied user IDs are not accepted.
- The existing durable `consume_public_tool_quota` RPC and server credential
  must be operational. Quota outages fail closed; no in-memory fallback permits
  a paid call.
- Server-only `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` must be nonempty.
  Do not expose them as `NEXT_PUBLIC_*` or pass them to the renderer service.
- `CITABILITY_AI_MODEL_NAME` is optional; omitted means `gpt-4.1-mini`. The
  adapter accepts the bounded GPT-4.1 non-reasoning family only. Static validation
  is not proof of current provider availability: verify the exact name against
  the free model registry before enablement.

Official endpoints:

- Free `GET https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_responses/models`
  ([model registry documentation](https://docs.dataforseo.com/v3/ai_optimization-chat_gpt-llm_responses-models/)).
- Paid `POST https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_responses/live`
  ([Live documentation](https://docs.dataforseo.com/v3/ai_optimization-chat_gpt-llm_responses-live/)).

Both use Basic authentication. Never print credentials, request headers, or
provider error payloads when verifying them.

## Request, evidence and billing boundaries

The same-origin endpoint is
`POST /api/tools/page-citability-check/ai-review`. Its body accepts only the final
page `url`, optional `question`, and the report's `rawSha256`. It does not accept
client HTML, rule outcomes, a model, or a user ID.

The server safely re-fetches the page without following a replacement redirect.
Only a complete successful HTML response at the exact URL with the expected raw
SHA-256 can proceed. A changed document returns `evidence_changed` before a paid
call; run the page check again to inspect the newer document. Dynamic documents
whose raw HTML changes on every fetch may therefore be ineligible for this
strict snapshot-bound review. This is intentional; a later acquisition must not
silently become the evidence for an earlier report.

The evidence builder selects at most eight disjoint text excerpts and labels the
coverage as full or excerpt. Original HTML is not itself sent to the provider.
The request preserves the complete URL, question and selected text. If it cannot
fit DataForSEO's bounded message fields, it fails before the paid reservation
instead of silently shortening identity or evidence. Web search is disabled;
source links are not visited or verified.

Admission uses durable limits: three requests per user/hour, ten per user/day,
and ten per IP/hour. Immediately before the provider call, an atomic reservation
allows only one attempt per user and exact URL/question/raw-hash snapshot/hour.
Rejected duplicates cannot race into a second provider call. The ordinary
admission limits also protect the safe-refetch path and may be consumed by an
attempt that fails before billing.

There is no automatic provider retry. Timeout or transport failure may mean the
provider completed and charged the task but the app did not receive the result.
The response preserves that uncertainty, any observed task ID, and nullable
cost. The reservation is not refunded automatically. No durable result store or
cross-device report recovery is provided by this endpoint. Keep the current
report tab open and copy the report if the result must be retained.

## Release verification

1. Run the contract/evidence/provider/handler unit suites without credentials.
   Verify rejected auth, origin, malformed input, incomplete/changed evidence,
   unavailable quotas, concurrent duplicates and malformed provider outputs
   result in no unintended paid call.
2. With authorized local credentials, query the free registry and verify exactly
   one matching non-reasoning model. Use one safe-fetched public page snapshot
   for a single paid review, not a synthetic model fixture.
3. Record final URL, raw SHA-256, capture time, selected excerpts/coverage,
   requested/actual model, task ID, observation time, real nullable cost and
   tokens. A strict parser failure is a failed canary even if the API returned
   HTTP 200. Never manufacture replacement JSON for a failed provider response.
4. Run browser input/result, explicit consent, duplicate prevention, unknown
   outcome, snapshot isolation, copy, localization and responsive typography
   checks. Fixture browser proof is not a signed-in production canary.
5. Verify the configured production auth/quota/provider chain only after release
   authorization. Local adapter success does not establish a deployed route,
   production configuration, or a live authenticated browser success.

The manual probe requires an explicit paid-call flag, an existing credential
file supplied by the operator, a real public URL and a new output path:

```sh
pnpm exec tsx apps/marketing/scripts/citability-ai-canary.ts \
  --allow-one-paid-call /absolute/path/to/credentials.env \
  https://gengrowth.ai/ 'What does GenGrowth do?' \
  /absolute/path/to/new-evidence.json
```

It queries the free registry, safely fetches complete HTML with the same MIME
and encoding gate, then exclusively creates the evidence file before one paid
POST. Existing output files stop the call. A pending/failed file is not permission
to retry: inspect the recorded outcome and any provider task before authorizing
another attempt. The file contains selected public-page evidence and provenance,
not credentials. Its default creation mode is `0600`.

Use `-` instead of the credential-file path to read only `DATAFORSEO_LOGIN`,
`DATAFORSEO_PASSWORD`, and optional `CITABILITY_AI_MODEL_NAME` from the canary
process environment. This supports temporary, scoped injection from a hosting
platform without writing secrets to a local `.env` file. Select the exact
project/service/environment first; do not forward unrelated service variables,
print raw variable listings, or modify/redeploy the source service for a probe.

Comparable JavaScript rendering is independent. Follow
[the isolated renderer runbook](./citability-renderer.md); DataForSEO model
responses do not constitute measurements of a browser-rendered DOM.
