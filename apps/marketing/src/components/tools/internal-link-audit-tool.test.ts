import { describe, expect, it } from "vitest";

import { retryAfterMessage } from "./internal-link-audit-result-copy";

describe("internal link audit result copy", () => {
  it("formats a trusted Retry-After value without inventing a wait time", () => {
    expect(retryAfterMessage("42", "en")).toBe("Try again in 42 seconds.");
    expect(retryAfterMessage("42", "zh")).toBe("请在 42 秒后重试。");
    expect(retryAfterMessage("Fri, 31 Jul 2026 12:00:00 GMT", "en")).toBeNull();
    expect(retryAfterMessage(null, "zh")).toBeNull();
  });
});
