// @input  -- GET /r/{code} requests with valid, malformed, and missing codes
// @output -- assertions on the redirect and the gg_ref cookie
// @pos    -- guards the referral landing route

import { describe, expect, it } from "vitest";

import { GET } from "./route.ts";

function landing(code: string | undefined): Promise<Response> {
  return GET(new Request(`https://gengrowth.ai/r/${code ?? ""}`), {
    params: Promise.resolve(code === undefined ? {} : { code }),
  });
}

describe("GET /r/[code]", () => {
  it("remembers a valid code and sends the visitor to the home page", async () => {
    const response = await landing("ab3kd9xz");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://gengrowth.ai/");
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("gg_ref=ab3kd9xz");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Domain=");
  });

  it("lowercases a code that was retyped in capitals", async () => {
    const response = await landing("AB3KD9XZ");
    expect(response.headers.get("set-cookie")).toContain("gg_ref=ab3kd9xz");
  });

  /**
   * A dead link is not an error page. The visitor still arrived, so send them
   * to the site and simply remember nothing.
   */
  it("still lands a malformed code, without remembering it", async () => {
    const response = await landing("nope");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://gengrowth.ai/");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("handles a missing code", async () => {
    const response = await landing(undefined);
    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("accepts params delivered synchronously", async () => {
    const response = await GET(new Request("https://gengrowth.ai/r/ab3kd9xz"), {
      params: { code: "ab3kd9xz" },
    });
    expect(response.headers.get("set-cookie")).toContain("gg_ref=ab3kd9xz");
  });

  it("keeps the redirect off any caching layer", async () => {
    const response = await landing("ab3kd9xz");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
