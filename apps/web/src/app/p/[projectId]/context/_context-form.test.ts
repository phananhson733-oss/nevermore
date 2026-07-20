import { describe, expect, it } from "vitest";
import { mapContextFieldErrors } from "./_context-form-errors";

describe("mapContextFieldErrors", () => {
  it("replaces server field messages with the localized qualification warning", () => {
    expect(
      mapContextFieldErrors(
        [
          { pointer: "/productName" },
          { pointer: "/personas/0/name" },
        ],
        "localized-qualification-incomplete",
      ),
    ).toEqual({
      "/productName": "localized-qualification-incomplete",
      "/personas/0/name": "localized-qualification-incomplete",
    });
  });

  it("keeps the first localized message per pointer", () => {
    expect(
      mapContextFieldErrors(
        [
          { pointer: "/productName" },
          { pointer: "/productName" },
        ],
        "localized-qualification-incomplete",
      ),
    ).toEqual({
      "/productName": "localized-qualification-incomplete",
    });
  });
});
