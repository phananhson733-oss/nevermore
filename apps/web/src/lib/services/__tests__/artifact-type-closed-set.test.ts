import { describe, expect, it } from "vitest";
import { ArtifactType, type ArtifactType as WireArtifactType } from "@sf/contracts";
import { ARTIFACT_FORMAT } from "@sf/artifacts";
import {
  ACTION_TEMPLATES,
  type ArtifactType as EngineArtifactType,
} from "@sf/engine";

/**
 * `ArtifactType` is declared three times — the wire enum (`@sf/contracts`), the
 * generator/validator union (`@sf/artifacts`), and the template registry union
 * (`@sf/engine`) — plus a DB CHECK. They are only safe because they are the
 * same four-element closed set; a fifth member added in one place would let a
 * type through one layer that the next cannot persist or render.
 */
const CLOSED_SET = [
  "content_brief",
  "english_blog_draft",
  "metadata_rewrite",
  "technical_ticket",
] as const;

// Compile-time halves of the same assertion: each declaration must be
// assignable to the other, so `pnpm typecheck` fails on a divergent member even
// before this suite runs.
const wireAsEngine: readonly EngineArtifactType[] = ArtifactType.options;
const engineAsWire: readonly WireArtifactType[] = Object.keys(
  ARTIFACT_FORMAT,
) as EngineArtifactType[];

describe("ArtifactType closed set", () => {
  it("is the same four members in the wire enum and the format map", () => {
    expect([...wireAsEngine].sort()).toEqual([...CLOSED_SET]);
    expect([...engineAsWire].sort()).toEqual([...CLOSED_SET]);
  });

  it("only ever admits a template artifact type from that set", () => {
    for (const template of Object.values(ACTION_TEMPLATES)) {
      expect(CLOSED_SET).toContain(template.artifactType);
    }
  });
});
