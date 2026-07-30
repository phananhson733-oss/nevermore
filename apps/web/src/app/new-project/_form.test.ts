import { describe, expect, it } from "vitest";
import { mapProjectFieldErrors } from "./_form-errors";

describe("mapProjectFieldErrors", () => {
  const messages = {
    productUrlInvalid: "localized-product-url",
    createError: "localized-create-error",
  } as const;

  it("maps productUrl to the dedicated localized validation copy", () => {
    expect(
      mapProjectFieldErrors(
        [{ pointer: "/productUrl" }],
        messages,
      ),
    ).toEqual({
      fieldErrors: { productUrl: "localized-product-url" },
      generalError: null,
    });
  });

  it("maps all other field pointers to the generic localized create error", () => {
    expect(
      mapProjectFieldErrors(
        [
          { pointer: "/businessHint" },
        ],
        messages,
      ),
    ).toEqual({
      fieldErrors: {
        businessHint: "localized-create-error",
      },
      generalError: null,
    });
  });

  it("sets the general localized error when no known field pointer is available", () => {
    expect(
      mapProjectFieldErrors(
        [{ pointer: "/unknown" }],
        messages,
      ),
    ).toEqual({
      fieldErrors: {},
      generalError: "localized-create-error",
    });
  });
});
