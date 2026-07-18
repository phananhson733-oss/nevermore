import { describe, expect, it } from "vitest";
import { CLUSTER_KEY_VERSION, clusterKey } from "./cluster-key.ts";

describe("clusterKey (cluster_key.v1)", () => {
  it("exposes a versioned identity", () => {
    expect(CLUSTER_KEY_VERSION).toBe("cluster_key.v1");
  });

  it("NFKC-folds and lowercases full-width input", () => {
    // Full-width letters + an ideographic space (U+3000) fold to "seo tools".
    expect(clusterKey("ＳＥＯ\u3000Ｔｏｏｌｓ")).toBe("seo tools");
  });

  it("removes English stopwords before selecting tokens", () => {
    expect(clusterKey("the best seo tool")).toBe("best seo");
  });

  it("keeps the first two tokens of length >= 3 in original order", () => {
    // "go" (len 2) is skipped because two longer tokens exist.
    expect(clusterKey("go seo tools guide")).toBe("seo tools");
  });

  it("falls back to ALL remaining tokens when fewer than two are >= 3 chars", () => {
    expect(clusterKey("go ai")).toBe("go ai");
    expect(clusterKey("big ai")).toBe("big ai");
  });

  it("rejects a keyword with no tokens after processing", () => {
    expect(clusterKey("the a an")).toBeNull();
    expect(clusterKey("!!! ??? ---")).toBeNull();
    expect(clusterKey("   ")).toBeNull();
  });

  it("is deterministic across punctuation and spacing variants", () => {
    expect(clusterKey("SEO Tools")).toBe(clusterKey("seo   tools!!"));
    expect(clusterKey("seo-tools")).toBe(clusterKey("seo tools"));
  });

  it("treats digit-bearing tokens by length like any other token", () => {
    expect(clusterKey("top 10 seo tools")).toBe("top seo");
  });
});
