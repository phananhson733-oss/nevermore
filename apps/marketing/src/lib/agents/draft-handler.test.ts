// @input  -- draft requests against a stubbed model and quota
// @output -- proof the boundary refuses before it spends, and refuses a bad reply
// @pos    -- unit coverage for the Stage 04 draft endpoint

import { describe, expect, it, vi } from "vitest";
import {
  handleAgentDraftRequest,
  type DraftHandlerDependencies,
} from "./draft-handler.ts";

function request(body: unknown = validBody()): Request {
  return new Request("https://gengrowth.ai/api/agents/seo/draft", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-real-ip": "203.0.113.9",
    },
    body: JSON.stringify(body),
  });
}

function validBody() {
  return {
    kind: "search-presentation",
    url: "https://acme.test/chart",
    title: "Chart",
    metaDescription: "A chart page",
    headings: ["Chart"],
    targetQuery: "natal chart",
    pageType: "tool",
    openingText: "Enter a birth date.",
  };
}

const GOOD_REPLY = JSON.stringify({
  title: "Free natal chart calculator",
  metaDescription: "Draw your natal chart from a birth date and time.",
  openingLine: "Enter a birth date to draw your chart.",
});

function dependencies(
  overrides: Partial<DraftHandlerDependencies> = {},
): DraftHandlerDependencies {
  return {
    authenticate: async () => "authenticated" as const,
    consumeQuota: async () => ({ kind: "allowed" }) as const,
    createCompletion: () => async () => ({ text: GOOD_REPLY }),
    ...overrides,
  };
}

describe("handleAgentDraftRequest", () => {
  it("returns the draft for an authenticated caller", async () => {
    const response = await handleAgentDraftRequest(request(), dependencies());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        draft: {
          kind: "search-presentation",
          title: "Free natal chart calculator",
          metaDescription: "Draw your natal chart from a birth date and time.",
          openingLine: "Enter a birth date to draw your chart.",
        },
      },
    });
  });

  it("refuses before it spends anything", async () => {
    const createCompletion = vi.fn(() => async () => ({ text: GOOD_REPLY }));
    const consumeQuota = vi.fn(async () => ({ kind: "allowed" }) as const);
    const response = await handleAgentDraftRequest(
      request(),
      dependencies({
        authenticate: async () => "unauthenticated" as const,
        consumeQuota,
        createCompletion,
      }),
    );

    expect(response.status).toBe(401);
    // Order matters more than the code: an unauthenticated caller must not
    // reach the quota store, let alone the model.
    expect(consumeQuota).not.toHaveBeenCalled();
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it("does not call the model for a request it cannot read", async () => {
    const createCompletion = vi.fn(() => async () => ({ text: GOOD_REPLY }));
    const response = await handleAgentDraftRequest(
      request({ ...validBody(), kind: "content-brief" }),
      dependencies({ createCompletion }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_request" },
    });
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it("answers a spent budget with the wait, not a generic failure", async () => {
    const createCompletion = vi.fn(() => async () => ({ text: GOOD_REPLY }));
    const response = await handleAgentDraftRequest(
      request(),
      dependencies({
        consumeQuota: async () => ({
          kind: "limited",
          retryAfterSeconds: 900,
        }),
        createCompletion,
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("900");
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it("says drafts are unavailable when no model is configured", async () => {
    const response = await handleAgentDraftRequest(
      request(),
      dependencies({ createCompletion: () => null }),
    );

    expect(response.status).toBe(503);
    // Not a failure of this request: a retry cannot succeed, and telling the
    // visitor to try again would be a lie about what is wrong.
    await expect(response.json()).resolves.toEqual({
      error: { code: "drafts_unavailable" },
    });
  });

  it.each([
    ["a reply that is not the shape", async () => ({ text: "Sure! Here you go" })],
    [
      "a call that throws",
      async () => {
        throw new Error("429 from the model");
      },
    ],
  ])("refuses %s rather than showing part of one", async (_label, complete) => {
    const response = await handleAgentDraftRequest(
      request(),
      dependencies({
        createCompletion: () =>
          complete as (prompt: string) => Promise<{ readonly text: string }>,
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "draft_unusable" },
    });
  });

  it("gives the model the page's own text and its own deadline", async () => {
    let seen = "";
    let remaining = -1;
    await handleAgentDraftRequest(
      request(),
      dependencies({
        createCompletion: (remainingMs) => {
          remaining = remainingMs();
          return async (prompt: string) => {
            seen = prompt;
            return { text: GOOD_REPLY };
          };
        },
      }),
    );

    expect(seen).toContain("https://acme.test/chart");
    expect(seen).toContain("natal chart");
    // A draft rides its own clock, so it can never be the reason something
    // else ran past the platform limit.
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(30_000);
  });
});
