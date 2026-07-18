import { describe, expect, it } from "vitest";

import { assembleBundle, type BundleInput } from "@sf/artifacts";
import { redact } from "@sf/observability";

/**
 * AC-040: the export bundle must never carry raw secrets. `buildBundleInput` in
 * run-export.ts deep-redacts the assembled input (`redact(input)`) before handing
 * it to the pure assembler. This test exercises that exact composition and scans
 * the STORE-method (uncompressed) zip bytes, so any leaked secret would appear
 * verbatim in the archive.
 */

// Obviously-fake credential values (secrets:scan must never flag these).
const SECRETS = {
  projectApiKey: "FAKE-project-api-key-not-real",
  contextAuth: "Bearer FAKE-context-token-not-real",
  observationToken: "FAKE-observation-token-not-real",
  findingRefresh: "FAKE-finding-refresh-not-real",
  artifactClientSecret: "FAKE-artifact-client-secret-not-real",
} as const;

function craftedInput(): BundleInput {
  return {
    exportId: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
    kind: "service_bundle",
    generatedAt: "2026-07-18T00:00:00.000Z",
    outputLocale: "en",
    sourceSnapshotIds: ["33333333-3333-4333-8333-333333333333"],
    // Secret smuggled into free-form content the field allowlist may not catch.
    project: { id: "pr-1", clientName: "ACME", api_key: SECRETS.projectApiKey },
    context: { profile: { authorization: SECRETS.contextAuth, segment: "b2b" } },
    sources: [],
    snapshots: [],
    observations: [
      { snapshotId: "snap-1", metricKey: "sessions", value_json: { token: SECRETS.observationToken } },
    ],
    findings: [
      { id: "f-1", reviewState: "confirmed", summary: "ok", refresh_token: SECRETS.findingRefresh },
    ],
    evidence: [],
    actions: [],
    artifacts: [
      {
        id: "a-1",
        status: "final",
        revisions: [
          {
            revision: 1,
            contentFormat: "json",
            content: { body: "deliverable", client_secret: SECRETS.artifactClientSecret },
          },
        ],
      },
    ],
  };
}

describe("export bundle redaction guard", () => {
  it("strips every secret-named field from the assembled bundle", () => {
    const input = craftedInput();
    const safe = redact(input) as unknown as BundleInput;
    const assembled = assembleBundle(safe);

    for (const secret of Object.values(SECRETS)) {
      expect(assembled.zip.includes(secret)).toBe(false);
    }
    expect(assembled.zip.includes("[redacted]")).toBe(true);
  });

  it("would leak those secrets without the redact backstop (guard is load-bearing)", () => {
    // Proves the redaction is necessary: the raw assembler alone lets the crafted
    // secrets through, so removing `redact(...)` from run-export.ts regresses AC-040.
    const leaky = assembleBundle(craftedInput());
    expect(leaky.zip.includes(SECRETS.projectApiKey)).toBe(true);
    expect(leaky.zip.includes(SECRETS.artifactClientSecret)).toBe(true);
  });
});
