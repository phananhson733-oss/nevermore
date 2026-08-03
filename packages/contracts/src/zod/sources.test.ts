import { describe, expect, it } from "vitest";
import { AuthorizeSourceRequest } from "./sources";

describe("AuthorizeSourceRequest return paths", () => {
  const projectId = "00000000-0000-8000-8000-000000000001";

  it.each(["sources", "setup-sources"])(
    "accepts the same-project %s destination",
    (segment) => {
      expect(
        AuthorizeSourceRequest.safeParse({
          phase: "authorize",
          returnPath: `/p/${projectId}/${segment}`,
        }).success,
      ).toBe(true);
    },
  );

  it.each([
    `/p/${projectId}/setup-sources?next=foreign`,
    `/p/${projectId}/context`,
    `/p/${projectId}/sources/extra`,
    "https://attacker.example/callback",
  ])("rejects non-allowlisted return path %s", (returnPath) => {
    expect(
      AuthorizeSourceRequest.safeParse({ phase: "authorize", returnPath })
        .success,
    ).toBe(false);
  });
});
