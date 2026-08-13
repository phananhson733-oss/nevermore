import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

describe("frozen legacy English migration inventory", () => {
  it("contains the 95 proven pre-cutover URLs exactly once", async () => {
    const { LEGACY_EN_MIGRATION_ENTRIES } = await import(
      "./legacy-en-migration.ts"
    );
    const legacyPaths = LEGACY_EN_MIGRATION_ENTRIES.map(
      (entry) => entry.legacyPath,
    );

    expect(legacyPaths).toHaveLength(95);
    expect(new Set(legacyPaths).size).toBe(95);
    expect(
      legacyPaths.every(
        (legacyPath) =>
          legacyPath === "/en" || legacyPath.startsWith("/en/"),
      ),
    ).toBe(true);
    expect(legacyPaths.every((legacyPath) => !legacyPath.includes("?"))).toBe(
      true,
    );
    expect(
      legacyPaths.filter((legacyPath) => legacyPath.startsWith("/en/blog/")),
    ).toHaveLength(75);
    expect(
      legacyPaths.filter((legacyPath) => !legacyPath.startsWith("/en/blog/")),
    ).toHaveLength(20);

    // Count and shape alone do not pin membership: one reviewed URL could be
    // replaced by an arbitrary /en path and still pass. This digest freezes
    // both the reviewed source set and its final destinations without copying
    // the 95-row authority into the test.
    const frozenInventoryDigest = createHash("sha256")
      .update(
        LEGACY_EN_MIGRATION_ENTRIES.map(
          (entry) => `${entry.legacyPath}\t${entry.targetPath}`,
        )
          .sort()
          .join("\n"),
      )
      .digest("hex");
    expect(frozenInventoryDigest).toBe(
      "c31abf0f2e5b5379cd3d7d4f79152830c387c0e06df5235faf02d997f800b9e9",
    );
  });

  it("maps every legacy URL to an unprefixed final target", async () => {
    const { LEGACY_EN_MIGRATION_ENTRIES } = await import(
      "./legacy-en-migration.ts"
    );

    for (const entry of LEGACY_EN_MIGRATION_ENTRIES) {
      expect(entry.targetPath, entry.legacyPath).toMatch(/^\//u);
      expect(entry.targetPath, entry.legacyPath).not.toMatch(/^\/en(?:\/|$)/u);
    }
  });

  it("excludes pages first published after the locale cutover", async () => {
    const { LEGACY_EN_MIGRATION_ENTRIES } = await import(
      "./legacy-en-migration.ts"
    );
    const legacyPaths = new Set(
      LEGACY_EN_MIGRATION_ENTRIES.map((entry) => entry.legacyPath),
    );

    for (const postCutoverPath of [
      "/en/blog/how-to-find-low-hanging-fruit-keywords",
      "/en/blog/pagerank-sculpting",
      "/en/blog/striking-distance-keywords",
      "/en/blog/zero-search-volume-keywords",
      "/en/tools/low-competition-keywords",
    ]) {
      expect(legacyPaths, postCutoverPath).not.toContain(postCutoverPath);
    }
  });
});
