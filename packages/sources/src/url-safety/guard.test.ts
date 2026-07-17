import { describe, expect, it } from "vitest";
import { isBlockedIp, normaliseIpv4 } from "./classify-ip.ts";
import { createCanonicalUrlGuard } from "./guard.ts";

const guard = createCanonicalUrlGuard({ lookup: async () => ["93.184.216.34"] });

describe("canonical URL guard", () => {
  it("accepts a public HTTPS host and returns a pinned address", async () => {
    await expect(guard("https://www.example.com/a")).resolves.toEqual({ safe: true, normalizedUrl: "https://www.example.com/a", pinnedIp: "93.184.216.34", reason: null });
  });

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
});
