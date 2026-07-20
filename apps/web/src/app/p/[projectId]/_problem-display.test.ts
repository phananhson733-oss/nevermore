import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { summarizeProblem } from "./_problem-summary";

describe("summarizeProblem", () => {
  it("keeps the safe message and exposes stable problem metadata", () => {
    const error = new ApiError({
      type: "about:blank",
      title: "Service unavailable",
      status: 503,
      code: "DEPENDENCY_UNAVAILABLE",
      detail: "raw upstream credential detail",
      requestId: "req-123",
    });

    expect(summarizeProblem(error, "Something went wrong")).toEqual({
      message: "Something went wrong",
      code: "DEPENDENCY_UNAVAILABLE",
      requestId: "req-123",
    });
  });

  it("drops empty request ids and handles unknown errors", () => {
    const error = new ApiError({
      type: "about:blank",
      title: "Conflict",
      status: 409,
      code: "VERSION_CONFLICT",
      detail: "stale write",
      requestId: "   ",
    });

    expect(summarizeProblem(error, "Try again")).toEqual({
      message: "Try again",
      code: "VERSION_CONFLICT",
      requestId: null,
    });
    expect(summarizeProblem(new Error("boom"), "Generic safe text")).toEqual({
      message: "Generic safe text",
      code: null,
      requestId: null,
    });
  });
});
