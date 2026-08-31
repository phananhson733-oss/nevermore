import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 32 bytes of hex, matching the shape of the deployed key. Set before the
// fixtures below are sealed.
process.env.TOKEN_ENCRYPTION_KEY = "9c".repeat(32);

/**
 * The visitor's cookies, without a request.
 *
 * `readTrafficDropSession` is what a page render calls, so the seam that has to
 * be exercised is the real `next/headers` one — a hand-rolled jar would test a
 * function this module does not use.
 */
const cookieStore = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = cookieStore.get(name);
        return value === undefined ? undefined : { name, value };
      },
      set: (name: string, value: string) => {
        cookieStore.set(name, value);
      },
      delete: ({ name }: { name: string }) => {
        cookieStore.delete(name);
      },
    }),
}));

import { seal } from "../auth/sealed-cookie.ts";
import * as googleOAuth from "../auth/google-oauth.ts";
import {
  isGoogleConnectEnabled,
  readGoogleConsentNotice,
  readTrafficDropSession,
  resolveTrafficDropGrant,
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

  it("claims no consent-screen restriction when none is declared", () => {
    // This used to default to `invite_only` on an over-warn argument, which
    // held while the screen's real state was unknown. It is known now, so that
    // default became a false statement: it tells every visitor they are
    // probably not on a tester list that is not gating anything, and demotes
    // the authorize link that in fact works for them.
    expect(readGoogleConsentNotice()).toBe("none");

    process.env.MARKETING_GSC_CONSENT_NOTICE = "";
    expect(readGoogleConsentNotice()).toBe("none");

    process.env.MARKETING_GSC_CONSENT_NOTICE = "   ";
    expect(readGoogleConsentNotice()).toBe("none");
  });

  it("reads the two declared states exactly", () => {
    process.env.MARKETING_GSC_CONSENT_NOTICE = "invite_only";
    expect(readGoogleConsentNotice()).toBe("invite_only");

    process.env.MARKETING_GSC_CONSENT_NOTICE = "none";
    expect(readGoogleConsentNotice()).toBe("none");
  });

  it("maps the retired unverified value to no notice", () => {
    // Google shows the "app isn't verified" interstitial for unapproved
    // sensitive scopes; this flow requests none. Production still carries this
    // value, and treating it cautiously would resurrect the invite-only copy
    // this change removes.
    process.env.MARKETING_GSC_CONSENT_NOTICE = "unverified";
    expect(readGoogleConsentNotice()).toBe("none");
  });

  it.each(["invite-only", "inviteOnly", "INVITE_ONLY", "published", "off"])(
    "falls back to the cautious notice for the unrecognized value %p",
    (value) => {
      // A typo says nothing about the consent screen. Answering "nothing
      // unusual" to it would be a guess made in the visitor's name, and the
      // cost of being wrong is asymmetric: a needless warning wastes seconds,
      // an unwarned visitor hits a block page they cannot get past.
      process.env.MARKETING_GSC_CONSENT_NOTICE = value;
      expect(readGoogleConsentNotice()).toBe("invite_only");
    },
  );
});

const PROPERTY = "sc-domain:example.com";
const SUB = "108000000000000000001";

describe("API property refresh through the Next cookie seam", () => {
  beforeEach(() => {
    process.env.MARKETING_GSC_CONNECT_ENABLED = "true";
    cookieStore.set("gg_id", seal("gg_id", { sub: SUB }, 3_600));
    cookieStore.set(
      "gg_sites",
      seal("gg_sites", { properties: [PROPERTY], total: 1 }, 3_600),
    );
    cookieStore.set("gg_gsc", seal(
      "gg_gsc",
      {
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        sub: SUB,
        accessTokenExpiresAt: Math.floor(Date.now() / 1_000) + 3_600,
        grantedAt: Math.floor(Date.now() / 1_000) - 60,
      },
      3_600,
    ));
  });

  afterEach(() => {
    cookieStore.clear();
    vi.restoreAllMocks();
  });

  it("refreshes unexpired properties and exposes the saved list to the next page render", async () => {
    const properties = [PROPERTY, "sc-domain:new-site.example"];
    const list = vi.spyOn(googleOAuth, "listSearchConsoleProperties")
      .mockResolvedValue(properties);
    const refresh = vi.spyOn(googleOAuth, "refreshAccessToken");
    const identity = cookieStore.get("gg_id");

    await expect(resolveTrafficDropGrant({ refreshProperties: true }))
      .resolves.toMatchObject({ properties, propertyTotal: 2 });
    await expect(readTrafficDropSession()).resolves.toMatchObject({
      properties, propertyTotal: 2,
    });
    expect(list).toHaveBeenCalledExactlyOnceWith({
      accessToken: "test-access-token",
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(cookieStore.get("gg_id")).toBe(identity);
  });

  it("keeps ordinary unexpired report grant resolution free of provider calls", async () => {
    const list = vi.spyOn(googleOAuth, "listSearchConsoleProperties");
    const refresh = vi.spyOn(googleOAuth, "refreshAccessToken");
    await expect(resolveTrafficDropGrant()).resolves.toMatchObject({
      properties: [PROPERTY],
    });
    expect(list).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not refresh properties when Google connection is disabled", async () => {
    process.env.MARKETING_GSC_CONNECT_ENABLED = "false";
    const list = vi.spyOn(googleOAuth, "listSearchConsoleProperties");
    await expect(resolveTrafficDropGrant({ refreshProperties: true }))
      .resolves.toEqual({ kind: "none" });
    expect(list).not.toHaveBeenCalled();
  });

  it("preserves the page cookie and identity when listing temporarily fails", async () => {
    vi.spyOn(googleOAuth, "listSearchConsoleProperties")
      .mockRejectedValue(new Error("upstream temporarily unavailable"));
    const previous = new Map(cookieStore);
    await expect(resolveTrafficDropGrant({ refreshProperties: true }))
      .resolves.toEqual({ kind: "unavailable" });
    expect(cookieStore).toEqual(previous);
  });
});

describe("the tool page on a deployment whose cookie key cannot be built", () => {
  const CONFIGURED_KEY = process.env.TOKEN_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.MARKETING_GSC_CONNECT_ENABLED = "true";
    cookieStore.set(
      "gg_sites",
      seal("gg_sites", { properties: [PROPERTY], total: 1 }, 3_600),
    );
    cookieStore.set(
      "gg_id",
      seal("gg_id", { sub: SUB, email: "owner@example.com" }, 3_600),
    );
  });

  afterEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = CONFIGURED_KEY;
    cookieStore.clear();
    vi.restoreAllMocks();
  });

  it("reads a connected visitor's own properties while the key is right", () => {
    // The control for the two below: without it they would pass on a session
    // that was never connected in the first place.
    return expect(readTrafficDropSession()).resolves.toMatchObject({
      properties: [PROPERTY],
      propertyTotal: 1,
    });
  });

  it("renders as not connected instead of failing the page render", async () => {
    // The pages that would 500 are the connected tools, and the disconnect
    // control lives on them — so a throw here locks out exactly the visitors
    // holding a credential they can no longer use. They see the connect entry
    // point instead.
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.TOKEN_ENCRYPTION_KEY;

    await expect(readTrafficDropSession()).resolves.toMatchObject({
      properties: null,
      propertyTotal: 0,
      connectEnabled: true,
    });
  });

  it("names the misconfiguration in the log rather than passing for a visitor with no cookie", async () => {
    // Indistinguishable to the VISITOR only. An operator reading the log has
    // to be able to tell a renamed environment variable from an ordinary
    // absent cookie, or a bad paste signs out a whole site in silence.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.TOKEN_ENCRYPTION_KEY;

    await readTrafficDropSession();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.join(" ")).toMatch(/TOKEN_ENCRYPTION_KEY/);
  });

  it("answers the tool routes with no grant instead of throwing", async () => {
    // The same key failure reaches the API path twice: once through the
    // pre-gate session read above, and once here, where the route resolves the
    // token it would run with.
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.TOKEN_ENCRYPTION_KEY;

    await expect(resolveTrafficDropGrant()).resolves.toEqual({ kind: "none" });
  });
});

describe("what the page calls connected", () => {
  const PROPERTIES = seal(
    "gg_sites",
    { properties: [PROPERTY], total: 1 },
    3_600,
  );

  beforeEach(() => {
    process.env.MARKETING_GSC_CONNECT_ENABLED = "true";
  });

  afterEach(() => {
    cookieStore.clear();
  });

  it("does not call a visitor connected when the identity binding it to the grant is gone", async () => {
    // The page cannot check the binding itself: the grant cookie is scoped to
    // /api and `gg_sites` names no account. It can check the half it CAN see,
    // and it has to — `resolveGrant` refuses a grant with no identity beside
    // it, so rendering the property picker here would promise a run the route
    // is about to refuse.
    cookieStore.set("gg_sites", PROPERTIES);

    await expect(readTrafficDropSession()).resolves.toMatchObject({
      properties: null,
      propertyTotal: 0,
    });
  });

  it("calls a visitor with both cookies connected", async () => {
    cookieStore.set("gg_sites", PROPERTIES);
    cookieStore.set("gg_id", seal("gg_id", { sub: SUB }, 3_600));

    await expect(readTrafficDropSession()).resolves.toMatchObject({
      properties: [PROPERTY],
      propertyTotal: 1,
    });
  });
});
