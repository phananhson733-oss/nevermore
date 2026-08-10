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
 * `link_redirects` is one of the eight marketing tables that live only in the
 * suspended Agents project and have never existed in the production database
 * (docs/INFRASTRUCTURE.md), so on production this is not an edge case — it is
 * every request. Reporting it as a failure put the whole root namespace on
 * 503, because the proxy routes every unknown 6+ character path through here.
 */
describe("findShortLink when the table is not there", () => {
  it.each([
    ["42P01", "Postgres undefined_table"],
    ["PGRST205", "PostgREST table not in schema cache"],
    ["PGRST202", "PostgREST schema not in cache"],
  ])("reports absence rather than failure for %s (%s)", async (code) => {
    const admin = adminReturning({
      data: null,
      error: { code, message: `relation "link_redirects" does not exist` },
    });

    await expect(findShortLink("anything", admin)).resolves.toBeNull();
  });
});

describe("findShortLink on a real failure", () => {
  it("still throws when the database is reachable but the query fails", async () => {
    const admin = adminReturning({
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    });

    await expect(findShortLink("anything", admin)).rejects.toThrow(
      /statement timeout/,
    );
  });

  it("throws on a connection-level error rather than reporting no such link", async () => {
    const admin = adminReturning({
      data: null,
      error: { code: "08006", message: "connection failure" },
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
