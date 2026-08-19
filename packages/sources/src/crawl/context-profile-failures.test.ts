import { describe, expect, it } from "vitest";
import {
  assertContextProfileSufficient,
  crawlSiteContextProfile,
  ContextProfileError,
  CONTEXT_PROFILE_CRAWL_BUDGET,
  type ContextProfileResult,
} from "./context-profile.ts";
import {
  codeOf,
  fakeSite,
  marketingSite,
  page,
  run,
  ORIGIN,
  type Route,
} from "./__tests__/context-profile-fake-site.ts";

describe("distinguishable failures", () => {
  it("names bot protection when the entry answers 403", async () => {
    const site = fakeSite(marketingSite({ "/": { status: 403 } }));

    await expect(codeOf(run(site))).resolves.toBe("bot_protection_blocked");
  });

  it("names rate limiting when the entry answers 429", async () => {
    const site = fakeSite(marketingSite({ "/": { status: 429 } }));

    await expect(codeOf(run(site))).resolves.toBe("rate_limited_by_target");
  });

  it("names the protocol downgrade the safety layer refused", async () => {
    const site = fakeSite(
      marketingSite({ "/": { redirectTo: "http://acme.test/" } }),
    );

    await expect(codeOf(run(site))).resolves.toBe(
      "protocol_downgrade_rejected",
    );
  });

  it("admits a same-site redirect that keeps HTTPS", async () => {
    const site = fakeSite({
      ...marketingSite(),
      "/": { redirectTo: "https://www.acme.test/", body: page("Acme") },
    });
    const result = await run(site);

    expect(result.origin).toBe("https://www.acme.test");
  });

  it("reports an unreachable entry generically rather than as a block", async () => {
    const site = fakeSite(
      marketingSite({ "/": { error: { kind: "error", code: "timeout" } } }),
    );

    await expect(codeOf(run(site))).resolves.toBe("entry_unreachable");
  });

  it("reports a homepage that answers 5xx as unreachable", async () => {
    const site = fakeSite(marketingSite({ "/": { status: 502 } }));

    await expect(codeOf(run(site))).resolves.toBe("entry_unreachable");
  });

  it.each([
    ["a relative URL", "/pricing"],
    ["a non-HTTP scheme", "ftp://acme.test/"],
    ["embedded credentials", "https://user:pass@acme.test/"],
  ])("rejects %s before any request", async (_label, url) => {
    const site = fakeSite(marketingSite());

    await expect(
      codeOf(
        crawlSiteContextProfile(url, {
          fetch: site.fetch,
          now: site.now,
          sleep: site.sleep,
        }),
      ),
    ).resolves.toBe("invalid_target");
    expect(site.requested).toHaveLength(0);
  });
});

function thrown(result: ContextProfileResult): unknown {
  try {
    assertContextProfileSufficient(result);
  } catch (error) {
    return error;
  }
  return new Error("expected a ContextProfileError");
}

describe("assertContextProfileSufficient", () => {
  it("passes a profile that reached the minimum page count", async () => {
    const result = await run(fakeSite(marketingSite()));

    expect(result.contextSufficient).toBe(true);
    expect(() => assertContextProfileSufficient(result)).not.toThrow();
  });

  it("reports too_few_pages when the site simply has nothing to crawl", async () => {
    const site = fakeSite(marketingSite({ "/": { body: page("Acme") } }));
    const result = await run(site);

    expect(result.pagesFetched).toBe(1);
    expect(result.contextSufficient).toBe(false);
    expect(() => assertContextProfileSufficient(result)).toThrow(
      ContextProfileError,
    );
    expect(await codeOf(Promise.reject(thrown(result)))).toBe("too_few_pages");
  });

  it("prefers bot protection over too_few_pages when candidates answered 403", async () => {
    const site = fakeSite(
      marketingSite({
        "/pricing": { status: 403 },
        "/features": { status: 403 },
        "/about": { status: 403 },
        "/solutions/teams": { status: 403 },
      }),
    );
    const result = await run(site);

    expect(result.botProtectionResponses).toBe(4);
    expect(await codeOf(Promise.reject(thrown(result)))).toBe(
      "bot_protection_blocked",
    );
  });

  it("prefers rate limiting when candidates answered 429", async () => {
    const site = fakeSite(
      marketingSite({
        "/pricing": { status: 429 },
        "/features": { status: 429 },
        "/about": { status: 429 },
        "/solutions/teams": { status: 429 },
      }),
    );
    const result = await run(site);

    expect(result.rateLimitedResponses).toBe(4);
    expect(await codeOf(Promise.reject(thrown(result)))).toBe(
      "rate_limited_by_target",
    );
  });

  it("prefers the downgrade code when candidates tried to leave HTTPS", async () => {
    const site = fakeSite(
      marketingSite({
        "/pricing": { redirectTo: "http://acme.test/pricing" },
        "/features": { redirectTo: "http://acme.test/features" },
        "/about": { redirectTo: "http://acme.test/about" },
        "/solutions/teams": { redirectTo: "http://acme.test/solutions/teams" },
      }),
    );
    const result = await run(site);

    expect(result.protocolDowngradesRejected).toBe(4);
    expect(await codeOf(Promise.reject(thrown(result)))).toBe(
      "protocol_downgrade_rejected",
    );
  });
});

describe("budget exhaustion", () => {
  function manyLinks(count: number): readonly string[] {
    return Array.from(
      { length: count },
      (_unused, index) => `/tools/t${index}`,
    );
  }

  it("stops at max_urls and keeps the highest-scoring candidates", async () => {
    const routes: Record<string, Route> = {
      "/robots.txt": { body: "" },
      "/sitemap.xml": { status: 404 },
      "/": { body: page("Acme", ["/pricing", ...manyLinks(30)]) },
      "/pricing": { body: page("Pricing") },
    };
    for (const path of manyLinks(30)) routes[path] = { body: page(path) };
    const site = fakeSite(routes);
    const result = await run(site);

    expect(result.stopReason).toBe("max_urls");
    expect(result.pagesFetched).toBe(CONTEXT_PROFILE_CRAWL_BUDGET.maxUrls);
    expect(result.pages[1]?.path).toBe("/pricing");
  });

  it("preserves a real budget stop reached while replenishing failed candidates", async () => {
    const links = Array.from(
      { length: 20 },
      (_unused, index) => `/tools/t${index.toString().padStart(2, "0")}`,
    );
    const routes: Record<string, Route> = {
      "/robots.txt": { body: "" },
      "/sitemap.xml": { status: 404 },
      "/": { body: page("Acme", links) },
    };
    for (const path of links) routes[path] = { body: page(path) };
    routes["/tools/t00"] = { status: 404 };
    routes["/tools/t01"] = { status: 500 };
    routes["/tools/t02"] = { error: { kind: "error", code: "timeout" } };
    routes["/tools/t13"] = { error: { kind: "error", code: "timeout" } };
    const site = fakeSite(routes, {
      onRequest: (url, self) => {
        if (url === `${ORIGIN}/tools/t13`) self.advance(60_000);
      },
    });
    const result = await run(site);

    expect(site.requested).toContain(`${ORIGIN}/tools/t13`);
    expect(result.pagesFetched).toBeLessThan(
      CONTEXT_PROFILE_CRAWL_BUDGET.maxUrls,
    );
    expect(result.stopReason).toBe("max_wall_clock");
  });

  it("stops at the wall clock and says so", async () => {
    const site = fakeSite(marketingSite(), {
      onRequest: (url, self) => {
        // Burn the whole budget once the homepage itself has been requested.
        if (url === `${ORIGIN}/sitemap.xml`) self.advance(60_000);
      },
    });
    const result = await run(site);

    expect(result.stopReason).toBe("max_wall_clock");
    expect(result.pagesFetched).toBe(1);
  });

  it("stops at the total byte budget and says so", async () => {
    // Exactly `maxUrls - 1` candidates, so the page cap cannot claim the stop
    // first and hide the byte budget behind it.
    const links = manyLinks(CONTEXT_PROFILE_CRAWL_BUDGET.maxUrls - 1);
    const fat = { bytes: CONTEXT_PROFILE_CRAWL_BUDGET.maxBodyBytes };
    const routes: Record<string, Route> = {
      "/robots.txt": { body: "" },
      "/sitemap.xml": { status: 404 },
      "/": { body: page("Acme", links), ...fat },
    };
    for (const path of links) routes[path] = { body: page(path), ...fat };
    const site = fakeSite(routes);
    const result = await run(site);

    expect(result.stopReason).toBe("max_total_bytes");
    expect(result.pagesFetched).toBeLessThan(
      CONTEXT_PROFILE_CRAWL_BUDGET.maxUrls,
    );
    // The ceiling is real, not approximate: in-flight requests are reserved at
    // their cap, so concurrency cannot walk the crawl past the budget.
    expect(result.bytesFetched).toBeLessThanOrEqual(
      CONTEXT_PROFILE_CRAWL_BUDGET.maxTotalBytes,
    );
  });

  it("stops when the caller aborts", async () => {
    const controller = new AbortController();
    const site = fakeSite(marketingSite(), {
      onRequest: (url) => {
        if (url === `${ORIGIN}/sitemap.xml`) controller.abort();
      },
    });
    const result = await run(site, { signal: controller.signal });

    expect(result.stopReason).toBe("aborted");
    expect(result.pagesFetched).toBe(1);
  });

  it("counts every request it issued", async () => {
    const site = fakeSite(marketingSite());
    const result = await run(site);

    // Entry probe + robots.txt + sitemap.xml + homepage + four candidates.
    expect(result.requestsSent).toBe(site.requested.length);
    expect(result.requestsSent).toBe(8);
    expect(result.bytesFetched).toBeGreaterThan(0);
  });

  it("stamps capturedAt from the injected clock, not the wall clock", async () => {
    const site = fakeSite(marketingSite());
    const result = await run(site);

    expect(result.capturedAt).toBe(new Date(site.now()).toISOString());
    expect(new Date(result.capturedAt).getFullYear()).toBe(1970);
  });

  it("blames its own budget, not the site, when it runs out before robots", async () => {
    const site = fakeSite(marketingSite(), {
      onRequest: (url, self) => {
        if (url === `${ORIGIN}/`) self.advance(60_000);
      },
    });

    await expect(codeOf(run(site))).resolves.toBe("too_few_pages");
  });

  it("blames its own budget when it runs out before the homepage", async () => {
    const site = fakeSite(marketingSite(), {
      onRequest: (url, self) => {
        if (url === `${ORIGIN}/robots.txt`) self.advance(60_000);
      },
    });

    await expect(codeOf(run(site))).resolves.toBe("too_few_pages");
  });

  it("blames its own budget when the caller aborts before the first request", async () => {
    const controller = new AbortController();
    controller.abort();
    const site = fakeSite(marketingSite());

    await expect(
      codeOf(run(site, { signal: controller.signal })),
    ).resolves.toBe("too_few_pages");
    expect(site.requested).toHaveLength(0);
  });
});
