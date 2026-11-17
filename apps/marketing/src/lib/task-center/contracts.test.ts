// @input  -- the zod inputs in contracts.ts
// @output -- proof that 题材 refuses audience words, that the platform link is optional and only a full https URL is taken, that 查剧 takes only platforms and languages 选剧台 knows, that a clip update needs a field and leaves the others alone, and how a 推荐文案's hashtags are read from what an admin types or pastes
// @pos    -- unit tests for the admin request contract; no database
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import {
  assetUpdateSchema,
  dramaImportSchema,
  dramaInputSchema,
  dramaLookupSchema,
  parseHashtags,
  splitCaption,
} from "./contracts.ts";

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
    // GoodShort's ids in 北斗 are base64.
    expect(dramaImportSchema.parse({ ...query, platformDramaId: "9i/dssELM0MvEetSwJbzYw==" }).platformDramaId).toBe(
      "9i/dssELM0MvEetSwJbzYw==",
    );
    for (const bad of ["a=b", "==", "a/../b?", "x".repeat(65), "a+b".padEnd(64, "c") + "=="]) {
      expect(dramaImportSchema.safeParse({ ...query, platformDramaId: bad }).success).toBe(false);
    }
  });
});

describe("dramaInputSchema tags", () => {
  it("leaves tags out when not sent and caps them", () => {
    expect(dramaInputSchema.parse(drama).tags).toBeUndefined();
    expect(dramaInputSchema.parse({ ...drama, tags: [" CEO "] }).tags).toEqual(["CEO"]);
    expect(dramaInputSchema.safeParse({ ...drama, tags: Array.from({ length: 21 }, (_, n) => `t${n}`) }).success).toBe(false);
  });
});

describe("dramaInputSchema promoTargetUrl", () => {
  it("is optional, clears when empty, and takes only https", () => {
    expect(dramaInputSchema.parse(drama).promoTargetUrl).toBeNull();
    expect(dramaInputSchema.parse({ ...drama, promoTargetUrl: " " }).promoTargetUrl).toBeNull();
    expect(dramaInputSchema.parse({ ...drama, promoTargetUrl: " https://reelslink.com/cps/4REYqy " }).promoTargetUrl).toBe(
      "https://reelslink.com/cps/4REYqy",
    );
    expect(dramaInputSchema.safeParse({ ...drama, promoTargetUrl: "http://reelslink.com/cps/4REYqy" }).success).toBe(false);
    expect(dramaInputSchema.safeParse({ ...drama, promoTargetUrl: "reelslink.com/cps/4REYqy" }).success).toBe(false);
    // URL parses these, but the database CHECK wants a literal lowercase "https://".
    for (const url of ["HTTPS://reelslink.com/cps/4REYqy", "https:reelslink.com/cps", "https:\\\\reelslink.com/cps"]) {
      expect(dramaInputSchema.safeParse({ ...drama, promoTargetUrl: url }).success).toBe(false);
    }
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

  it("takes a 推荐文案 alone, trims it, and clears it when empty", () => {
    expect(assetUpdateSchema.parse({ caption: "  🎬 EP1\nThe sea took her family.  ", hashtags: ["#FamilyLove", "MoboReels"] })).toEqual({
      caption: "🎬 EP1\nThe sea took her family.",
      hashtags: ["FamilyLove", "MoboReels"],
    });
    expect(assetUpdateSchema.parse({ caption: "   ", hashtags: [] })).toEqual({ caption: null, hashtags: [] });
    expect(assetUpdateSchema.parse({ caption: null })).toEqual({ caption: null });
    // Counted in characters, as Postgres counts them: an emoji is one.
    expect(assetUpdateSchema.safeParse({ caption: "🎬".repeat(2200) }).success).toBe(true);
    expect(assetUpdateSchema.safeParse({ caption: "a".repeat(2201) }).success).toBe(false);
  });

  it("refuses a hashtag that is not one, and more than 30", () => {
    expect(assetUpdateSchema.safeParse({ hashtags: ["Family Love"] }).success).toBe(false);
    expect(assetUpdateSchema.safeParse({ hashtags: ["#"] }).success).toBe(false);
    expect(assetUpdateSchema.safeParse({ hashtags: ["love-story"] }).success).toBe(false);
    expect(assetUpdateSchema.safeParse({ hashtags: Array.from({ length: 31 }, (_, i) => `t${i}`) }).success).toBe(false);
    expect(assetUpdateSchema.parse({ hashtags: ["爱情", "Amor_Eterno", "MoboReels2026"] }).hashtags).toEqual([
      "爱情",
      "Amor_Eterno",
      "MoboReels2026",
    ]);
  });
});

describe("parseHashtags", () => {
  it("reads tags typed with or without #, split by spaces, commas or lines, each once", () => {
    expect(parseHashtags("#FamilyLove #WitchPact, FantasyDrama，＃MoboReels\n#familylove")).toEqual({
      tags: ["FamilyLove", "WitchPact", "FantasyDrama", "MoboReels"],
      invalid: [],
    });
    expect(parseHashtags("  ")).toEqual({ tags: [], invalid: [] });
  });

  it("names what is not a hashtag instead of saving it", () => {
    expect(parseHashtags("#Love #dark-fantasy 🎬 #")).toEqual({ tags: ["Love"], invalid: ["#dark-fantasy", "🎬", "#"] });
  });
});

describe("splitCaption", () => {
  it("moves the trailing #tag lines of a pasted post into the hashtags", () => {
    const post = [
      "🎬 A Thousand Wishes To Bring Them Back - EP1",
      "",
      "The sea took her husband and daughter. 🕯️💔",
      "",
      "How much would you sacrifice to see your family again?",
      "",
      "#FamilyLove #WitchPact #FantasyDrama #MoboReels",
      "",
    ].join("\r\n");
    expect(splitCaption(post)).toEqual({
      caption: [
        "🎬 A Thousand Wishes To Bring Them Back - EP1",
        "",
        "The sea took her husband and daughter. 🕯️💔",
        "",
        "How much would you sacrifice to see your family again?",
      ].join("\n"),
      hashtags: "#FamilyLove #WitchPact #FantasyDrama #MoboReels",
    });
  });

  it("keeps a # inside a sentence, and a caption with no tags as it is", () => {
    expect(splitCaption("Episode #3 is the twist.\n#Twist")).toEqual({ caption: "Episode #3 is the twist.", hashtags: "#Twist" });
    expect(splitCaption("Just words.")).toEqual({ caption: "Just words.", hashtags: "" });
    expect(splitCaption("#OnlyTags #Here")).toEqual({ caption: "", hashtags: "#OnlyTags #Here" });
    expect(splitCaption("")).toEqual({ caption: "", hashtags: "" });
  });
});
