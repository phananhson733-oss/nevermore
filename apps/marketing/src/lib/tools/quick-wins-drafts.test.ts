import { describe, expect, it, vi } from "vitest";

import {
  allowedDraftOrigins,
  createDraftDependencies,
  draftModelFromEnv,
  isDraftCrawlable,
} from "./quick-wins-drafts.ts";

const MODEL = {
  apiKey: "sk-test",
  model: "test-model",
  authScheme: "bearer",
  temperature: null,
  jsonMode: true,
  url: "https://model.test/v1/chat/completions",
} as const;

/** One chat-completion response body, with the fields `complete` reads. */
function completion(
  content: string,
  finishReason: string | null = "stop",
): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: finishReason }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function html(title: string, description: string): Response {
  return new Response(
    `<!doctype html><html><head><title>${title}</title>` +
      `<meta name="description" content="${description}"></head><body></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

describe("allowedDraftOrigins", () => {
  it("covers the bare host and its www form for a domain property", () => {
    expect(allowedDraftOrigins("sc-domain:example.com")).toEqual([
      "https://example.com",
      "https://www.example.com",
    ]);
  });

  it("covers only its own origin for a URL-prefix property", () => {
    expect(allowedDraftOrigins("https://blog.example.com/")).toEqual([
      "https://blog.example.com",
    ]);
  });

  it("allows nothing for an http property or a malformed one", () => {
    expect(allowedDraftOrigins("http://example.com/")).toEqual([]);
    expect(allowedDraftOrigins("not a property")).toEqual([]);
    expect(allowedDraftOrigins("sc-domain:")).toEqual([]);
  });
});

describe("isDraftCrawlable", () => {
  const origins = allowedDraftOrigins("sc-domain:example.com");

  it("accepts a page inside the granted property", () => {
    expect(isDraftCrawlable("https://example.com/a", origins)).toBe(true);
    expect(isDraftCrawlable("https://www.example.com/a", origins)).toBe(true);
  });

  it("refuses anything outside it", () => {
    // The URLs come from Search Console rather than from the visitor, but
    // "came from an API response" is not "safe to fetch". A draft crawl has
    // no business leaving the property it was authorized for.
    for (const url of [
      "https://evil.test/a",
      "https://example.com.evil.test/a",
      "http://example.com/a",
      "http://169.254.169.254/latest/meta-data/",
      "file:///etc/passwd",
      "not a url",
    ]) {
      expect(isDraftCrawlable(url, origins), url).toBe(false);
    }
  });
});

describe("draftModelFromEnv", () => {
  it("returns null when either key is missing", () => {
    expect(draftModelFromEnv({})).toBeNull();
    expect(draftModelFromEnv({ QUICK_WINS_DRAFT_API_KEY: "k" })).toBeNull();
    expect(draftModelFromEnv({ QUICK_WINS_DRAFT_MODEL: "m" })).toBeNull();
  });

  it("reads a complete configuration and defaults the endpoint", () => {
    const config = draftModelFromEnv({
      QUICK_WINS_DRAFT_API_KEY: "k",
      QUICK_WINS_DRAFT_MODEL: "m",
    });

    expect(config).toMatchObject({ apiKey: "k", model: "m" });
    expect(config?.url).toContain("https://");
  });
});

describe("createDraftDependencies", () => {
  it("returns null when no model is configured", () => {
    // Absent configuration is a supported state: the evidence table does not
    // depend on a model, and the run skips two Search Console reads entirely.
    expect(
      createDraftDependencies({
        property: "sc-domain:example.com",
        model: null,
      }),
    ).toBeNull();
  });

  it("returns null when the property allows no origin", () => {
    expect(
      createDraftDependencies({
        property: "http://example.com/",
        model: MODEL,
      }),
    ).toBeNull();
  });

  it("reads a page's title and description", async () => {
    const deps = createDraftDependencies({
      property: "sc-domain:example.com",
      model: MODEL,
      fetchImpl: async () => html("A Title", "A description."),
    });

    const meta = await deps!.fetchPageMeta("https://example.com/a");

    expect(meta).toEqual({
      title: "A Title",
      metaDescription: "A description.",
    });
  });

  it("never fetches a page outside the property", async () => {
    const fetchImpl = vi.fn(async () => html("t", "d"));
    const deps = createDraftDependencies({
      property: "sc-domain:example.com",
      model: MODEL,
      fetchImpl,
    });

    const meta = await deps!.fetchPageMeta("https://evil.test/a");

    expect(meta).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null for a non-HTML or failed response instead of throwing", async () => {
    const deps = (body: Response) =>
      createDraftDependencies({
        property: "sc-domain:example.com",
        model: MODEL,
        fetchImpl: async () => body,
      })!;

    await expect(
      deps(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ).fetchPageMeta("https://example.com/a"),
    ).resolves.toBeNull();

    await expect(
      deps(new Response("nope", { status: 404 })).fetchPageMeta(
        "https://example.com/a",
      ),
    ).resolves.toBeNull();
  });

  it("sends the prompt to the configured model and returns its content", async () => {
    let seenUrl = "";
    let seenBody: Record<string, unknown> = {};
    const deps = createDraftDependencies({
      property: "sc-domain:example.com",
      model: MODEL,
      fetchImpl: async (url, init) => {
        seenUrl = String(url);
        seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return completion("reply");
      },
    });

    await expect(deps!.complete("the prompt")).resolves.toEqual({
      text: "reply",
      truncated: false,
    });
    expect(seenUrl).toBe(MODEL.url);
    expect(seenBody["model"]).toBe(MODEL.model);
  });

  it("reports a reply that hit the token ceiling as truncated", async () => {
    // The caller has to be able to tell "the model wrote something we cannot
    // read" from "we cut the model off mid-sentence". Those have different
    // fixes and only one of them is the model's fault.
    const deps = createDraftDependencies({
      property: "sc-domain:example.com",
      model: MODEL,
      fetchImpl: async () => completion('{"title":"half a dr', "length"),
    });

    await expect(deps!.complete("p")).resolves.toEqual({
      text: '{"title":"half a dr',
      truncated: true,
    });
  });

  it("caps the reply with the field reasoning models accept", async () => {
    // `max_tokens` is refused outright by reasoning models, which is most of
    // what this gets pointed at. Dropping the cap instead would mean paying
    // for a runaway reply the validator then discards.
    let seenBody: Record<string, unknown> = {};
    const deps = createDraftDependencies({
      property: "sc-domain:example.com",
      model: MODEL,
      fetchImpl: async (_url, init) => {
        seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return completion("reply");
      },
    });

    await deps!.complete("p");

    // Measured on the real deployment: a draft costs ~250 completion tokens,
    // of which ~200 are reasoning the reply never shows. The old cap of 400
    // left barely a third of that as headroom, and a reply cut off at the
    // ceiling arrives as half a JSON object.
    expect(seenBody["max_completion_tokens"]).toBeGreaterThanOrEqual(1000);
    expect(seenBody).not.toHaveProperty("max_tokens");
  });

  it("omits temperature entirely when the deployment has not set one", async () => {
    // Sending 0.4 to a reasoning model is a 400 for the whole request, not a
    // nudge it ignores. Omitting the field is accepted everywhere.
    let seenBody: Record<string, unknown> = {};
    const deps = createDraftDependencies({
      property: "sc-domain:example.com",
      model: MODEL,
      fetchImpl: async (_url, init) => {
        seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return completion("reply");
      },
    });

    await deps!.complete("p");

    expect(seenBody).not.toHaveProperty("temperature");
  });

  it("sends the configured temperature when there is one", async () => {
    let seenBody: Record<string, unknown> = {};
    const deps = createDraftDependencies({
      property: "sc-domain:example.com",
      model: { ...MODEL, temperature: 1 },
      fetchImpl: async (_url, init) => {
        seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return completion("reply");
      },
    });

    await deps!.complete("p");

    expect(seenBody["temperature"]).toBe(1);
  });

  it("asks for a JSON object so the model does not wrap it in a sentence", async () => {
    let seenBody: Record<string, unknown> = {};
    const deps = createDraftDependencies({
      property: "sc-domain:example.com",
      model: MODEL,
      fetchImpl: async (_url, init) => {
        seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return completion("reply");
      },
    });

    await deps!.complete("p");

    expect(seenBody["response_format"]).toEqual({ type: "json_object" });
  });

  it("omits the JSON-mode field when the deployment turned it off", async () => {
    let seenBody: Record<string, unknown> = {};
    const deps = createDraftDependencies({
      property: "sc-domain:example.com",
      model: { ...MODEL, jsonMode: false },
      fetchImpl: async (_url, init) => {
        seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return completion("reply");
      },
    });

    await deps!.complete("p");

    expect(seenBody).not.toHaveProperty("response_format");
  });

  it("retries once without JSON mode when the endpoint refuses the field", async () => {
    // Not every gateway supports `response_format`. Turning drafts off
    // entirely for a deployment that only refuses one optional field would
    // trade the bug we are fixing for a worse one, so the first 400 costs one
    // extra call and the run continues.
    const bodies: Record<string, unknown>[] = [];
    const deps = createDraftDependencies({
      property: "sc-domain:example.com",
      model: MODEL,
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        if (bodies.length === 1) {
          return new Response(
            JSON.stringify({
              error: { message: "Unsupported parameter: 'response_format'" },
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        return completion("reply");
      },
    });

    await expect(deps!.complete("p")).resolves.toEqual({
      text: "reply",
      truncated: false,
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toHaveProperty("response_format");
    expect(bodies[1]).not.toHaveProperty("response_format");
  });

  it("does not retry a 400 it was not already sending JSON mode for", async () => {
    // A 400 with no optional field to drop is a real rejection. Retrying the
    // identical request would just pay for the same answer twice.
    let calls = 0;
    const deps = createDraftDependencies({
      property: "sc-domain:example.com",
      model: { ...MODEL, jsonMode: false },
      fetchImpl: async () => {
        calls += 1;
        return new Response("bad request", { status: 400 });
      },
    });

    await expect(deps!.complete("p")).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("uses the api-key header for Azure and sends only one credential", async () => {
    // Azure accepts both header forms for a resource key — measured against
    // the live gpt-5.6-luna deployment, the bearer form authenticates fine.
    // The switch stays because sending both would put the credential in a
    // header the endpoint has no reason to read.
    let seenHeaders: Record<string, string> = {};
    const deps = createDraftDependencies({
      property: "sc-domain:example.com",
      model: { ...MODEL, authScheme: "api-key" },
      fetchImpl: async (_url, init) => {
        seenHeaders = init?.headers as Record<string, string>;
        return completion("reply");
      },
    });

    await deps!.complete("p");

    expect(seenHeaders["api-key"]).toBe("sk-test");
    expect(seenHeaders).not.toHaveProperty("authorization");
  });

  it("keeps the bearer header for everything that is not Azure", async () => {
    let seenHeaders: Record<string, string> = {};
    const deps = createDraftDependencies({
      property: "sc-domain:example.com",
      model: MODEL,
      fetchImpl: async (_url, init) => {
        seenHeaders = init?.headers as Record<string, string>;
        return completion("reply");
      },
    });

    await deps!.complete("p");

    expect(seenHeaders["authorization"]).toBe("Bearer sk-test");
    expect(seenHeaders).not.toHaveProperty("api-key");
  });

  it("throws on a model error so the row degrades rather than the run", async () => {
    // runDrafts turns this into `model_unavailable` for one row and leaves
    // the evidence table untouched.
    const deps = createDraftDependencies({
      property: "sc-domain:example.com",
      model: MODEL,
      fetchImpl: async () => new Response("nope", { status: 500 }),
    });

    await expect(deps!.complete("p")).rejects.toThrow();
  });

  it("throws when the model returns no message content", async () => {
    const deps = createDraftDependencies({
      property: "sc-domain:example.com",
      model: MODEL,
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    await expect(deps!.complete("p")).rejects.toThrow();
  });
});
