import { describe, expect, it } from "vitest";
import {
  isBlockedHost,
  isBlockedIp,
  mappedIpv4,
  normaliseIpv4,
} from "./classify-ip.ts";

describe("IP literal normalization", () => {
  it.each([
    ["", null],
    ["127.0.0.1:80", null],
    ["1.2.3.4.5", null],
    ["1..2", null],
    ["09.0.0.1", null],
    ["abc", null],
    ["0xgg", null],
    ["4294967296", null],
    ["256.1", null],
    ["1.16777216", null],
    ["256.1.1", null],
    ["1.256.1", null],
    ["1.1.65536", null],
    ["1.2.3.256", null],
    ["1", "0.0.0.1"],
    ["127.1", "127.0.0.1"],
    ["127.0.1", "127.0.0.1"],
    ["192.0.2.8", "192.0.2.8"],
    ["0300.0.0002.010", "192.0.2.8"],
    ["0xc0.0x0.0x2.0x8", "192.0.2.8"],
  ])("normalizes %s without accepting overflow or ambiguous syntax", (raw, expected) => {
    expect(normaliseIpv4(raw)).toBe(expected);
  });

  it("extracts only valid IPv4-mapped IPv6 values", () => {
    expect(mappedIpv4("::ffff:192.0.2.8")).toBe("192.0.2.8");
    expect(mappedIpv4("::ffff:c000:0208")).toBe("192.0.2.8");
    expect(mappedIpv4("2001:4860:4860::8888")).toBeNull();
    expect(mappedIpv4("1::2::3")).toBeNull();
    expect(mappedIpv4("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(mappedIpv4("1:2:3:4:5:6:7:zzzz")).toBeNull();
    expect(mappedIpv4("::ffff:999.1.1.1")).toBeNull();
  });
});

describe("public egress classification", () => {
  it("recognizes metadata hostnames case-insensitively", () => {
    expect(isBlockedHost("metadata.google.internal")).toBe(true);
    expect(isBlockedHost("METADATA.GOOGLE.INTERNAL")).toBe(true);
    expect(isBlockedHost("example.com")).toBe(false);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "::ffff:8.8.8.8",
    "2001:4860:4860::8888",
    "2404:6800:4003:c02::65",
    "2606:4700:4700::1111",
  ])("allows globally routable address %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });

  it.each([
    "169.254.169.254",
    "fd00:ec2::254",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "ff02::1",
    "2001:db8:ffff::1",
  ])("blocks metadata, mapped-private, and reserved address %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    "64:ff9b::a9fe:a9fe",
    "64:ff9b::7f00:1",
    "2002:a00:1::",
    "2002:a9fe:a9fe::",
    "2001::1",
    "2001:2::1",
    "2001:db8::1",
    "3fff::1",
    "1000::1",
    "4000::1",
  ])("fails closed for translated, transition, or special IPv6 address %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(["not-an-ip", "999.1.1.1", "1::2::3", ""])(
    "fails closed for malformed destination %s",
    (ip) => {
      expect(isBlockedIp(ip)).toBe(true);
    },
  );
});
