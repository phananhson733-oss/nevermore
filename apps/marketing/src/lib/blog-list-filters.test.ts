import { describe, expect, it } from "vitest";
import type { BlogPost } from "../types/blog";
import {
  parseBlogPageParam,
  resolveBlogListFilters,
} from "./blog-list-filters";

function post(category: BlogPost["category"], pillar_slug: string): BlogPost {
  return { category, pillar_slug } as BlogPost;
}

const posts = [
  post("case_study", "customer_stories"),
  post("methodology", "seo_content"),
  post("experiment_log", "experiment_driven"),
];

describe("resolveBlogListFilters", () => {
  it("marks an unknown value for a known filter as invalid", () => {
    expect(resolveBlogListFilters(posts, "retired_topic", undefined)).toMatchObject(
      {
        invalid: true,
        validCategory: undefined,
        validPillar: undefined,
      },
    );
  });

  it("keeps a valid filtered view", () => {
    expect(resolveBlogListFilters(posts, "methodology", undefined)).toMatchObject(
      {
        invalid: false,
        validCategory: "methodology",
        validPillar: undefined,
      },
    );
  });

  it("marks an impossible category and pillar combination as invalid", () => {
    expect(
      resolveBlogListFilters(posts, "case_study", "seo_content"),
    ).toMatchObject({
      invalid: true,
      validCategory: undefined,
      validPillar: undefined,
    });
  });
});

describe("parseBlogPageParam", () => {
  it.each([
    [undefined, { ok: true, page: 1 }],
    ["1", { ok: true, page: 1 }],
    ["42", { ok: true, page: 42 }],
  ])("accepts %s", (raw, expected) => {
    expect(parseBlogPageParam(raw)).toEqual(expected);
  });

  it.each(["", "0", "-1", "01", "1.5", "abc", "9007199254740992"])(
    "rejects %s",
    (raw) => {
      expect(parseBlogPageParam(raw)).toEqual({ ok: false });
    },
  );
});
