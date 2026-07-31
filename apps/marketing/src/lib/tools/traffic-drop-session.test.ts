import { afterEach, describe, expect, it } from "vitest";

import {
  isGoogleConnectEnabled,
  isGoogleConnectInviteOnly,
} from "./traffic-drop-session.ts";

afterEach(() => {
  delete process.env.MARKETING_GSC_CONNECT_ENABLED;
  delete process.env.MARKETING_GSC_INVITE_ONLY;
});

describe("connect flags", () => {
  it("keeps the connect flow closed unless it is explicitly opened", () => {
    expect(isGoogleConnectEnabled()).toBe(false);

    process.env.MARKETING_GSC_CONNECT_ENABLED = "yes";
    expect(isGoogleConnectEnabled()).toBe(false);

    process.env.MARKETING_GSC_CONNECT_ENABLED = "true";
    expect(isGoogleConnectEnabled()).toBe(true);
  });

  it("assumes invite-only until told otherwise", () => {
    // While Google's consent screen sits in Testing, an uninvited visitor is
    // stopped by Google with an unverified-app message. Defaulting the other
    // way would mean a misconfiguration sends strangers into that page, so the
    // flag has to be turned OFF deliberately, once the screen is published.
    expect(isGoogleConnectInviteOnly()).toBe(true);

    process.env.MARKETING_GSC_INVITE_ONLY = "true";
    expect(isGoogleConnectInviteOnly()).toBe(true);

    process.env.MARKETING_GSC_INVITE_ONLY = "false";
    expect(isGoogleConnectInviteOnly()).toBe(false);
  });
});
