import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

describe("frozen legacy English migration inventory", () => {
  it("contains the auditable cutover-plus-repair inventory exactly once", async () => {
    const { LEGACY_EN_MIGRATION_ENTRIES } = await import(
      "./legacy-en-migration.ts"
    );
    const legacyPaths = LEGACY_EN_MIGRATION_ENTRIES.map(
      (entry) => entry.legacyPath,
    );

    expect(legacyPaths).toHaveLength(162);
    expect(new Set(legacyPaths).size).toBe(162);
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
      legacyPaths.filter((legacyPath) => legacyPath.startsWith("/en/glossary/")),
    ).toHaveLength(50);
    expect(
      legacyPaths.filter((legacyPath) => legacyPath.startsWith("/en/compare/")),
    ).toHaveLength(4);
    expect(
      legacyPaths.filter((legacyPath) => legacyPath.startsWith("/en/playbooks/")),
    ).toHaveLength(6);
    expect(
      legacyPaths.filter((legacyPath) => legacyPath.startsWith("/en/use-cases/")),
    ).toHaveLength(4);
    expect(legacyPaths).toContain("/en/tools/ab-test-calculator");
    expect(legacyPaths).toContain("/en/tools/growth-roi-calculator");
    expect(legacyPaths).toContain("/en/tools/hidden-keywords");

    expect(
      LEGACY_EN_MIGRATION_ENTRIES.filter(
        (entry) => entry.disposition === "gone",
      ),
    ).toHaveLength(75);

    // Count and shape alone do not pin membership: one reviewed URL could be
    // replaced by an arbitrary /en path and still pass. This digest freezes
    // membership, final outcome, migration cohort, and provenance.
    const frozenInventoryDigest = createHash("sha256")
      .update(
        LEGACY_EN_MIGRATION_ENTRIES.map(
          (entry) =>
            [
              entry.legacyPath,
              entry.targetPath ?? "[gone]",
              entry.disposition,
              entry.migrationDate,
              entry.provenance,
            ].join("\t"),
        )
          .sort()
          .join("\n"),
      )
      .digest("hex");
    expect(frozenInventoryDigest).toBe(
      "163b066b2eb30662382cc35fd4d5ab7bb994f7beecb3989068a44f21d39571a7",
    );
  });

  it("maps every legacy URL to a recorded disposition, target, and migration cohort", async () => {
    const { LEGACY_EN_MIGRATION_ENTRIES } = await import(
      "./legacy-en-migration.ts"
    );

    for (const entry of LEGACY_EN_MIGRATION_ENTRIES) {
      if (entry.disposition === "gone") {
        expect(entry.targetPath, entry.legacyPath).toBeNull();
      } else {
        expect(entry.targetPath, entry.legacyPath).toMatch(/^\//u);
        expect(entry.targetPath, entry.legacyPath).not.toMatch(
          /^\/en(?:\/|$)/u,
        );
      }
      expect(entry.disposition, entry.legacyPath).toMatch(
        /^(direct_redirect|replacement_redirect|recovered_redirect|gone)$/u,
      );
      expect(entry.migrationDate, entry.legacyPath).toMatch(
        /^(?:2026-07-31|2026-08-13)$/u,
      );
    }

    expect(
      LEGACY_EN_MIGRATION_ENTRIES.find(
        (entry) => entry.legacyPath === "/en/blog/gengrowth-vs-improvado",
      ),
    ).toMatchObject({
      targetPath: "/blog/gengrowth-vs-improvado",
      disposition: "recovered_redirect",
      migrationDate: "2026-08-13",
    });
    expect(
      LEGACY_EN_MIGRATION_ENTRIES.find(
        (entry) => entry.legacyPath === "/en/glossary/backlink-profile",
      ),
    ).toMatchObject({
      targetPath: null,
      disposition: "gone",
      migrationDate: "2026-08-13",
    });
    expect(
      LEGACY_EN_MIGRATION_ENTRIES.find(
        (entry) => entry.legacyPath === "/en/compare",
      ),
    ).toMatchObject({
      targetPath: "/blog#comparisons",
      disposition: "replacement_redirect",
      migrationDate: "2026-08-13",
    });
    expect(
      LEGACY_EN_MIGRATION_ENTRIES.find(
        (entry) => entry.legacyPath === "/en/tools/seo-audit",
      ),
    ).toMatchObject({
      targetPath: "/agents/seo",
      disposition: "replacement_redirect",
      migrationDate: "2026-08-13",
    });
    expect(
      LEGACY_EN_MIGRATION_ENTRIES.find(
        (entry) => entry.legacyPath === "/en/blog/gengrowth-vs-okara",
      ),
    ).toMatchObject({
      targetPath: null,
      disposition: "gone",
      migrationDate: "2026-08-13",
    });
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
      "/en/blog/seo-content-clusters-draft",
      "/en/blog/striking-distance-keywords",
      "/en/blog/zero-search-volume-keywords",
      "/en/tools/low-competition-keywords",
    ]) {
      expect(legacyPaths, postCutoverPath).not.toContain(postCutoverPath);
    }
  });
});
