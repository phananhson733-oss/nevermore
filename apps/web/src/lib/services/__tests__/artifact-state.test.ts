import { describe, expect, it } from "vitest";
import {
  isArtifactContentEditAllowed,
  isManualArtifactStatusTransitionAllowed,
  type ArtifactStatus,
  type ManualArtifactStatus,
} from "@/lib/services/artifact-state";

const STATUSES = [
  "generating",
  "draft",
  "ready",
  "failed",
  "archived",
] as const satisfies readonly ArtifactStatus[];

const MANUAL_STATUSES = [
  "draft",
  "ready",
  "archived",
] as const satisfies readonly ManualArtifactStatus[];

const ALLOWED = new Set([
  "draft->ready",
  "draft->archived",
  "ready->archived",
]);

describe("Artifact state machine (implementation spec v0.2 §5.2, §10.3)", () => {
  it.each(STATUSES)("content editability for %s", (status) => {
    expect(isArtifactContentEditAllowed(status)).toBe(
      status === "draft" || status === "ready",
    );
  });

  it.each(
    STATUSES.flatMap((current) =>
      MANUAL_STATUSES.map((requested) => ({
        current,
        requested,
        allowed: ALLOWED.has(`${current}->${requested}`),
      })),
    ),
  )(
    "$current -> $requested allowed=$allowed",
    ({ current, requested, allowed }) => {
      expect(
        isManualArtifactStatusTransitionAllowed(current, requested),
      ).toBe(allowed);
    },
  );

  it("fails closed for an unknown persisted state", () => {
    expect(isArtifactContentEditAllowed("unknown")).toBe(false);
    expect(
      isManualArtifactStatusTransitionAllowed("unknown", "ready"),
    ).toBe(false);
  });
});
