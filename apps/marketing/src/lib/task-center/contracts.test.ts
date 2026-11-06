// @input  -- the zod inputs in contracts.ts
// @output -- proof that 题材 refuses audience words, that 查剧 takes only platforms and languages 选剧台 knows, and that a clip update needs a field and leaves the other alone
// @pos    -- unit tests for the admin request contract; no database
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import { assetUpdateSchema, dramaImportSchema, dramaInputSchema, dramaLookupSchema } from "./contracts.ts";

const drama = { title: "Surf God's Revenge", platform: "reelshort", language: "en" };

describe("dramaInputSchema genre", () => {
  it("lowercases a genre and accepts any slug", () => {
    expect(dramaInputSchema.parse({ ...drama, genre: " Revenge " }).genre).toBe("revenge");
    expect(dramaInputSchema.parse({ ...drama, genre: "ceo-revenge" }).genre).toBe("ceo-revenge");
    expect(dramaInputSchema.parse({ ...drama, genre: "" }).genre).toBeNull();
  });

  it("refuses an audience typed into 题材 and says so", () => {
    for (const word of ["male", "Female", "women"]) {
      const result = dramaInputSchema.safeParse({ ...drama, genre: word });
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.message)).toContain("genre_is_audience");
    }
    expect(dramaInputSchema.parse({ ...drama, audience: "male" }).audience).toBe("male");
  });
});

describe("查剧", () => {
  it("collapses spaces in the title and makes a missing language null", () => {
    expect(dramaLookupSchema.parse({ platform: "kalostv", title: "  Surf   God " })).toEqual({
      platform: "kalostv",
      title: "Surf God",
      language: null,
    });
  });

  it("refuses a platform or language 选剧台 does not know, and any other field", () => {
    expect(dramaLookupSchema.safeParse({ platform: "netflix", title: "x" }).success).toBe(false);
    expect(dramaLookupSchema.safeParse({ platform: "reelshort", title: "x", language: "xx" }).success).toBe(false);
    expect(dramaLookupSchema.safeParse({ platform: "reelshort", title: "x", episodes: 3 }).success).toBe(false);
    expect(dramaLookupSchema.safeParse({ platform: "reelshort", title: "   " }).success).toBe(false);
  });

  it("imports only by a well-formed platform id", () => {
    const query = { platform: "reelshort", title: "x" };
    expect(dramaImportSchema.parse({ ...query, platformDramaId: "68a1-b2_c" }).platformDramaId).toBe("68a1-b2_c");
    expect(dramaImportSchema.safeParse({ ...query, platformDramaId: "../etc" }).success).toBe(false);
  });
});

describe("dramaInputSchema tags", () => {
  it("leaves tags out when not sent and caps them", () => {
    expect(dramaInputSchema.parse(drama).tags).toBeUndefined();
    expect(dramaInputSchema.parse({ ...drama, tags: [" CEO "] }).tags).toEqual(["CEO"]);
    expect(dramaInputSchema.safeParse({ ...drama, tags: Array.from({ length: 21 }, (_, n) => `t${n}`) }).success).toBe(false);
  });
});

describe("assetUpdateSchema", () => {
  it("takes a type, a title or both, and leaves out what was not sent", () => {
    expect(assetUpdateSchema.parse({ clipType: null })).toEqual({ clipType: null });
    expect(assetUpdateSchema.parse({ title: "  Ep 1 hook " })).toEqual({ title: "Ep 1 hook" });
    expect(assetUpdateSchema.parse({ clipType: "recap", title: "A" })).toEqual({ clipType: "recap", title: "A" });
  });

  it("refuses an empty change, a blank title and unknown fields", () => {
    expect(assetUpdateSchema.safeParse({}).success).toBe(false);
    expect(assetUpdateSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(assetUpdateSchema.safeParse({ title: "x".repeat(201) }).success).toBe(false);
    expect(assetUpdateSchema.safeParse({ clipType: "vlog" }).success).toBe(false);
    expect(assetUpdateSchema.safeParse({ title: "A", status: "ready" }).success).toBe(false);
  });
});
