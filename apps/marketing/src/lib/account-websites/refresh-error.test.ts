import { describe, expect, it } from "vitest";
import { profileRefreshReason } from "./refresh-error.ts";

describe("naming why a Profile scan failed", () => {
  it("names a site that cannot be reached, which a generic failure hid", () => {
    expect(profileRefreshReason({ error: { code: "entry_unreachable" } }, 502)).toBe("entryUnreachable");
  });
  it("separates our own limit from the target's", () => {
    expect(profileRefreshReason({ error: { code: "rate_limited" } }, 429)).toBe("rateLimited");
    expect(profileRefreshReason({ error: { code: "rate_limited_by_target" } }, 429)).toBe("rateLimitedByTarget");
  });
  it("treats every rejected-address code as one actionable cause", () => {
    for (const code of ["invalid_target", "invalid_url", "protocol_downgrade_rejected"]) {
      expect(profileRefreshReason({ error: { code } }, 400)).toBe("invalidTarget");
    }
  });
  it("does not blame the website address for a request the origin check refused", () => {
    expect(profileRefreshReason({ error: { code: "invalid_origin" } }, 403)).toBeNull();
  });
  it("falls back to the status only where the status carries the meaning", () => {
    expect(profileRefreshReason({}, 429)).toBe("rateLimited");
    expect(profileRefreshReason({}, 503)).toBe("unavailable");
    expect(profileRefreshReason({}, 500)).toBeNull();
    expect(profileRefreshReason(null, 400)).toBeNull();
  });
  it("does not guess a cause from an unknown code", () => {
    expect(profileRefreshReason({ error: { code: "something_new" } }, 500)).toBeNull();
    expect(profileRefreshReason({ error: { code: 7 } }, 500)).toBeNull();
  });
});
