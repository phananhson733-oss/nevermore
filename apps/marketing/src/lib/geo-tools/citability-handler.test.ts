import { describe, expect, it, vi } from "vitest";

import {
  handleCitabilityRequest,
  type CitabilityFetchResult,
  type CitabilityHandlerDependencies,
} from "./citability-handler.ts";

const PAGE_HTML = `<html><head><link rel="canonical" href="https://acme-example-site.com/guide"></head><body><p>${"content ".repeat(
  120,
)}</p></body></html>`;

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://gengrowth.ai/api/tools/page-citability-check", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function deps(
  overrides: Partial<CitabilityHandlerDependencies> = {},
): CitabilityHandlerDependencies {
  const release = vi.fn();
  return {
    normalizeUrl: (value) =>
      typeof value === "string" && value.startsWith("https://")
        ? { ok: true, url: value }
        : { ok: false, code: "invalid_url" },
    extractClientIp: () => "203.0.113.9",
    isSignedIn: async () => false,
    openGate: async () => ({ ok: true, release }),
    chargeTarget: async () => ({ ok: true }),
    fetchResource: async (url): Promise<CitabilityFetchResult> => {
      if (url.endsWith("/robots.txt")) {
        return { kind: "ok", status: 200, contentType: "text/plain", body: "" };
      }
      if (url.endsWith("/llms.txt")) {
        return { kind: "ok", status: 404, contentType: "text/plain", body: "" };
      }
      return {
        kind: "ok",
        status: 200,
        contentType: "text/html; charset=utf-8",
        finalUrl: url,
        body: PAGE_HTML,
        bodyComplete: true,
      };
    },
    now: () => new Date("2026-08-29T10:00:00.000Z"),
    ...overrides,
  };
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code ?? "";
}

describe("request contract", () => {
  it("refuses a body that is not JSON", async () => {
    const request = new Request("https://gengrowth.ai/x", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "url=x",
    });
    const response = await handleCitabilityRequest(request, deps());
    expect(response.status).toBe(415);
  });

  it("refuses an unknown field rather than ignoring it", async () => {
    const response = await handleCitabilityRequest(
      post({ url: "https://acme-example-site.com/guide", depth: 3 }),
      deps(),
    );
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("invalid_request");
  });

  it("refuses a question longer than the form allows", async () => {
    const response = await handleCitabilityRequest(
      post({
        url: "https://acme-example-site.com/guide",
        question: "q".repeat(201),
      }),
      deps(),
    );
    expect(response.status).toBe(400);
  });

  it("refuses an unusable URL before spending any quota", async () => {
    const openGate = vi.fn();
    const response = await handleCitabilityRequest(
      post({ url: "not a url" }),
      deps({ openGate }),
    );
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("invalid_url");
    expect(openGate).not.toHaveBeenCalled();
  });
});

describe("gate", () => {
  it("returns the gate's own response and never fetches", async () => {
    const fetchResource = vi.fn();
    const limited = Response.json(
      { error: { code: "rate_limited" } },
      { status: 429 },
    );
    const response = await handleCitabilityRequest(
      post({ url: "https://acme-example-site.com/guide" }),
      deps({ openGate: async () => ({ ok: false, response: limited }), fetchResource }),
    );
    expect(response.status).toBe(429);
    expect(fetchResource).not.toHaveBeenCalled();
  });

  it("releases the in-flight slot even when the page fetch fails", async () => {
    const release = vi.fn();
    const response = await handleCitabilityRequest(
      post({ url: "https://acme-example-site.com/guide" }),
      deps({
        openGate: async () => ({ ok: true, release }),
    chargeTarget: async () => ({ ok: true }),
        fetchResource: async () => ({ kind: "error", code: "network" }),
      }),
    );
    expect(response.status).toBe(502);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("raises the per-IP ceiling for a signed-in caller", async () => {
    const openGate = vi.fn(async () => ({ ok: true as const, release: vi.fn() }));
    await handleCitabilityRequest(
      post({ url: "https://acme-example-site.com/guide" }),
      deps({ isSignedIn: async () => true, openGate }),
    );
    expect(openGate).toHaveBeenCalledWith(
      expect.objectContaining({ signedIn: true }),
    );
  });
});

describe("page fetch", () => {
  it("refuses to grade a page an answer cannot reach", async () => {
    const response = await handleCitabilityRequest(
      post({ url: "https://acme-example-site.com/guide" }),
      deps({
        fetchResource: async (url) =>
          url.endsWith("/guide")
            ? { kind: "ok", status: 404, contentType: "text/html", body: "" }
            : { kind: "ok", status: 200, body: "" },
      }),
    );
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("page_not_ok");
  });

  it("refuses a non-HTML document", async () => {
    const response = await handleCitabilityRequest(
      post({ url: "https://acme-example-site.com/guide" }),
      deps({
        fetchResource: async (url) =>
          url.endsWith("/guide")
            ? {
                kind: "ok",
                status: 200,
                contentType: "application/pdf",
                finalUrl: url,
                body: "%PDF",
              }
            : { kind: "ok", status: 200, body: "" },
      }),
    );
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("not_html");
  });

  it("returns the tool's envelope when something unexpected throws", async () => {
    const release = vi.fn();
    const response = await handleCitabilityRequest(
      post({ url: "https://acme-example-site.com/guide" }),
      deps({
        openGate: async () => ({ ok: true, release }),
    chargeTarget: async () => ({ ok: true }),
        fetchResource: async () => {
          throw new RangeError("counts are impossible");
        },
      }),
    );
    expect(response.status).toBe(500);
    expect(await errorCode(response)).toBe("internal_error");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("maps a timeout to its own code", async () => {
    const response = await handleCitabilityRequest(
      post({ url: "https://acme-example-site.com/guide" }),
      deps({ fetchResource: async () => ({ kind: "error", code: "timeout" }) }),
    );
    expect(await errorCode(response)).toBe("fetch_timeout");
  });
});

describe("robots and llms.txt outcomes", () => {
  it("treats a 404 robots.txt as allowance and a 500 as unknown", async () => {
    const allowed = await handleCitabilityRequest(
      post({ url: "https://acme-example-site.com/guide" }),
      deps({
        fetchResource: async (url) =>
          url.endsWith("/robots.txt")
            ? { kind: "ok", status: 404, body: "" }
            : url.endsWith("/llms.txt")
              ? { kind: "ok", status: 404, body: "" }
              : {
                  kind: "ok",
                  status: 200,
                  contentType: "text/html",
                  finalUrl: url,
                  body: PAGE_HTML,
                },
      }),
    );
    const allowedBody = (await allowed.json()) as {
      data: { checks: { ruleId: string; state: string; measured: { key: string } }[] };
    };
    const bot = allowedBody.data.checks.find(
      (check) => check.ruleId === "robots.oai-searchbot",
    );
    expect(bot?.state).toBe("pass");
    expect(bot?.measured.key).toBe("robots.absent");

    const unknown = await handleCitabilityRequest(
      post({ url: "https://acme-example-site.com/guide" }),
      deps({
        fetchResource: async (url) =>
          url.endsWith("/robots.txt")
            ? { kind: "ok", status: 500, body: "" }
            : url.endsWith("/llms.txt")
              ? { kind: "ok", status: 404, body: "" }
              : {
                  kind: "ok",
                  status: 200,
                  contentType: "text/html",
                  finalUrl: url,
                  body: PAGE_HTML,
                },
      }),
    );
    const unknownBody = (await unknown.json()) as {
      data: { checks: { ruleId: string; state: string }[] };
    };
    expect(
      unknownBody.data.checks.find(
        (check) => check.ruleId === "robots.oai-searchbot",
      )?.state,
    ).toBe("fetchError");
  });

  it("reads robots.txt from the origin the page actually landed on", async () => {
    const seen: string[] = [];
    await handleCitabilityRequest(
      post({ url: "https://acme-example-site.com/guide" }),
      deps({
        fetchResource: async (url) => {
          seen.push(url);
          if (url.endsWith("/guide")) {
            return {
              kind: "ok",
              status: 200,
              contentType: "text/html",
              finalUrl: "https://www.acme-example-site.com/guide",
              body: PAGE_HTML,
            };
          }
          return { kind: "ok", status: 200, body: "" };
        },
      }),
    );
    expect(seen).toContain("https://www.acme-example-site.com/robots.txt");
  });
});

describe("report", () => {
  it("returns the report with no store caching and a run timestamp", async () => {
    const response = await handleCitabilityRequest(
      post({
        url: "https://acme-example-site.com/guide",
        question: "how do I make a page citable",
      }),
      deps(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as {
      data: {
        fetchedAt: string;
        targetQuestion: string;
        questionTerms: string[];
        summary: { total: number };
      };
    };
    expect(body.data.fetchedAt).toBe("2026-08-29T10:00:00.000Z");
    expect(body.data.targetQuestion).toBe("how do I make a page citable");
    expect(body.data.questionTerms).toContain("citable");
    expect(body.data.summary.total).toBe(14);
  });
});

describe("truncation and encoding", () => {
  it("does not conclude anything is absent from a body it only half read", async () => {
    const shell = `<html><body><div id="app"></div><script>${"x".repeat(500)}`;
    const response = await handleCitabilityRequest(
      post({ url: "https://acme-example-site.com/guide" }),
      deps({
        fetchResource: async (url) =>
          url.endsWith("/guide")
            ? {
                kind: "ok",
                status: 200,
                contentType: "text/html",
                finalUrl: url,
                body: shell,
                bodyComplete: false,
              }
            : { kind: "ok", status: 404, body: "" },
      }),
    );
    const parsed = (await response.json()) as {
      data: { checks: { ruleId: string; state: string; measured: { key: string } }[] };
    };
    // Truncated mid-script, the unclosed tag turns script source into "copy"
    // and this page used to pass the check it most obviously fails.
    const ssr = parsed.data.checks.find((check) => check.ruleId === "ssr");
    expect(ssr?.state).toBe("fetchError");
    expect(ssr?.measured.key).toBe("truncated");
    for (const ruleId of ["canonical", "extractableStructure", "faqSchema"]) {
      expect(
        parsed.data.checks.find((check) => check.ruleId === ruleId)?.state,
      ).toBe("fetchError");
    }
  });

  it("refuses a page it would have to decode as the wrong character set", async () => {
    const response = await handleCitabilityRequest(
      post({ url: "https://acme-example-site.com/guide" }),
      deps({
        fetchResource: async (url) =>
          url.endsWith("/guide")
            ? {
                kind: "ok",
                status: 200,
                contentType: "text/html; charset=gb2312",
                finalUrl: url,
                body: "�".repeat(1_000),
                bodyComplete: true,
              }
            : { kind: "ok", status: 404, body: "" },
      }),
    );
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("not_utf8");
  });

  it("refuses a page whose charset was only declared in a meta tag", async () => {
    // No charset in the header, so the fetch layer decoded it as UTF-8 and
    // handed back replacement characters.
    const response = await handleCitabilityRequest(
      post({ url: "https://acme-example-site.com/guide" }),
      deps({
        fetchResource: async (url) =>
          url.endsWith("/guide")
            ? {
                kind: "ok",
                status: 200,
                contentType: "text/html",
                finalUrl: url,
                body: `<html><head><meta charset="gb2312"></head><body>${"\ufffd".repeat(600)}</body></html>`,
                bodyComplete: true,
              }
            : { kind: "ok", status: 404, body: "" },
      }),
    );
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("not_utf8");
  });

  it("charges the target budget again when a redirect lands elsewhere", async () => {
    const chargeTarget = vi.fn(async () => ({ ok: true as const }));
    await handleCitabilityRequest(
      post({ url: "https://acme-example-site.com/guide" }),
      deps({
        chargeTarget,
        fetchResource: async (url) =>
          url.endsWith("/guide")
            ? {
                kind: "ok",
                status: 200,
                contentType: "text/html",
                finalUrl: "https://elsewhere-example.com/guide",
                body: PAGE_HTML,
                bodyComplete: true,
              }
            : { kind: "ok", status: 404, body: "" },
      }),
    );
    expect(chargeTarget).toHaveBeenCalledWith("elsewhere-example.com");
  });

  it("calls a mistyped domain a bad request, not a server failure", async () => {
    const response = await handleCitabilityRequest(
      post({ url: "https://acme-example-site.com/guide" }),
      deps({ fetchResource: async () => ({ kind: "error", code: "blocked" }) }),
    );
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("fetch_blocked");

    const slow = await handleCitabilityRequest(
      post({ url: "https://acme-example-site.com/guide" }),
      deps({ fetchResource: async () => ({ kind: "error", code: "timeout" }) }),
    );
    expect(slow.status).toBe(504);
  });
});
