import { afterEach, describe, expect, it } from "vitest";

import {
  isGoogleConnectEnabled,
  readGoogleConsentNotice,
} from "./traffic-drop-session.ts";

afterEach(() => {
  delete process.env.MARKETING_GSC_CONNECT_ENABLED;
  delete process.env.MARKETING_GSC_CONSENT_NOTICE;
});

describe("connect flags", () => {
  it("keeps the connect flow closed unless it is explicitly opened", () => {
    expect(isGoogleConnectEnabled()).toBe(false);

    process.env.MARKETING_GSC_CONNECT_ENABLED = "yes";
    expect(isGoogleConnectEnabled()).toBe(false);

    process.env.MARKETING_GSC_CONNECT_ENABLED = "true";
    expect(isGoogleConnectEnabled()).toBe(true);
  });

  it("assumes the most restrictive consent notice until told otherwise", () => {
    // A visitor who reads a warning that did not apply loses a few seconds; a
    // visitor sent unprepared into Google's block page cannot recover at all.
    // So the softer states have to be set deliberately, as the consent screen
    // actually advances — never inferred.
    expect(readGoogleConsentNotice()).toBe("invite_only");

    process.env.MARKETING_GSC_CONSENT_NOTICE = "";
    expect(readGoogleConsentNotice()).toBe("invite_only");

    process.env.MARKETING_GSC_CONSENT_NOTICE = "published";
    expect(readGoogleConsentNotice()).toBe("invite_only");
  });

  it("reads the two advanced states exactly", () => {
    process.env.MARKETING_GSC_CONSENT_NOTICE = "unverified";
    expect(readGoogleConsentNotice()).toBe("unverified");

    process.env.MARKETING_GSC_CONSENT_NOTICE = "none";
    expect(readGoogleConsentNotice()).toBe("none");
  });
});
