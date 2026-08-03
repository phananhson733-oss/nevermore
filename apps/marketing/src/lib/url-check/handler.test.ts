import { describe, expect, it, vi } from "vitest";
import type {
  PublicResourceFetchOptions,
  PublicResourceResult,
} from "@sf/sources/public-http";
import {
  handleUrlCheck,
  type UrlCheckDependencies,
  type UrlCheckOutcome,
} from "./handler.ts";

function ok(finalStatus: number): PublicResourceResult {
  return {
    kind: "ok",
    requestedUrl: "https://acme.com/",
    finalUrl: "https://acme.com/",
    firstStatus: finalStatus,
    finalStatus,
    redirectChain: [],
    contentType: "text/html",
    xRobotsTag: null,
    body: "",
    bytes: 0,
    bodyComplete: false,
  };
}

function dependencies(
  overrides: Partial<UrlCheckDependencies> = {},
): UrlCheckDependencies {
  return {
    resolveDns: vi.fn(async () => ["203.0.113.10"]),
    fetchResource: vi.fn(async () => ok(200)),
    ...overrides,
  };
}

function value(outcome: UrlCheckOutcome) {
  if (outcome.kind !== "result") throw new Error(`expected a result, got ${outcome.kind}`);
  return outcome.value;
}

describe("handleUrlCheck", () => {
  it("reports a reachable public site", async () => {
    const result = value(await handleUrlCheck("https://acme.com/", dependencies()));
    expect(result).toEqual({
      reachable: true,
      statusCode: 200,
      error: null,
      errorKey: null,
    });
  });

  it("rejects a non-string url before touching the network", async () => {
    const fetchResource = vi.fn();
    const outcome = await handleUrlCheck(undefined, dependencies({ fetchResource }));
    expect(outcome.kind).toBe("bad_request");
    expect(fetchResource).not.toHaveBeenCalled();
  });

  /**
   * The defect this file exists for.
   *
   * The shipped route resolved DNS and then threw the answer away, calling
   * `fetch(url)` on the original string. A hostname that passes the *string*
   * blocklist but resolves to a private address — `127.0.0.1.nip.io`,
   * `169.254.169.254.nip.io`, or any attacker-controlled A record — was fetched
   * from our egress. Verified against production before this fix: `127.0.0.1`
   * was refused at the pattern layer, while `127.0.0.1.nip.io` reached the
   * socket and came back `NETWORK_ERROR`.
   *
   * The guard now runs inside `fetchPublicResource`, which resolves, classifies,
   * and pins the IP to the connection on every hop. The handler's contract is
   * that it asks that primitive rather than raw `fetch`.
   */
  it("routes the fetch through the guarded transport, not raw fetch", async () => {
    const fetchResource = vi.fn(
      async (_url: string, _options: PublicResourceFetchOptions) => ok(200),
    );
    await handleUrlCheck("https://127-0-0-1.nip.io/", dependencies({ fetchResource }));
    expect(fetchResource).toHaveBeenCalledTimes(1);
    const [, options] = fetchResource.mock.calls[0];
    // A reachability probe must never pull down a body.
    expect(options.maxBodyBytes).toBe(1);
    expect(options.maxRedirects).toBe(3);
  });

  /**
   * Distinguishable failure codes for refused addresses are a blind
   * port-scanning oracle: `NETWORK_ERROR` means "connection refused", `TIMEOUT`
   * means "packet dropped by a firewall". Production returned exactly that pair
   * for `127.0.0.1.nip.io` vs `192.168.1.1.nip.io`.
   *
   * Everything the guard refuses must answer identically.
   */
  it("gives one indistinguishable answer for every blocked address", async () => {
    const outcome = await handleUrlCheck(
      "https://internal.example.com/",
      dependencies({
        fetchResource: async () => ({ kind: "error", code: "blocked" }),
      }),
    );
    expect(value(outcome)).toEqual({
      reachable: false,
      statusCode: null,
      error: "SSRF_BLOCKED",
      errorKey: "urlPrivateIp",
    });
  });

  it("does not leak redirect-chain outcomes as distinct states", async () => {
    const codes = ["cross_origin", "invalid_redirect", "redirect_limit", "network"] as const;
    const outcomes = await Promise.all(
      codes.map((code) =>
        handleUrlCheck(
          "https://acme.com/",
          dependencies({ fetchResource: async () => ({ kind: "error", code }) }),
        ),
      ),
    );
    for (const outcome of outcomes) {
      expect(value(outcome).error).toBe("NETWORK_ERROR");
    }
  });

  it("still distinguishes a timeout on an allowed public host", async () => {
    const outcome = await handleUrlCheck(
      "https://acme.com/",
      dependencies({
        fetchResource: async () => ({ kind: "error", code: "timeout" }),
      }),
    );
    expect(value(outcome).error).toBe("TIMEOUT");
  });

  it("reports an unresolvable name as a DNS failure, not as blocked", async () => {
    const outcome = await handleUrlCheck(
      "https://no-such-domain-here.com/",
      dependencies({
        resolveDns: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    );
    expect(value(outcome).error).toBe("DNS_FAILED");
  });

  it("keeps the pattern layer's specific error key", async () => {
    const outcome = await handleUrlCheck("https://localhost/", dependencies());
    const result = value(outcome);
    expect(result.error).toBe("PATTERN_INVALID");
    expect(result.errorKey).toBe("urlLocalhost");
  });

  it("treats a 5xx as reachable-but-erroring and keeps the status", async () => {
    const outcome = await handleUrlCheck(
      "https://acme.com/",
      dependencies({ fetchResource: async () => ok(503) }),
    );
    expect(value(outcome)).toEqual({
      reachable: false,
      statusCode: 503,
      error: "HTTP_ERROR",
      errorKey: "urlHttpError",
    });
  });

  /**
   * The old 405 branch re-fetched with `redirect: "follow"`, which delegated
   * every hop to undici with no guard at all — a bare private IP in a Location
   * header was followed. There is no such branch now: one guarded call handles
   * redirects itself, so a 405 is simply a status.
   */
  it("does not re-fetch on 405", async () => {
    const fetchResource = vi.fn(async () => ok(405));
    const outcome = await handleUrlCheck(
      "https://acme.com/",
      dependencies({ fetchResource }),
    );
    expect(fetchResource).toHaveBeenCalledTimes(1);
    expect(value(outcome).reachable).toBe(true);
  });
});

describe("validateUrlPattern port handling", () => {
  /**
   * The guarded transport rejects any explicit port, and every guard rejection
   * renders as "private/internal IP addresses are not allowed". For
   * https://acme.com:8443 that message is false. The pattern layer names the
   * real reason before the request is ever made.
   */
  it("names the port as the reason, not a private IP", async () => {
    const outcome = await handleUrlCheck("https://acme.com:8443/", dependencies());
    if (outcome.kind !== "result") throw new Error("expected a result");
    expect(outcome.value.error).toBe("PATTERN_INVALID");
    expect(outcome.value.errorKey).toBe("urlPort");
  });
});
