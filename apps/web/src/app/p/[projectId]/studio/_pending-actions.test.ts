import { describe, expect, it } from "vitest";
import type { Artifact, ArtifactAction } from "@/lib/api/hooks-studio";
import { actionsAwaitingArtifacts } from "./_pending-actions";

const action = (overrides: Partial<ArtifactAction> = {}): ArtifactAction => ({
  id: "action-1",
  findingId: "finding-1",
  templateId: "rewrite_search_metadata.v1",
  title: "Rewrite search metadata",
  description: "Improve the title and description.",
  contentLocale: "en",
  priorityBand: "high",
  roadmapLane: "now",
  status: "planned",
  effort: "small",
  risk: "low",
  expectedOutcome: "Higher CTR",
  revision: 1,
  createdAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:00:00.000Z",
  ...overrides,
});

const artifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: "artifact-1",
  actionId: "action-1",
  artifactType: "metadata_rewrite",
  status: "draft",
  generationMode: "template",
  outputLocale: "en",
  currentRevision: 1,
  validationState: "valid",
  current: null,
  activeRun: null,
  adoption: null,
  createdAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:00:00.000Z",
  ...overrides,
});

describe("actionsAwaitingArtifacts", () => {
  it("keeps confirmed actions visible until their expected artifact exists", () => {
    expect(actionsAwaitingArtifacts([action()], [])).toEqual([
      expect.objectContaining({ id: "action-1" }),
    ]);
    expect(actionsAwaitingArtifacts([action()], [artifact()])).toEqual([]);
  });

  it("treats archived artifacts as absent so an action can be generated again", () => {
    expect(
      actionsAwaitingArtifacts([action()], [artifact({ status: "archived" })]),
    ).toEqual([expect.objectContaining({ id: "action-1" })]);
  });

  it("omits dismissed and unknown-template actions", () => {
    expect(
      actionsAwaitingArtifacts(
        [
          action({ id: "dismissed", status: "dismissed" }),
          action({ id: "unknown", templateId: "future_template.v1" }),
        ],
        [],
      ),
    ).toEqual([]);
  });
});
