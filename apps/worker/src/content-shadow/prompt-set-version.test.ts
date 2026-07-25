import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONTENT_SHADOW_PROMPT_SET_VERSION,
  PROMPT_SET_VERSION as ARTIFACTS_PROMPT_SET_VERSION,
} from "@sf/artifacts";
import { PROMPT_SET_VERSION as ENGINE_PROMPT_SET_VERSION } from "@sf/engine";

/**
 * The Content Shadow prompt-set SPLIT BRAIN guard.
 *
 * `flow_shadow_runs.content_hash` freezes `promptSetVersion`, and the worker
 * re-derives it from a pinned constant. Before Task 4b the accepting service
 * read `PROMPT_SET_VERSION` from `@sf/engine` while the worker read a
 * completely INDEPENDENT constant of the same name from `@sf/artifacts`. The
 * two happened to hold the same string, so nothing was visibly broken — but
 * advancing either one alone would have made every Content Shadow run fail with
 * CONTENT_SHADOW_INPUT_DRIFT, and nothing in the test suite would have caught
 * it. These assertions make that failure mode structural instead of latent.
 */

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const service = read("../../../web/src/lib/services/content-shadow.ts");
const worker = read("./run-content-shadow.ts");

describe("Content Shadow prompt-set version has exactly one source", () => {
  it.each([
    { side: "accepting service", source: service },
    { side: "worker replay guard", source: worker },
  ])(
    "the $side pins CONTENT_SHADOW_PROMPT_SET_VERSION from @sf/artifacts",
    ({ source }) => {
      const artifactsImport = source.match(
        /import\s*\{[^}]*\}\s*from\s*"@sf\/artifacts";/su,
      );

      expect(artifactsImport?.[0]).toContain(
        "CONTENT_SHADOW_PROMPT_SET_VERSION",
      );
      expect(source).toContain(
        "promptSetVersion: CONTENT_SHADOW_PROMPT_SET_VERSION",
      );
    },
  );

  it.each([
    { side: "accepting service", source: service },
    { side: "worker replay guard", source: worker },
  ])("the $side imports no prompt-set constant from @sf/engine", ({
    source,
  }) => {
    const engineImport = source.match(
      /import\s*\{[^}]*\}\s*from\s*"@sf\/engine";/su,
    );

    expect(engineImport?.[0] ?? "").not.toContain("PROMPT_SET_VERSION");
  });

  it("keeps the shadow prompt set distinct from the global one", () => {
    // A scoped name only helps if it is actually a different value; otherwise
    // the invocation ledger still records one name for two prompt shapes.
    expect(CONTENT_SHADOW_PROMPT_SET_VERSION).not.toBe(
      ARTIFACTS_PROMPT_SET_VERSION,
    );
  });

  it("keeps the two independent global PROMPT_SET_VERSION constants in step", () => {
    // `@sf/engine` and `@sf/artifacts` each declare their own literal. They are
    // required to agree; this is the assertion that was missing.
    expect(ARTIFACTS_PROMPT_SET_VERSION).toBe(ENGINE_PROMPT_SET_VERSION);
  });
});
