import { describe, expect, it } from "vitest";
import { isCitabilityCanaryHtml, readCitabilityCanaryCredentials } from "./citability-ai-canary.ts";

describe("manual AI canary process-only credentials", () => {
  it("selects only the provider variables from an explicitly selected process environment", async () => {
    await expect(readCitabilityCanaryCredentials("-", {
      DATAFORSEO_LOGIN: "test-login", DATAFORSEO_PASSWORD: "test-password",
      CITABILITY_AI_MODEL_NAME: "gpt-4.1-mini", DATABASE_URL: "must-not-forward", RAILWAY_TOKEN: "must-not-forward",
    })).resolves.toEqual({ DATAFORSEO_LOGIN: "test-login", DATAFORSEO_PASSWORD: "test-password", CITABILITY_AI_MODEL_NAME: "gpt-4.1-mini" });
  });
  it("does not invent absent process credentials or read a fallback file", async () => {
    await expect(readCitabilityCanaryCredentials("-", {})).resolves.toEqual({
      DATAFORSEO_LOGIN: undefined, DATAFORSEO_PASSWORD: undefined, CITABILITY_AI_MODEL_NAME: undefined,
    });
  });
});

describe("manual AI canary uses the production encoding gate before spending", () => {
  it.each(["text/html; charset=gb2312", "text/html; charset=shift_jis", "application/xhtml+xml; charset=iso-8859-1"])("rejects %s", (type) => {
    expect(isCitabilityCanaryHtml(type, "<html>untrusted decoded page</html>")).toBe(false);
  });
  it("rejects suspicious replacement-character density without a charset", () => {
    expect(isCitabilityCanaryHtml("text/html", "<p>\ufffd\ufffd\ufffd\ufffd</p>")).toBe(false);
  });
  it.each(["text/html", "text/html; charset=UTF-8", 'text/html; charset="utf8"', "application/xhtml+xml; charset=us-ascii"])("accepts supported HTML %s", (type) => {
    expect(isCitabilityCanaryHtml(type, "<html>Actual readable text</html>")).toBe(true);
  });
  it("rejects a non-HTML body", () => {
    expect(isCitabilityCanaryHtml("application/json", "{}")).toBe(false);
  });
});
