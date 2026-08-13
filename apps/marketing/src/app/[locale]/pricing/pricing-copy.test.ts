// @input  -- active English and Chinese Pricing message bundles and page source
// @output -- regression guard for the account gate, stateless audit boundary, and Agent CTAs
// @pos    -- protects Pricing and FAQ JSON-LD copy from reviving the retired anonymous-audit funnel

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import en from "../../../i18n/messages/en.json" with { type: "json" };
import zh from "../../../i18n/messages/zh.json" with { type: "json" };

const PRICING_CLIENT = fileURLToPath(
  new URL("./pricing-page-client.tsx", import.meta.url),
);

describe("active Pricing Agent contract", () => {
  it.each([
    ["en", en.pricing],
    ["zh", zh.pricing],
  ] as const)("states the access and data boundaries in %s", (_locale, pricing) => {
    const copy = JSON.stringify(pricing);

    expect(copy).toMatch(/verified GenGrowth account|验证.*GenGrowth 账号/);
    expect(copy).toMatch(/No payment|无需付费/);
    expect(copy).toMatch(/no persistence|not saved|不会保存|不持久化/);
    expect(copy).not.toMatch(
      /without an account|no account|do not need an account|无需账号|不需要账号/,
    );
  });

  it("routes both current audit CTAs to the localized Agent directory", () => {
    const source = readFileSync(PRICING_CLIENT, "utf8");

    expect(source.match(/localePath\(locale, "\/agents"\)/g)).toHaveLength(2);
    expect(source).not.toContain('localePath(locale, "/tools")');
  });
});
