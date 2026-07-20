import { describe, expect, it } from "vitest";
import {
  buildProjectReportPath,
  normalizeOutputLocale,
} from "./hooks-report";

describe("Report locale helpers", () => {
  it("keeps a valid BCP-47 output locale", () => {
    expect(normalizeOutputLocale("fr-FR")).toBe("fr-FR");
    expect(normalizeOutputLocale(" pt-BR ")).toBe("pt-BR");
    // RFC 5646 reserves 5-8 alpha primary-language subtags structurally.
    expect(normalizeOutputLocale("english")).toBe("english");
  });

  it("drops blank and invalid output locales", () => {
    expect(normalizeOutputLocale("")).toBeUndefined();
    expect(normalizeOutputLocale("  ")).toBeUndefined();
    expect(normalizeOutputLocale("en_US")).toBeUndefined();
  });

  it("builds the report path only for valid locales", () => {
    expect(buildProjectReportPath("project-1", "fr-FR")).toBe(
      "/projects/project-1/report?outputLocale=fr-FR",
    );
    expect(buildProjectReportPath("project-1", "  ")).toBe(
      "/projects/project-1/report",
    );
    expect(buildProjectReportPath("project-1", "en_US")).toBe(
      "/projects/project-1/report",
    );
  });
});
