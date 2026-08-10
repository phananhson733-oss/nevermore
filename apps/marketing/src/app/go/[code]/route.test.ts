// @input  — GET from ./route.ts with a stubbed findShortLink
// @output — regression tests pinning unknown codes to 404 and outages to 503
// @pos    — short-link entrypoint boundary tests (soft-404 regression guard)
// once this file is updated, update header comments and _DIR.md in this folder
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

async function status(code: string | undefined): Promise<number> {
  return (await get(code)).status;
}

beforeEach(() => {
  process.env.MARKETING_SHORT_LINKS_ENABLED = "true";
});

afterEach(() => {
  delete process.env.MARKETING_SHORT_LINKS_ENABLED;
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

    expect(await status("free-seo-audit")).toBe(404);
  });

  it.each(["abcdef", "seo-tools", "random-word-here", "a".repeat(80)])(
    "answers 404 for the unregistered path /%s the proxy rewrites here",
    async (code) => {
      findShortLink.mockResolvedValue(null);

      expect(await status(code)).toBe(404);
    },
  );

  it("answers 404 for a code shaped wrongly enough to never be looked up", async () => {
    expect(await status("Not A Code")).toBe(404);
    expect(findShortLink).not.toHaveBeenCalled();
  });

  it("serves an actual page with the 404, not a blank window", async () => {
    // A Route Handler has no render boundary, so notFound() would answer with
    // an empty body — and the proxy routes every typo in the root namespace
    // through here, which would make a blank page the site's answer to all of
    // them. The address bar still shows the mistyped URL, so there has to be
    // something on the page saying where to go.
    findShortLink.mockResolvedValue(null);

    const response = await get("free-seo-audit");
    const body = await response.text();

    expect(response.headers.get("content-type")).toMatch(/^text\/html/);
    expect(body).toContain('href="/"');
    expect(body).toMatch(/Page Not Found/i);
    expect(body).toContain('name="robots" content="noindex"');
  });

});

describe("GET /go/[code] when a registered row is unusable", () => {
  it.each([
    ["a destination that is no longer ours", "https://not-our-domain.example/x"],
    ["a destination that will not parse", "not a url"],
    ["an empty destination", ""],
  ])("answers 503 rather than retiring the code over %s", async (_l, url) => {
    // The row exists, so somebody published this code. A broken destination is
    // the same class of problem as an unusable status: an operational fault,
    // not evidence that the link was never registered.
    findShortLink.mockResolvedValue({
      code: "leftover",
      destination_url: url,
      redirect_status: 301,
    });

    expect(await status("leftover")).toBe(503);
  });
});

/**
 * Whether this deployment serves short links is declared, never inferred.
 *
 * Reading "no credentials" or "no such table" as proof that no link exists
 * conflates two different facts — whether the data exists, and whether this
 * instance can currently reach it. A rotated key or a mid-flight migration
 * would then retire published URLs permanently.
 */
describe("GET /go/[code] on a deployment without the feature", () => {
  it("answers 404 without touching the database at all", async () => {
    delete process.env.MARKETING_SHORT_LINKS_ENABLED;

    expect(await status("free-seo-audit")).toBe(404);
    expect(findShortLink).not.toHaveBeenCalled();
  });

  it.each(["false", "1", "yes", ""])(
    "stays off for the non-affirmative value %p",
    async (value) => {
      process.env.MARKETING_SHORT_LINKS_ENABLED = value;

      expect(await status("abcdef")).toBe(404);
      expect(findShortLink).not.toHaveBeenCalled();
    },
  );
});

describe("GET /go/[code] when the feature is on but the lookup fails", () => {
  it("answers 503 rather than retiring a link that may be real", async () => {
    findShortLink.mockRejectedValue(new Error("connection terminated"));

    const response = await get("realcode");

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("location")).toBeNull();
  });

  it("answers 503 when the table is missing, not 404", async () => {
    // Enabled but no table is a configuration fault, not evidence that the
    // link is gone. 404 here would be irreversible for a published URL.
    findShortLink.mockRejectedValue(
      Object.assign(new Error('relation "link_redirects" does not exist'), {
        code: "42P01",
      }),
    );

    expect(await status("campaign-a")).toBe(503);
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

  it.each([301, 302, 303, 307, 308])(
    "honors the stored redirect status %i",
    async (redirect_status) => {
      findShortLink.mockResolvedValue({
        code: "moved",
        destination_url: "https://gengrowth.ai/pricing",
        redirect_status,
      });

      expect(await status("moved")).toBe(redirect_status);
    },
  );

  it.each([200, 204, 300, 304, 305, 309, 999, 0, -1])(
    "answers 503 instead of throwing on the unusable stored status %i",
    async (redirect_status) => {
      // NextResponse.redirect throws outside the redirect range, and an
      // uncaught throw here is a 500 on a published link.
      findShortLink.mockResolvedValue({
        code: "broken",
        destination_url: "https://gengrowth.ai/pricing",
        redirect_status,
      });

      expect(await status("broken")).toBe(503);
    },
  );

  it("looks the code up in its normalized lower-case form", async () => {
    findShortLink.mockResolvedValue(null);

    await status("MixedCase");

    expect(findShortLink).toHaveBeenCalledWith("mixedcase");
  });
});
