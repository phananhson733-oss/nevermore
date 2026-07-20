import { describe, expect, it } from "vitest";
import { loginErrorMessageKey } from "./_form-state";

describe("loginErrorMessageKey", () => {
  it("maps any sign-in failure to the localized generic login error", () => {
    expect(loginErrorMessageKey({ errorCode: "SIGN_IN_ERROR" })).toBe(
      "signInError",
    );
  });

  it("omits the banner when no error code is present", () => {
    expect(loginErrorMessageKey({ errorCode: null })).toBeNull();
  });
});
