import { describe, expect, it } from "vitest";

import { assembleBundle, type BundleInput } from "@sf/artifacts";
import { redact } from "@sf/observability";

/**
 * AC-040: the pure export assembler must not reintroduce secrets once handed an
 * already-redacted BundleInput. A separate run-export boundary test covers the
 * real `runExport -> redact -> assembleBundle` path; this one scans the
 * STORE-method (uncompressed) zip bytes so any leaked secret would appear
 * verbatim in the archive.
 */

// Obviously-fake credential values (secrets:scan must never flag these).
const SECRETS = {
  projectApiKey: "FAKE-project-api-key-not-real",
  contextAuth: "Bearer FAKE-context-token-not-real",
  observationToken: "FAKE-observation-token-not-real",
  findingRefresh: "FAKE-finding-refresh-not-real",
  artifactClientSecret: "FAKE-artifact-client-secret-not-real",
  oauthInMessage: `ya29.${"O".repeat(40)}`,
  apiKeyInSummary: `sk-${"A".repeat(32)}`,
  cookieInTitle: `Cookie: sf_session=${"C".repeat(32)}`,
  ciphertextInArtifact: `encrypted_payload=${Buffer.from(
    "export-ciphertext-fixture",
  ).toString("base64")}`,
} as const;

function craftedInput(
  kind: "service_bundle" | "client_bundle" = "service_bundle",
): BundleInput {
  return {
    exportId: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
    kind,
    generatedAt: "2026-07-18T00:00:00.000Z",
    outputLocale: "en",
    sourceSnapshotIds: ["33333333-3333-4333-8333-333333333333"],
    // Secret smuggled into free-form content the field allowlist may not catch.
    project: {
      id: "pr-1",
      clientName: `ACME ${SECRETS.oauthInMessage}`,
      api_key: SECRETS.projectApiKey,
    },
    context: { profile: { authorization: SECRETS.contextAuth, segment: "b2b" } },
    sources: [],
    snapshots: [],
    observations: [
      {
        snapshotId: "snap-1",
        metricKey: "sessions",
        value_json: { token: SECRETS.observationToken },
      },
    ],
    findings: [
      {
        id: "f-1",
        reviewState: "confirmed",
        summary: `finding ${SECRETS.apiKeyInSummary}`,
        refresh_token: SECRETS.findingRefresh,
      },
    ],
    findingEvidenceLinks: [],
    evidence: [],
    actions: [{ id: "action-1", title: SECRETS.cookieInTitle }],
    artifacts: [
      {
        id: "a-1",
        status: "ready",
        currentRevision: 1,
        revisions: [
          {
            revision: 1,
            contentFormat: "json",
            content: {
              body: `deliverable ${SECRETS.ciphertextInArtifact}`,
              client_secret: SECRETS.artifactClientSecret,
            },
          },
        ],
      },
    ],
  };
}

describe("export bundle redaction guard", () => {
  it.each(["service_bundle", "client_bundle"] as const)(
    "strips secret keys and secret values from the %s ZIP",
    (kind) => {
      const input = craftedInput(kind);
      const safe = redact(input) as unknown as BundleInput;
      const assembled = assembleBundle(safe);

      for (const secret of Object.values(SECRETS)) {
        expect(assembled.zip.includes(secret)).toBe(false);
      }
      expect(assembled.zip.includes("[redacted]")).toBe(true);
    },
  );

  it("would leak those secrets without a caller-side redact backstop", () => {
    // Proves the assembler alone does not sanitize free-form payloads.
    const leaky = assembleBundle(craftedInput());
    expect(leaky.zip.includes(SECRETS.projectApiKey)).toBe(true);
    expect(leaky.zip.includes(SECRETS.artifactClientSecret)).toBe(true);
  });
});
