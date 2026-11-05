// @input  -- request-origin.ts
// @output -- requestOrigin() regression tests for self-hosted and Vercel request shapes
// @pos    -- keeps Origin checks and redirects on the visitor's host when request.url is the server's own address
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { describe, expect, it } from "vitest";
import { requestOrigin } from "./request-origin.ts";

function request(url: string, host?: string): Request {
  return new Request(url, host === undefined ? {} : { headers: { host } });
}

describe("requestOrigin", () => {
  it("uses Host when request.url is the container's own address", () => {
    // What Next hands a route handler behind pick's Caddy.
    expect(requestOrigin(request("https://0.0.0.0:3001/api/auth/google/logout", "gengrowth.ai"))).toBe(
      "https://gengrowth.ai",
    );
    expect(requestOrigin(request("https://0.0.0.0:3001/r/abc", "next.gengrowth.ai"))).toBe(
      "https://next.gengrowth.ai",
    );
  });

  it("matches request.url on Vercel, where both name the public host", () => {
    expect(requestOrigin(request("https://gengrowth.ai/api/tools/x", "gengrowth.ai"))).toBe(
      "https://gengrowth.ai",
    );
  });

  it("keeps request.url's scheme and drops a default port", () => {
    expect(requestOrigin(request("http://0.0.0.0:3001/x", "localhost:3001"))).toBe("http://localhost:3001");
    expect(requestOrigin(request("https://0.0.0.0:3001/x", "gengrowth.ai:443"))).toBe("https://gengrowth.ai");
  });

  it("falls back to request.url without a usable Host", () => {
    expect(requestOrigin(request("https://gengrowth.ai/x"))).toBe("https://gengrowth.ai");
    expect(requestOrigin(request("https://0.0.0.0:3001/x", "gengrowth.ai@evil.example"))).toBe(
      "https://0.0.0.0:3001",
    );
    expect(requestOrigin(request("https://0.0.0.0:3001/x", "evil.example/path"))).toBe("https://0.0.0.0:3001");
    expect(requestOrigin(request("https://0.0.0.0:3001/x", "gengrowth.ai:99999"))).toBe("https://0.0.0.0:3001");
  });
});
