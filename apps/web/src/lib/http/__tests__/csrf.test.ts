import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { assertSameOriginMutation } from "@/lib/http/handler";

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
});
