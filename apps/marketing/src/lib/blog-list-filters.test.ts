import { describe, expect, it } from "vitest";
import type { BlogPost } from "../types/blog";
import { resolveBlogListFilters } from "./blog-list-filters";

function post(category: BlogPost["category"], pillar_slug: string): BlogPost {
  return { category, pillar_slug } as BlogPost;
}

const posts = [
  post("case_study", "customer_stories"),
  post("methodology", "seo_content"),
  post("experiment_log", "experiment_driven"),
];

describe("resolveBlogListFilters", () => {
  it("drops stale filters so deeper pages remain unfiltered", () => {
    expect(resolveBlogListFilters(posts, "retired_topic", undefined)).toMatchObject(
      {
        validCategory: undefined,
        validPillar: undefined,
      },
    );
  });

  it("keeps a valid filtered view", () => {
    expect(resolveBlogListFilters(posts, "methodology", undefined)).toMatchObject(
      {
        validCategory: "methodology",
        validPillar: undefined,
      },
    );
  });

  it("drops an impossible category and pillar combination together", () => {
    expect(
      resolveBlogListFilters(posts, "case_study", "seo_content"),
    ).toMatchObject({ validCategory: undefined, validPillar: undefined });
  });
});
