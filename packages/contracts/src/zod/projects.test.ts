import { describe, expect, it } from "vitest";
import {
  CreateProjectRequest,
  CreateProjectWireRequest,
} from "./projects.ts";

const body = (siteUrl: string) => ({
  clientName: "Acme",
  projectName: "Acme Growth",
  siteUrl,
  marketCodes: ["US"],
  siteLanguageCodes: ["en"],
  defaultDeliveryLocale: "en",
});

describe("CreateProjectRequest siteUrl", () => {
  it("preserves a valid legacy URL in the wire schema for idempotency lookup", () => {
    const siteUrl = "https://example.com/customer-path?campaign=legacy";
    const parsed = CreateProjectWireRequest.safeParse(body(siteUrl));

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.siteUrl).toBe(siteUrl);
  });

  it("accepts only origin-preserving HTTP(S) URLs", () => {
    expect(CreateProjectRequest.safeParse(body("https://example.com")).success).toBe(true);
    expect(CreateProjectRequest.safeParse(body("http://example.com:8080/")).success).toBe(true);
  });

  it.each([
    "ftp://example.com",
    "https://user:password@example.com",
    "https://example.com/customer-path",
    "https://example.com/?campaign=private",
    "https://example.com/#fragment",
  ])("rejects a URL whose target cannot be stored honestly: %s", (siteUrl) => {
    const result = CreateProjectRequest.safeParse(body(siteUrl));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["siteUrl"]);
    }
  });
});
