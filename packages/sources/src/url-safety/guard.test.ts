import { afterEach, describe, expect, it, vi } from "vitest";
import { isBlockedIp, normaliseIpv4 } from "./classify-ip.ts";
import {
  createCanonicalUrlGuard,
  DEFAULT_DNS_LOOKUP_TIMEOUT_MS,
} from "./guard.ts";

const guard = createCanonicalUrlGuard({ lookup: async () => ["93.184.216.34"] });

afterEach(() => {
  vi.useRealTimers();
});

describe("canonical URL guard", () => {
  it("accepts a public HTTPS host and returns a pinned address", async () => {
    await expect(guard("https://www.example.com/a")).resolves.toEqual({ safe: true, normalizedUrl: "https://www.example.com/a", pinnedIp: "93.184.216.34", reason: null });
  });

  it("preserves exact fetch-path slash semantics and normalizes default ports", async () => {
    await expect(
      guard("https://www.example.com:443/products/growth/?plan=pro"),
    ).resolves.toEqual({
      safe: true,
      normalizedUrl:
        "https://www.example.com/products/growth/?plan=pro",
      pinnedIp: "93.184.216.34",
      reason: null,
    });
    await expect(guard("http://www.example.com:80/docs/")).resolves.toEqual({
      safe: true,
      normalizedUrl: "http://www.example.com/docs/",
      pinnedIp: "93.184.216.34",
      reason: null,
    });
  });

  it.each([
    "https://customer-secret.example:8443/path",
    "http://customer-secret.example:2375/",
  ])(
    "rejects a non-standard transport port before DNS without leaking target details: %s",
    async (rawUrl) => {
      const lookup = vi.fn(async () => ["93.184.216.34"]);
      const portGuard = createCanonicalUrlGuard({ lookup });

      const result = await portGuard(rawUrl);

      expect(result).toEqual({
        safe: false,
        normalizedUrl: null,
        pinnedIp: null,
        reason: "Only standard HTTP(S) ports are allowed",
      });
      expect(lookup).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain("customer-secret.example");
      expect(JSON.stringify(result)).not.toContain("8443");
      expect(JSON.stringify(result)).not.toContain("2375");
      expect(JSON.stringify(result)).not.toContain("93.184.216.34");
    },
  );

  it("rejects non-HTTP schemes and credentials", async () => {
    expect((await guard("file:///etc/passwd")).safe).toBe(false);
    expect((await guard("https://user:pass@example.com/")).safe).toBe(false);
  });

  it("normalises decimal, octal, hexadecimal, abbreviated, and integer IPv4", () => {
    expect(normaliseIpv4("2130706433")).toBe("127.0.0.1");
    expect(normaliseIpv4("0x7f.0x0.0x0.0x1")).toBe("127.0.0.1");
    expect(normaliseIpv4("0177.0.0.1")).toBe("127.0.0.1");
    expect(normaliseIpv4("127.1")).toBe("127.0.0.1");
  });

  it("blocks private, reserved, metadata, and IPv4-mapped IPv6 destinations", async () => {
    for (const url of ["http://127.0.0.1/", "http://10.0.0.1/", "http://169.254.169.254/", "http://metadata.google.internal/", "http://[::ffff:127.0.0.1]/", "http://[fd00:ec2::254]/"]) {
      expect((await guard(url)).safe, url).toBe(false);
    }
  });

  it("blocks loopback, unspecified, ULA, and link-local IPv6", () => {
    for (const ip of ["::1", "::", "fc00::1", "fe80::1"]) expect(isBlockedIp(ip), ip).toBe(true);
  });

  it("fails closed for the full non-public address matrix, not only RFC1918", () => {
    for (const ip of [
      "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1", "192.168.1.1",
      "192.0.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "240.0.0.1",
      "::1", "::", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1",
    ]) expect(isBlockedIp(ip), ip).toBe(true);
  });

  it("fails closed on a DNS error or any private result in a multi-address response", async () => {
    const failing = createCanonicalUrlGuard({ lookup: async () => { throw new Error("dns failed"); } });
    const rebinding = createCanonicalUrlGuard({ lookup: async () => ["93.184.216.34", "127.0.0.1"] });
    expect((await failing("https://example.com/")).safe).toBe(false);
    expect((await rebinding("https://example.com/")).safe).toBe(false);
  });

  it("defines a finite production DNS lookup timeout shorter than a crawl request", () => {
    expect(DEFAULT_DNS_LOOKUP_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULT_DNS_LOOKUP_TIMEOUT_MS).toBeLessThan(30_000);
  });

  it("fails closed on DNS timeout without leaking the hostname or consuming a late result", async () => {
    vi.useFakeTimers();
    let resolveLookup: ((addresses: readonly string[]) => void) | undefined;
    const lookup = vi.fn(
      () =>
        new Promise<readonly string[]>((resolve) => {
          resolveLookup = resolve;
        }),
    );
    const timedGuard = createCanonicalUrlGuard({ lookup, dnsTimeoutMs: 25 });
    const pending = timedGuard("https://customer-secret.example/path");

    await vi.advanceTimersByTimeAsync(25);
    const result = await pending;

    expect(result).toEqual({
      safe: false,
      normalizedUrl: null,
      pinnedIp: null,
      reason: "DNS resolution timed out (fail closed)",
    });
    expect(result.reason).not.toContain("customer-secret.example");

    let lateAddressesInspected = false;
    const lateAddresses = new Proxy(["127.0.0.1"], {
      get(target, property, receiver) {
        if (property === "length" || property === "some" || property === "0") {
          lateAddressesInspected = true;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    resolveLookup?.(lateAddresses);
    await Promise.resolve();
    await Promise.resolve();
    expect(lateAddressesInspected).toBe(false);
    expect(result.safe).toBe(false);
  });

  it("does not invoke DNS lookup or create a DNS timer for an IP literal", async () => {
    vi.useFakeTimers();
    const lookup = vi.fn(async () => ["127.0.0.1"]);
    const literalGuard = createCanonicalUrlGuard({ lookup, dnsTimeoutMs: 25 });

    await expect(literalGuard("https://8.8.8.8/path")).resolves.toMatchObject({
      safe: true,
      pinnedIp: "8.8.8.8",
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
