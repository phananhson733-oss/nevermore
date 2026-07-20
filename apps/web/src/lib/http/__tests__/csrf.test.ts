import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { assertSameOriginMutation } from "@/lib/http/handler";

afterEach(() => {
  vi.unstubAllEnvs();
});

function request(
  method: string,
  headers: Readonly<Record<string, string>> = {},
): NextRequest {
  return new NextRequest("https://app.signalframe.test/api/mvp/projects", {
    method,
    headers,
  });
}

describe("same-origin mutation guard", () => {
  it("allows safe methods without browser origin metadata", () => {
    expect(() => assertSameOriginMutation(request("GET"))).not.toThrow();
    expect(() => assertSameOriginMutation(request("HEAD"))).not.toThrow();
  });

  it("allows same-origin browser mutations and non-browser API clients", () => {
    expect(() =>
      assertSameOriginMutation(
        request("POST", {
          origin: "https://app.signalframe.test",
          "sec-fetch-site": "same-origin",
        }),
      ),
    ).not.toThrow();
    expect(() => assertSameOriginMutation(request("PATCH"))).not.toThrow();
  });

  it("rejects a cross-site browser mutation even when no Origin is available", () => {
    expect(() =>
      assertSameOriginMutation(
        request("POST", { "sec-fetch-site": "cross-site" }),
      ),
    ).toThrowError(expect.objectContaining({ code: "BAD_REQUEST", status: 400 }));
  });

  it("rejects a mismatched or opaque Origin", () => {
    expect(() =>
      assertSameOriginMutation(
        request("DELETE", { origin: "https://evil.example" }),
      ),
    ).toThrowError(expect.objectContaining({ code: "BAD_REQUEST" }));
    expect(() =>
      assertSameOriginMutation(request("POST", { origin: "null" })),
    ).toThrowError(expect.objectContaining({ code: "BAD_REQUEST" }));
  });

  it("anchors both Origin and the effective request host to configured APP_ORIGIN", () => {
    const evilRequest = new NextRequest(
      "https://evil.example/api/mvp/projects",
      {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          host: "evil.example",
          "sec-fetch-site": "same-origin",
        },
      },
    );
    expect(() =>
      assertSameOriginMutation(
        evilRequest,
        "https://app.signalframe.test",
      ),
    ).toThrowError(expect.objectContaining({ code: "BAD_REQUEST" }));

    expect(() =>
      assertSameOriginMutation(
        request("POST", {
          origin: "https://app.signalframe.test",
          host: "poisoned-host.example",
          "sec-fetch-site": "same-origin",
        }),
        "https://app.signalframe.test",
      ),
    ).toThrowError(expect.objectContaining({ code: "BAD_REQUEST" }));
  });

  it("rejects same-site and unknown browser mutation metadata", () => {
    for (const site of ["same-site", "cross-site", "unexpected"]) {
      expect(() =>
        assertSameOriginMutation(
          request("POST", {
            host: "app.signalframe.test",
            "sec-fetch-site": site,
          }),
          "https://app.signalframe.test",
        ),
      ).toThrowError(expect.objectContaining({ code: "BAD_REQUEST" }));
    }
  });

  it("allows a headerless non-browser mutation only when its effective host is configured", () => {
    expect(() =>
      assertSameOriginMutation(
        request("PATCH", { host: "app.signalframe.test" }),
        "https://app.signalframe.test",
      ),
    ).not.toThrow();
  });

  it("fails closed on an invalid configured origin without reflecting it", () => {
    const marker = "configuration-secret";
    let caught: unknown;
    try {
      assertSameOriginMutation(
        request("POST", { host: "app.signalframe.test" }),
        `https://${marker}:password@app.signalframe.test/path`,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(JSON.stringify(caught)).not.toContain(marker);
    expect(JSON.stringify(caught)).not.toContain("password");
  });

  it("never falls back to request Host when production APP_ORIGIN is absent", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "");
    expect(() =>
      assertSameOriginMutation(
        new NextRequest("https://evil.example/api/mvp/projects", {
          method: "POST",
          headers: {
            host: "evil.example",
            origin: "https://evil.example",
            "sec-fetch-site": "same-origin",
          },
        }),
      ),
    ).toThrowError("Invalid APP_ORIGIN configuration.");
  });
});
