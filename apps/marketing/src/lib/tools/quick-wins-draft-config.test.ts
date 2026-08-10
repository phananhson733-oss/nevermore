import { describe, expect, it } from "vitest";

import { draftModelFromEnv, draftsEnabled } from "./quick-wins-draft-config.ts";

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
  it("defaults to sending none at all", () => {
    // Measured against the real Azure gpt-5.6-luna deployment: a request
    // carrying `temperature: 0.4` comes back 400 `unsupported_value` — "Only
    // the default (1) value is supported" — so the old low default disabled
    // drafts outright on any reasoning model. Omitting the field works on
    // every endpoint this can point at, and the wording candidates it
    // produced in that state were stable anyway.
    expect(draftModelFromEnv(FULL)?.temperature).toBeNull();
  });

  it("takes the deployment's value when one is set", () => {
    expect(
      draftModelFromEnv({ ...FULL, QUICK_WINS_DRAFT_TEMPERATURE: "1" })
        ?.temperature,
    ).toBe(1);
  });

  it("omits the field rather than sending a value the model will refuse", () => {
    // A refused temperature fails the whole request, so a typo in a dashboard
    // would disable drafts entirely with no obvious cause.
    for (const bad of ["", "  ", "hot", "-1", "3", "NaN"]) {
      expect(
        draftModelFromEnv({ ...FULL, QUICK_WINS_DRAFT_TEMPERATURE: bad })
          ?.temperature,
        bad,
      ).toBeNull();
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

describe("json mode", () => {
  it("defaults to on", () => {
    // Asking for a JSON object is what stops a chatty model from wrapping the
    // draft in a sentence, which is the failure the live tool was showing as
    // "the draft came back in a format we cannot use".
    expect(draftModelFromEnv(FULL)?.jsonMode).toBe(true);
  });

  it("can be turned off for an endpoint that refuses the field", () => {
    // Not every gateway supports `response_format`. One that does not answers
    // 400 for every request, so the switch has to exist.
    for (const off of ["0", "false", "FALSE", " off "]) {
      expect(
        draftModelFromEnv({ ...FULL, QUICK_WINS_DRAFT_JSON_MODE: off })
          ?.jsonMode,
        off,
      ).toBe(false);
    }
  });

  it("stays on for anything it does not recognize", () => {
    expect(
      draftModelFromEnv({ ...FULL, QUICK_WINS_DRAFT_JSON_MODE: "yes" })
        ?.jsonMode,
    ).toBe(true);
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
