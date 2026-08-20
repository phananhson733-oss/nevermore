import { describe, expect, it } from "vitest";
import {
  createDomainRegistrationResolver,
  IANA_RDAP_DNS_BOOTSTRAP_URL,
} from "./domain-registration.ts";

const OBSERVED_AT = new Date("2026-08-20T12:00:00.000Z");

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function bootstrap(
  suffix: string,
  servers: readonly string[] = ["https://rdap.registry.test/v1/"],
): unknown {
  return {
    description: "IANA RDAP bootstrap fixture",
    publication: "2026-08-20T00:00:00Z",
    services: [[[suffix], servers]],
    ignored_extension: { safe: true },
  };
}

describe("createDomainRegistrationResolver", () => {
  it("discovers the registry through IANA and parses only a top-level registration event", async () => {
    const calls: {
      readonly url: string;
      readonly init: RequestInit | undefined;
    }[] = [];
    const resolver = createDomainRegistrationResolver({
      now: () => OBSERVED_AT,
      fetchImpl: async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        if (url === IANA_RDAP_DNS_BOOTSTRAP_URL) {
          return jsonResponse(bootstrap("com"));
        }
        return jsonResponse({
          objectClassName: "domain",
          events: [
            {
              eventAction: "last changed",
              eventDate: "2026-05-01T00:00:00.000Z",
            },
            {
              eventAction: "registration",
              eventDate: "2024-02-03T04:05:06.000Z",
            },
            {
              eventAction: "reregistration",
              eventDate: "2025-02-03T04:05:06.000Z",
            },
          ],
          entities: [
            {
              events: [
                {
                  eventAction: "registration",
                  eventDate: "1999-01-01T00:00:00.000Z",
                },
              ],
            },
          ],
          ignored_extension: "remote text is not projected",
        });
      },
    });

    const result = await resolver.resolve("news.Example.COM.");

    expect(calls.map((call) => call.url)).toEqual([
      IANA_RDAP_DNS_BOOTSTRAP_URL,
      "https://rdap.registry.test/v1/domain/example.com",
    ]);
    expect(calls.every((call) => call.init?.redirect === "error")).toBe(true);
    expect(result).toEqual({
      domain: "example.com",
      availability: "available",
      registeredAt: "2024-02-03T04:05:06.000Z",
      observedAt: "2026-08-20T12:00:00.000Z",
      sourceHost: "rdap.registry.test",
      reason: null,
    });
  });

  it("keeps a missing registration distinct from reregistration-only and last-changed-only data", async () => {
    const payloads = [
      { events: [] },
      {
        events: [
          {
            eventAction: "reregistration",
            eventDate: "2025-01-01T00:00:00.000Z",
          },
        ],
      },
      {
        events: [
          {
            eventAction: "last changed",
            eventDate: "2025-01-01T00:00:00.000Z",
          },
        ],
      },
    ];
    let index = 0;
    const resolver = createDomainRegistrationResolver({
      now: () => OBSERVED_AT,
      fetchImpl: async (input) =>
        String(input) === IANA_RDAP_DNS_BOOTSTRAP_URL
          ? jsonResponse(bootstrap("com"))
          : jsonResponse(payloads[index++]),
    });

    const missing = await resolver.resolve("missing.com");
    const reregistered = await resolver.resolve("reregistered.com");
    const changed = await resolver.resolve("changed.com");

    expect(missing.reason).toBe("registration_event_missing");
    expect(reregistered.reason).toBe("reregistration_only");
    expect(changed.reason).toBe("last_changed_only");
    expect([missing, reregistered, changed]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          availability: "unavailable",
          registeredAt: null,
        }),
      ]),
    );
  });

  it("reports a malformed top-level registration date as unavailable", async () => {
    const resolver = createDomainRegistrationResolver({
      now: () => OBSERVED_AT,
      fetchImpl: async (input) =>
        String(input) === IANA_RDAP_DNS_BOOTSTRAP_URL
          ? jsonResponse(bootstrap("com"))
          : jsonResponse({
              events: [
                { eventAction: "registration", eventDate: "not-a-date" },
              ],
            }),
    });

    await expect(resolver.resolve("example.com")).resolves.toMatchObject({
      availability: "unavailable",
      registeredAt: null,
      reason: "registration_date_malformed",
      sourceHost: "rdap.registry.test",
    });
  });

  it.each([
    "2025-02-30T00:00:00Z",
    "2025-13-01T00:00:00Z",
    "2025-01-01T24:00:00Z",
    "2025-01-01T00:00:00+24:00",
    "2025-01-01T00:00:00+01:60",
  ])("rejects an impossible registration timestamp: %s", async (eventDate) => {
    const resolver = createDomainRegistrationResolver({
      now: () => OBSERVED_AT,
      fetchImpl: async (input) =>
        String(input) === IANA_RDAP_DNS_BOOTSTRAP_URL
          ? jsonResponse(bootstrap("com"))
          : jsonResponse({
              events: [{ eventAction: "registration", eventDate }],
            }),
    });

    await expect(resolver.resolve("example.com")).resolves.toMatchObject({
      availability: "unavailable",
      registeredAt: null,
      reason: "registration_date_malformed",
    });
  });

  it("accepts a valid leap day and canonicalizes a timezone timestamp", async () => {
    const resolver = createDomainRegistrationResolver({
      now: () => OBSERVED_AT,
      fetchImpl: async (input) =>
        String(input) === IANA_RDAP_DNS_BOOTSTRAP_URL
          ? jsonResponse(bootstrap("com"))
          : jsonResponse({
              events: [
                {
                  eventAction: "registration",
                  eventDate: "2024-02-29T23:59:59.123456789+05:30",
                },
              ],
            }),
    });

    await expect(resolver.resolve("example.com")).resolves.toMatchObject({
      availability: "available",
      registeredAt: "2024-02-29T18:29:59.123Z",
      reason: null,
    });
  });

  it("returns unsupported_tld when the official bootstrap has no registry", async () => {
    let calls = 0;
    const resolver = createDomainRegistrationResolver({
      now: () => OBSERVED_AT,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(bootstrap("com"));
      },
    });

    await expect(resolver.resolve("example.zz")).resolves.toEqual({
      domain: null,
      availability: "unavailable",
      registeredAt: null,
      observedAt: "2026-08-20T12:00:00.000Z",
      sourceHost: null,
      reason: "unsupported_tld",
    });
    expect(calls).toBe(1);
  });

  it("retries the bootstrap after an aborted bootstrap read", async () => {
    let bootstrapCalls = 0;
    const resolver = createDomainRegistrationResolver({
      now: () => OBSERVED_AT,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url === IANA_RDAP_DNS_BOOTSTRAP_URL) {
          bootstrapCalls += 1;
          if (bootstrapCalls === 1) {
            throw new DOMException("fixture abort", "AbortError");
          }
          return jsonResponse(bootstrap("com"));
        }
        return jsonResponse({
          events: [
            {
              eventAction: "registration",
              eventDate: "2025-01-01T00:00:00.000Z",
            },
          ],
        });
      },
    });

    expect((await resolver.resolve("example.com")).reason).toBe(
      "bootstrap_unavailable",
    );
    await expect(resolver.resolve("example.com")).resolves.toMatchObject({
      availability: "available",
      registeredAt: "2025-01-01T00:00:00.000Z",
    });
    expect(bootstrapCalls).toBe(2);
  });

  it("shares one successful bootstrap read across concurrent callers", async () => {
    let bootstrapCalls = 0;
    let releaseBootstrap: (() => void) | undefined;
    const bootstrapGate = new Promise<void>((resolve) => {
      releaseBootstrap = resolve;
    });
    const resolver = createDomainRegistrationResolver({
      now: () => OBSERVED_AT,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url === IANA_RDAP_DNS_BOOTSTRAP_URL) {
          bootstrapCalls += 1;
          await bootstrapGate;
          return jsonResponse(bootstrap("com"));
        }
        return jsonResponse({
          events: [
            {
              eventAction: "registration",
              eventDate: "2025-01-01T00:00:00.000Z",
            },
          ],
        });
      },
    });

    const first = resolver.resolve("first.com");
    const second = resolver.resolve("second.com");
    await expect.poll(() => bootstrapCalls).toBe(1);
    releaseBootstrap?.();

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ availability: "available" }),
      expect.objectContaining({ availability: "available" }),
    ]);
    expect(bootstrapCalls).toBe(1);
  });

  it("isolates one caller abort while sharing the bootstrap with a sibling", async () => {
    let bootstrapCalls = 0;
    const registryCalls: string[] = [];
    let releaseBootstrap: (() => void) | undefined;
    const bootstrapGate = new Promise<void>((resolve) => {
      releaseBootstrap = resolve;
    });
    const firstController = new AbortController();
    const resolver = createDomainRegistrationResolver({
      now: () => OBSERVED_AT,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url === IANA_RDAP_DNS_BOOTSTRAP_URL) {
          bootstrapCalls += 1;
          await bootstrapGate;
          return jsonResponse(bootstrap("com"));
        }
        registryCalls.push(url);
        return jsonResponse({
          events: [
            {
              eventAction: "registration",
              eventDate: "2025-01-01T00:00:00.000Z",
            },
          ],
        });
      },
    });

    const first = resolver.resolve("first.com", firstController.signal);
    const second = resolver.resolve("second.com");
    await expect.poll(() => bootstrapCalls).toBe(1);
    firstController.abort();
    releaseBootstrap?.();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toMatchObject({
      domain: "first.com",
      availability: "unavailable",
      registeredAt: null,
      reason: "registry_unavailable",
    });
    expect(secondResult).toMatchObject({
      domain: "second.com",
      availability: "available",
      registeredAt: "2025-01-01T00:00:00.000Z",
    });
    expect(bootstrapCalls).toBe(1);
    expect(registryCalls).toEqual([
      "https://rdap.registry.test/v1/domain/second.com",
    ]);
  });

  it("reports an authoritative registry 404 as domain_not_found", async () => {
    const resolver = createDomainRegistrationResolver({
      now: () => OBSERVED_AT,
      fetchImpl: async (input) =>
        String(input) === IANA_RDAP_DNS_BOOTSTRAP_URL
          ? jsonResponse(bootstrap("com"))
          : new Response(null, { status: 404 }),
    });

    await expect(resolver.resolve("missing.com")).resolves.toMatchObject({
      domain: "missing.com",
      availability: "unavailable",
      registeredAt: null,
      sourceHost: "rdap.registry.test",
      reason: "domain_not_found",
    });
  });

  it("keeps an IANA bootstrap 404 as bootstrap_unavailable", async () => {
    const resolver = createDomainRegistrationResolver({
      now: () => OBSERVED_AT,
      fetchImpl: async () => new Response(null, { status: 404 }),
    });

    expect((await resolver.resolve("missing.com")).reason).toBe(
      "bootstrap_unavailable",
    );
  });

  it("fails closed when the IANA bootstrap shape or HTTPS registry URL is malformed", async () => {
    const malformedShape = createDomainRegistrationResolver({
      now: () => OBSERVED_AT,
      fetchImpl: async () => jsonResponse({ services: "not-an-array" }),
    });
    const insecureRegistry = createDomainRegistrationResolver({
      now: () => OBSERVED_AT,
      fetchImpl: async () =>
        jsonResponse(bootstrap("com", ["http://rdap.registry.test/"])),
    });

    expect((await malformedShape.resolve("example.com")).reason).toBe(
      "bootstrap_malformed",
    );
    expect((await insecureRegistry.resolve("example.com")).reason).toBe(
      "bootstrap_malformed",
    );
  });

  it("normalizes IDNs to an ASCII registrable domain without accepting paths or ports", async () => {
    const calls: string[] = [];
    const resolver = createDomainRegistrationResolver({
      now: () => OBSERVED_AT,
      fetchImpl: async (input) => {
        const url = String(input);
        calls.push(url);
        return url === IANA_RDAP_DNS_BOOTSTRAP_URL
          ? jsonResponse(bootstrap("de"))
          : jsonResponse({
              events: [
                {
                  eventAction: "registration",
                  eventDate: "2025-01-01T00:00:00.000Z",
                },
              ],
            });
      },
    });

    expect(await resolver.resolve("shop.bücher.de")).toMatchObject({
      domain: "xn--bcher-kva.de",
      availability: "available",
    });
    expect(calls[1]).toBe(
      "https://rdap.registry.test/v1/domain/xn--bcher-kva.de",
    );
    for (const invalid of [
      "https://example.com/path",
      "user@example.com",
      "example.com:443",
    ]) {
      expect(await resolver.resolve(invalid)).toMatchObject({
        domain: null,
        availability: "unavailable",
        reason: "invalid_domain",
      });
    }
    expect(calls).toHaveLength(2);
  });

  it("uses the IANA uk bootstrap key but queries the complete co.uk registrable domain", async () => {
    const calls: string[] = [];
    const resolver = createDomainRegistrationResolver({
      now: () => OBSERVED_AT,
      fetchImpl: async (input) => {
        const url = String(input);
        calls.push(url);
        return url === IANA_RDAP_DNS_BOOTSTRAP_URL
          ? jsonResponse(bootstrap("uk"))
          : jsonResponse({
              events: [
                {
                  eventAction: "registration",
                  eventDate: "2024-01-01T00:00:00.000Z",
                },
              ],
            });
      },
    });

    await expect(resolver.resolve("news.example.co.uk")).resolves.toMatchObject(
      {
        domain: "example.co.uk",
        availability: "available",
      },
    );
    expect(calls).toEqual([
      IANA_RDAP_DNS_BOOTSTRAP_URL,
      "https://rdap.registry.test/v1/domain/example.co.uk",
    ]);
  });

  it("uses the ICANN registrable domain for a private-suffix RDAP lookup", async () => {
    const calls: string[] = [];
    const resolver = createDomainRegistrationResolver({
      now: () => OBSERVED_AT,
      fetchImpl: async (input) => {
        const url = String(input);
        calls.push(url);
        return url === IANA_RDAP_DNS_BOOTSTRAP_URL
          ? jsonResponse(bootstrap("io"))
          : jsonResponse({
              events: [
                {
                  eventAction: "registration",
                  eventDate: "2024-01-01T00:00:00.000Z",
                },
              ],
            });
      },
    });

    await expect(resolver.resolve("foo.github.io")).resolves.toMatchObject({
      domain: "github.io",
      availability: "available",
    });
    expect(calls[1]).toBe(
      "https://rdap.registry.test/v1/domain/github.io",
    );
  });

  it("rejects an underscore hostname without reading the bootstrap", async () => {
    let calls = 0;
    const resolver = createDomainRegistrationResolver({
      now: () => OBSERVED_AT,
      fetchImpl: async () => {
        calls += 1;
        throw new Error("must not run");
      },
    });

    await expect(resolver.resolve("foo_bar.com")).resolves.toMatchObject({
      domain: null,
      availability: "unavailable",
      reason: "invalid_domain",
    });
    expect(calls).toBe(0);
  });

  it("bounds decoded response bytes and per-call time without following redirects", async () => {
    const oversized = createDomainRegistrationResolver({
      now: () => OBSERVED_AT,
      maxResponseBytes: 32,
      fetchImpl: async () =>
        jsonResponse({ services: [], padding: "x".repeat(100) }),
    });
    const timedOut = createDomainRegistrationResolver({
      now: () => OBSERVED_AT,
      timeoutMs: 5,
      fetchImpl: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    });

    expect((await oversized.resolve("example.com")).reason).toBe(
      "bootstrap_unavailable",
    );
    expect((await timedOut.resolve("example.com")).reason).toBe(
      "bootstrap_unavailable",
    );
  });
});
