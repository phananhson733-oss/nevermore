// @input  — findShortLink with a stubbed Supabase admin client
// @output — tests pinning "no such table" to absence and real errors to errors
// @pos    — link attribution domain tests
// once this file is updated, update header comments and _DIR.md in this folder
import { describe, expect, it } from "vitest";

import { findShortLink } from "./short-links.ts";

type Result = {
  data: unknown;
  error: { code: string; message: string } | null;
};

/** Minimal stand-in for the one query chain findShortLink builds. */
function adminReturning(result: Result) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => result,
        }),
      }),
    }),
  } as never;
}

/**
 * A missing table is not the same fact as a missing link.
 *
 * An earlier version read 42P01/PGRST205 as "no such short link", which reads
 * one truth (this instance cannot see the table) as a different one (the data
 * does not exist). A rolled-back migration, the wrong project, or a schema
 * that stopped being exposed all produce the same code — and answering "gone"
 * to any of them retires a published URL permanently. Whether a deployment
 * serves short links at all is now declared by the caller instead.
 */
describe("findShortLink when the table is not there", () => {
  it.each([
    ["42P01", "Postgres undefined_table"],
    ["PGRST205", "PostgREST table not in schema cache"],
    ["PGRST202", "PostgREST function not in schema cache"],
  ])("reports %s (%s) as a failure, not as absence", async (code) => {
    const admin = adminReturning({
      data: null,
      error: { code, message: `relation "link_redirects" does not exist` },
    });

    await expect(findShortLink("anything", admin)).rejects.toThrow();
  });
});

describe("findShortLink on a hit", () => {
  it("returns the stored record unchanged", async () => {
    const record = {
      code: "launch",
      destination_url: "https://gengrowth.ai/tools/seo-audit",
      redirect_status: 302,
    };

    await expect(
      findShortLink("launch", adminReturning({ data: record, error: null })),
    ).resolves.toEqual(record);
  });

  it("returns null for a clean miss", async () => {
    await expect(
      findShortLink("nope", adminReturning({ data: null, error: null })),
    ).resolves.toBeNull();
  });
});
