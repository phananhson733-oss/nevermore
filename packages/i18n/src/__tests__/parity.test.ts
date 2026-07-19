import { describe, it, expect } from "vitest";

import en from "../messages/en.json";
import zhCN from "../messages/zh-CN.json";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * Recursively collect the full dotted key paths of a message object.
 * Only object nodes are descended into; every leaf (including arrays and
 * primitives) yields a terminal path. Backs AC-011 (locale key parity).
 */
function collectKeyPaths(value: Json, prefix = ""): readonly string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }

  return Object.keys(value)
    .sort()
    .flatMap((key) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      return collectKeyPaths(value[key] as Json, nextPrefix);
    });
}

describe("i18n message key parity", () => {
  const enPaths = collectKeyPaths(en as unknown as Json);
  const zhPaths = collectKeyPaths(zhCN as unknown as Json);
  const enSet = new Set(enPaths);
  const zhSet = new Set(zhPaths);

  const missingInZh = enPaths.filter((path) => !zhSet.has(path));
  const missingInEn = zhPaths.filter((path) => !enSet.has(path));

  it("has no keys present in en but missing in zh-CN", () => {
    expect(missingInZh, `Keys in en.json missing from zh-CN.json:\n${missingInZh.join("\n")}`).toEqual([]);
  });

  it("has no keys present in zh-CN but missing in en", () => {
    expect(missingInEn, `Keys in zh-CN.json missing from en.json:\n${missingInEn.join("\n")}`).toEqual([]);
  });

  it("has identical key sets across locales", () => {
    expect(new Set(enPaths)).toEqual(new Set(zhPaths));
  });

  it("localizes the GA4 key-event input placeholder instead of hardcoding UI chrome", () => {
    expect(en.sources.keyEventsPlaceholder).toBe("purchase, sign_up");
    expect(zhCN.sources.keyEventsPlaceholder).toBe("购买, 注册");
  });
});
