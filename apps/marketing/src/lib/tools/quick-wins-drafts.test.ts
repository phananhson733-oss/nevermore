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
  url: "https://model.test/v1/chat/completions",
} as const;

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
      createDraftDependencies({ property: "sc-domain:example.com", model: null }),
    ).toBeNull();
  });

  it("returns null when the property allows no origin", () => {
    expect(
      createDraftDependencies({ property: "http://example.com/", model: MODEL }),
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
      deps(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }))
        .fetchPageMeta("https://example.com/a"),
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
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "reply" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    await expect(deps!.complete("the prompt")).resolves.toBe("reply");
    expect(seenUrl).toBe(MODEL.url);
    expect(seenBody["model"]).toBe(MODEL.model);
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
