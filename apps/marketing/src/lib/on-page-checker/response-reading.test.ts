import { describe, expect, it } from "vitest";

import { redirectTargetOf } from "./response-reading.ts";

function headersWithLocation(value: string | null): Headers {
  if (value?.includes("\u0000")) {
    return {
      get: (name: string) =>
        name.toLowerCase() === "location" ? value : null,
    } as unknown as Headers;
  }
  const headers = new Headers();
  if (value !== null) headers.set("Location", value);
  return headers;
}

describe("redirectTargetOf", () => {
  it("returns a bounded same-family replacement page", () => {
    const target = "https://www.acme.test/new/?a=1&b=2";

    expect(
      redirectTargetOf(
        new Headers({ Location: target }),
        "acme.test/old?a=1&b=2",
      ),
    ).toBe(target);
  });

  it("allows HTTPS upgrade on the exact host", () => {
    expect(
      redirectTargetOf(
        new Headers({ Location: "https://acme.test/new" }),
        "http://acme.test/old",
      ),
    ).toBe("https://acme.test/new");
  });

  it("does not treat a stacked www hostname as the apex/www family", () => {
    expect(
      redirectTargetOf(
        new Headers({ Location: "https://www.www.acme.test/new" }),
        "https://www.acme.test/old",
      ),
    ).toBeNull();
  });

  it("rejects the same page after scheme, host, slash, tracking, and query normalization", () => {
    expect(
      redirectTargetOf(
        new Headers({
          Location:
            "https://www.acme.test/old/?utm_medium=test&b=2&a=1",
        }),
        "http://acme.test/old?a=1&b=2&utm_source=test",
      ),
    ).toBeNull();
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["relative", "/new"],
    ["non-HTTP", "javascript:alert(1)"],
    ["cross-host", "https://evil.test/new"],
    ["sibling subdomain", "https://docs.acme.test/new"],
    ["credential-bearing", "https://user:secret@acme.test/new"],
    ["fragment-bearing", "https://acme.test/new#private"],
    ["non-default port", "https://acme.test:8443/new"],
    ["explicit default port", "https://acme.test:443/new"],
    ["whitespace-bearing", "https://acme.test/new page"],
    ["control-bearing", "https://acme.test/new\u0000page"],
    ["backslash-bearing", "https://acme.test\\new"],
    ["HTTPS downgrade", "http://acme.test/new"],
    [
      "overlong",
      `https://acme.test/${"a".repeat(2_048)}`,
    ],
  ])("rejects a %s Location", (_label, location) => {
    expect(
      redirectTargetOf(
        headersWithLocation(location),
        "https://acme.test/old?a=1&b=2&utm_source=test",
      ),
    ).toBeNull();
  });
});
