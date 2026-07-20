import { describe, expect, it, vi } from "vitest";
import {
  evidenceProviderLabel,
  LOCALIZED_EVIDENCE_PROVIDERS,
  type LocalizedEvidenceProvider,
} from "./_provider-label";

const EXPECTED_LABELS: Readonly<Record<LocalizedEvidenceProvider, string>> = {
  crawl: "Site crawl",
  gsc: "Search Console",
  ga4: "Google Analytics 4",
  csv: "CSV upload",
  dataforseo: "DataForSEO",
  ahrefs: "Ahrefs",
  semrush: "Semrush",
  system: "SignalFrame system",
  llm: "Language model",
};

describe("Plan evidence provider labels", () => {
  it("covers every canonical provider plus the two legacy display labels", () => {
    expect(LOCALIZED_EVIDENCE_PROVIDERS).toEqual([
      "crawl",
      "gsc",
      "ga4",
      "csv",
      "dataforseo",
      "ahrefs",
      "semrush",
      "system",
      "llm",
    ]);
  });

  it.each(LOCALIZED_EVIDENCE_PROVIDERS)(
    "localizes the %s provider through the provider namespace",
    (provider) => {
      const translate = vi.fn(
        (key: LocalizedEvidenceProvider) => EXPECTED_LABELS[key],
      );

      expect(evidenceProviderLabel(provider, translate, "Unavailable")).toBe(
        EXPECTED_LABELS[provider],
      );
      expect(translate).toHaveBeenCalledExactlyOnceWith(provider);
    },
  );

  it("normalizes casing for known provider enum values", () => {
    const translate = vi.fn(
      (key: LocalizedEvidenceProvider) => EXPECTED_LABELS[key],
    );

    expect(evidenceProviderLabel(" GSC ", translate, "Unavailable")).toBe(
      "Search Console",
    );
    expect(translate).toHaveBeenCalledExactlyOnceWith("gsc");
  });

  it("shows a trimmed unknown provider without asking i18n for a missing key", () => {
    const translate = vi.fn(
      (key: LocalizedEvidenceProvider) => EXPECTED_LABELS[key],
    );

    expect(
      evidenceProviderLabel(" future-provider ", translate, "Unavailable"),
    ).toBe("future-provider");
    expect(translate).not.toHaveBeenCalled();
  });

  it("uses the localized unavailable label for an empty provider", () => {
    const translate = vi.fn(
      (key: LocalizedEvidenceProvider) => EXPECTED_LABELS[key],
    );

    expect(evidenceProviderLabel("   ", translate, "Unavailable")).toBe(
      "Unavailable",
    );
    expect(translate).not.toHaveBeenCalled();
  });
});
