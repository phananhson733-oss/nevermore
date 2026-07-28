import { describe, expect, it } from "vitest";
import { ContentShadowRunResponse } from "../packages/contracts/src/zod/content-shadow.ts";
import { contentShadowRunResponseFixture } from "./content-shadow-vertical-fixture.ts";

describe("Content Shadow vertical fixture", () => {
  it("is a production-valid ContentShadowRunResponse projection", () => {
    const response = contentShadowRunResponseFixture({
      draftRevision: 1,
      draftStatus: "draft",
    });

    expect(ContentShadowRunResponse.parse(response)).toEqual(response);
  });
});
