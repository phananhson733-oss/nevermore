// @input  — GET from ./route.ts with a stubbed findShortLink
// @output — regression tests pinning unknown short codes to 404, outages to 503
// @pos    — short-link entrypoint boundary tests (soft-404 regression guard)
// once this file is updated, update header comments and _DIR.md in this folder
import { afterEach, describe, expect, it, vi } from "vitest";

const findShortLink = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/link-attribution/short-links", async (importOriginal) => {
  // normalizeShortLinkCode and normalizeOwnedDestination stay real: they are
  // the validation this route's answers depend on, so stubbing them would test
  // the stub instead of the boundary.
  const actual =
    await importOriginal<
      typeof import("../../../lib/link-attribution/short-links")
    >();
  return { ...actual, findShortLink };
});

import { GET } from "./route";

function get(code: string | undefined) {
  return GET(new Request(`https://gengrowth.ai/go/${code ?? ""}`), {
    params: { code },
  });
}

afterEach(() => {
  findShortLink.mockReset();
});

/**
 * The proxy rewrites every unreserved single-segment path of 6+ characters to
 * this handler, so it answers for far more than deliberate short links. When a
 * miss redirected to "/", each mistyped inbound link and each guessed path
 * became a soft 404: Google keeps the requested URL and keeps recrawling it.
 */
describe("GET /go/[code] when nothing is registered", () => {
  it("answers 404 instead of redirecting an unknown code to the homepage", async () => {
    findShortLink.mockResolvedValue(null);

    const response = await get("free-seo-audit");

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  });

  it.each(["abcdef", "seo-tools", "random-word-here", "a".repeat(80)])(
    "answers 404 for the unregistered path /%s the proxy rewrites here",
    async (code) => {
      findShortLink.mockResolvedValue(null);

      expect((await get(code)).status).toBe(404);
    },
  );

  it("answers 404 for a code shaped wrongly enough to never be looked up", async () => {
    const response = await get("Not A Code");

    expect(response.status).toBe(404);
    expect(findShortLink).not.toHaveBeenCalled();
  });

  it("answers 404 when a row exists but its destination is no longer ours", async () => {
    findShortLink.mockResolvedValue({
      code: "leftover",
      destination_url: "https://not-our-domain.example/landing",
      redirect_status: 301,
    });

    const response = await get("leftover");

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  });
});

/**
 * An outage is not the same answer as "gone". Telling a crawler 404 while the
 * database is unreachable would drop short links that really do exist, so a
 * failed lookup asks for a retry instead.
 */
describe("GET /go/[code] when the lookup itself fails", () => {
  it("answers 503 with a retry hint rather than 404 or a homepage redirect", async () => {
    findShortLink.mockRejectedValue(new Error("connection terminated"));

    const response = await get("realcode");

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("GET /go/[code] for links that do exist", () => {
  it("still redirects a registered code to its stored destination", async () => {
    findShortLink.mockResolvedValue({
      code: "launch",
      destination_url: "https://gengrowth.ai/tools/seo-audit",
      redirect_status: 302,
    });

    const response = await get("launch");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://gengrowth.ai/tools/seo-audit",
    );
  });

  it("honors a stored permanent redirect status", async () => {
    findShortLink.mockResolvedValue({
      code: "moved",
      destination_url: "https://gengrowth.ai/pricing",
      redirect_status: 301,
    });

    expect((await get("moved")).status).toBe(301);
  });

  it("looks the code up in its normalized lower-case form", async () => {
    findShortLink.mockResolvedValue(null);

    await get("MixedCase");

    expect(findShortLink).toHaveBeenCalledWith("mixedcase");
  });
});
