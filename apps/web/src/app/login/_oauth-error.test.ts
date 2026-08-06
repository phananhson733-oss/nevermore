import { describe, expect, it } from "vitest";

import { oauthErrorMessageKey } from "./_oauth-error.ts";

/**
 * `?error=` is attacker-reachable — anyone can send a link to /login?error=… —
 * so this is an allowlist, and anything unrecognised must render nothing rather
 * than claim a failure that did not happen.
 */
describe("oauthErrorMessageKey", () => {
  it("maps the two markers the callback actually emits", () => {
    expect(oauthErrorMessageKey("oauth")).toBe("oauthError");
    expect(oauthErrorMessageKey("oauth_denied")).toBe("oauthDenied");
  });

  it.each([
    null,
    undefined,
    "",
    "OAUTH",
    "signInError",
    "<script>alert(1)</script>",
    ["oauth"],
    { error: "oauth" },
    42,
  ])("renders nothing for the unrecognised value %p", (raw) => {
    expect(oauthErrorMessageKey(raw)).toBeNull();
  });
});
