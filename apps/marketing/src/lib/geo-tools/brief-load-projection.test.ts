import { describe, expect, it } from "vitest";
import { projectBriefFrozenChoice } from "./brief-load-projection.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import type { VersionedGeoKbFrozenSnapshot } from "./kb-versioned-read.ts";
import { completePayloadV3, V3_KB_ID } from "./kb-v3.test-fixtures.ts";
import { questionSetV2 } from "./kb-v2.test-fixtures.ts";

const SNAPSHOT_ID = "22222222-2222-8222-8222-222222222222";
const FROZEN_AT = "2026-09-03T00:00:00.000Z";

function frozenV3(withQuestions: boolean): VersionedGeoKbFrozenSnapshot {
  const payload = completePayloadV3();
  const questionSet = withQuestions ? questionSetV2() : null;
  return {
    kbId: V3_KB_ID, snapshotId: SNAPSHOT_ID, revision: 2, contentHash: geoV2Digest(payload),
    questionSetHash: questionSet === null ? null : geoV2Digest(questionSet),
    questionCount: questionSet === null ? null : questionSet.questions.length,
    frozenAt: FROZEN_AT, payload, questionSet,
  };
}

describe("Brief frozen-version projection", () => {
  it("projects a v3 version's frozen questions and roles", () => {
    const frozen = frozenV3(true);

    const choice = projectBriefFrozenChoice(frozen, "example.com");

    expect(choice).toMatchObject({
      kbId: V3_KB_ID, snapshotId: SNAPSHOT_ID, market: { country: "US", language: "en" },
      promptsetRef: { schema: "marketing-geo-question-set.v2", hash: frozen.questionSetHash },
    });
    expect(choice?.questions).toHaveLength(1);
    // Roles come from the frozen v3 generation input, not from today's draft.
    expect(choice?.questions[0]?.role).toEqual({ id: "r1", label: "Independent astrologers", segment: "solo practitioners" });
  });

  it("offers nothing rather than a prompt-set reference that names no set", () => {
    const frozen = frozenV3(false);

    expect(projectBriefFrozenChoice(frozen, "example.com")).toBeNull();
  });

  it("offers nothing when a question set arrives without the hash that names it", () => {
    // Both halves or neither: a promptsetRef whose hash is missing would bind
    // the Brief to a set it cannot name.
    const frozen = { ...frozenV3(true), questionSetHash: null };

    expect(projectBriefFrozenChoice(frozen, "example.com")).toBeNull();
  });
});
