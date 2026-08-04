import { describe, expect, it } from "vitest";

import {
  draftModelFromEnv,
  draftsEnabled,
} from "./quick-wins-draft-config.ts";

const FULL = {
  QUICK_WINS_DRAFT_API_KEY: "sk-test",
  QUICK_WINS_DRAFT_MODEL: "test-model",
};

describe("draftModelFromEnv", () => {
  it("needs both the key and the model", () => {
    // Either one alone is a half-configured deployment, and a run that tries
    // the model call with a missing half fails per row instead of skipping the
    // work up front.
    expect(draftModelFromEnv({})).toBeNull();
    expect(
      draftModelFromEnv({ QUICK_WINS_DRAFT_API_KEY: "sk-test" }),
    ).toBeNull();
    expect(
      draftModelFromEnv({ QUICK_WINS_DRAFT_MODEL: "test-model" }),
    ).toBeNull();
  });

  it("treats an empty string as absent", () => {
    // A variable set to "" in a dashboard looks configured and is not.
    expect(
      draftModelFromEnv({ ...FULL, QUICK_WINS_DRAFT_API_KEY: "" }),
    ).toBeNull();
    expect(
      draftModelFromEnv({ ...FULL, QUICK_WINS_DRAFT_MODEL: "" }),
    ).toBeNull();
  });

  it("defaults the endpoint and lets a deployment override it", () => {
    expect(draftModelFromEnv(FULL)?.url).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
    expect(
      draftModelFromEnv({
        ...FULL,
        QUICK_WINS_DRAFT_URL: "https://gateway.internal/v1/chat",
      })?.url,
    ).toBe("https://gateway.internal/v1/chat");
  });

  it("carries the key and model through unchanged", () => {
    expect(draftModelFromEnv(FULL)).toMatchObject({
      apiKey: "sk-test",
      model: "test-model",
    });
  });
});

describe("auth scheme", () => {
  it("defaults to bearer", () => {
    expect(draftModelFromEnv(FULL)?.authScheme).toBe("bearer");
  });

  it("switches to the Azure header when asked, case-insensitively", () => {
    expect(
      draftModelFromEnv({ ...FULL, QUICK_WINS_DRAFT_AUTH_SCHEME: "api-key" })
        ?.authScheme,
    ).toBe("api-key");
    expect(
      draftModelFromEnv({ ...FULL, QUICK_WINS_DRAFT_AUTH_SCHEME: " API-Key " })
        ?.authScheme,
    ).toBe("api-key");
  });

  it("falls back to bearer on anything it does not recognize", () => {
    // A typo must not silently send the credential in a header the endpoint
    // ignores; bearer is the shape the default endpoint expects.
    expect(
      draftModelFromEnv({ ...FULL, QUICK_WINS_DRAFT_AUTH_SCHEME: "apikey" })
        ?.authScheme,
    ).toBe("bearer");
  });
});

describe("temperature", () => {
  it("defaults low, because a wording candidate should not wander", () => {
    expect(draftModelFromEnv(FULL)?.temperature).toBe(0.4);
  });

  it("takes the deployment's value", () => {
    // The Azure gpt-5.6-luna deployment accepts exactly 1.
    expect(
      draftModelFromEnv({ ...FULL, QUICK_WINS_DRAFT_TEMPERATURE: "1" })
        ?.temperature,
    ).toBe(1);
  });

  it("falls back rather than sending a value the model will refuse", () => {
    // A refused temperature fails the whole request, so a typo in a dashboard
    // would disable drafts entirely with no obvious cause.
    for (const bad of ["", "  ", "hot", "-1", "3", "NaN"]) {
      expect(
        draftModelFromEnv({ ...FULL, QUICK_WINS_DRAFT_TEMPERATURE: bad })
          ?.temperature,
        bad,
      ).toBe(0.4);
    }
  });

  it("accepts the edges of the allowed range", () => {
    expect(
      draftModelFromEnv({ ...FULL, QUICK_WINS_DRAFT_TEMPERATURE: "0" })
        ?.temperature,
    ).toBe(0);
    expect(
      draftModelFromEnv({ ...FULL, QUICK_WINS_DRAFT_TEMPERATURE: "2" })
        ?.temperature,
    ).toBe(2);
  });
});

describe("draftsEnabled", () => {
  it("answers the same question the API asks", () => {
    // The landing page describes drafts only when this is true. It has to
    // agree with `draftModelFromEnv` exactly, or the page advertises a
    // capability the run cannot deliver — which is what it did on the day it
    // shipped.
    expect(draftsEnabled(FULL)).toBe(true);
    expect(draftsEnabled({})).toBe(false);
    expect(draftsEnabled({ QUICK_WINS_DRAFT_API_KEY: "sk-test" })).toBe(false);
  });
});
