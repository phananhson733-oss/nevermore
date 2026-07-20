import { describe, expect, it } from "vitest";
import { mapProjectFieldErrors } from "./_form-errors";

describe("mapProjectFieldErrors", () => {
  const messages = {
    siteUrlInvalid: "localized-site-url",
    createError: "localized-create-error",
  } as const;

  it("maps siteUrl to the dedicated localized validation copy", () => {
    expect(
      mapProjectFieldErrors(
        [{ pointer: "/siteUrl" }],
        messages,
      ),
    ).toEqual({
      fieldErrors: { siteUrl: "localized-site-url" },
      generalError: null,
    });
  });

  it("maps all other field pointers to the generic localized create error", () => {
    expect(
      mapProjectFieldErrors(
        [
          { pointer: "/clientName" },
          { pointer: "/marketCodes/0" },
        ],
        messages,
      ),
    ).toEqual({
      fieldErrors: {
        clientName: "localized-create-error",
        marketCodes: "localized-create-error",
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
