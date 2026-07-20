import { describe, expect, it } from "vitest";
import { SourceError } from "../adapter.ts";
import type { CsvKeywordProjection } from "../observations.ts";
import { normalizeCsv } from "./normalize.ts";
import type { CsvColumnMapping } from "./mapping.ts";

const OBSERVED_AT = "2026-07-18T00:00:00.000Z";

const MAPPING: CsvColumnMapping = {
  keyword: 0,
  searchVolume: 1,
  cluster: null,
  currentUrl: null,
  currentRank: null,
  competitorDomain: null,
  competitorRank: null,
  marketCode: 2,
  languageCode: 3,
};

const projectionOf = (value: unknown): CsvKeywordProjection => value as CsvKeywordProjection;

describe("normalizeCsv", () => {
  it("maps an empty searchVolume cell to null (never 0) on an available observation", () => {
    const text = "keyword,volume,market,language\nseo tools,,us,en-US\n";
    const { observations, rejectedRows } = normalizeCsv(text, MAPPING, { observedAt: OBSERVED_AT });
    expect(rejectedRows).toHaveLength(0);
    expect(observations).toHaveLength(1);
    const observation = observations[0]!;
    expect(observation.availability).toBe("available");
    expect(observation.metricKey).toBe("csv.keyword_gap.v1");
    expect(observation.subjectType).toBe("keyword_cluster");
    expect(observation.subjectRef).toBe("seo tools");
    expect(observation.origin).toBe("user_provided");
    expect(observation.grade).toBe("C");
    expect(observation.observedAt).toBe(OBSERVED_AT);
    const projection = projectionOf(observation.valueJson);
    expect(projection.searchVolume).toBeNull();
    expect(projection.marketCode).toBe("US");
    expect(projection.languageCode).toBe("en-US");
  });

  it("keeps a present searchVolume as an integer", () => {
    const text = "keyword,volume,market,language\nlink building,1200,GB,en-GB\n";
    const { observations } = normalizeCsv(text, MAPPING, { observedAt: OBSERVED_AT });
    expect(projectionOf(observations[0]!.valueJson).searchVolume).toBe(1200);
  });

  it.each(["en-US-u-hc-h12", "x-private", "i-klingon"])(
    "retains a structurally valid extended/private/grandfathered language tag %s",
    (languageCode) => {
      const text = `keyword,volume,market,language\nseo tools,100,US,${languageCode}\n`;
      const { observations, rejectedRows } = normalizeCsv(text, MAPPING, {
        observedAt: OBSERVED_AT,
      });

      expect(rejectedRows).toHaveLength(0);
      expect(projectionOf(observations[0]!.valueJson).languageCode).toBe(
        languageCode,
      );
    },
  );

  it.each(["de-1901-1901", "en-a-first-a-second", "en-u"])(
    "rejects a malformed language tag %s",
    (languageCode) => {
      const text = `keyword,volume,market,language\nseo tools,100,US,${languageCode}\n`;
      const { observations, rejectedRows } = normalizeCsv(text, MAPPING, {
        observedAt: OBSERVED_AT,
      });

      expect(observations).toHaveLength(0);
      expect(rejectedRows).toEqual([
        { rowIndex: 0, reason: "language_invalid" },
      ]);
    },
  );

  it("rejects rows failing keyword, cluster, market, or language rules", () => {
    const text = [
      "keyword,volume,market,language",
      ",100,US,en", // missing keyword
      "the,100,US,en", // cluster underivable (all stopwords)
      "seo tools,100,USA,en", // invalid market (3 letters)
      "seo tools,100,US,123", // invalid language
      "seo tools,100,US,en", // valid
    ].join("\n");
    const { observations, rejectedRows } = normalizeCsv(text, MAPPING, { observedAt: OBSERVED_AT });
    expect(observations).toHaveLength(1);
    expect(rejectedRows).toEqual([
      { rowIndex: 0, reason: "keyword_missing" },
      { rowIndex: 1, reason: "cluster_no_tokens" },
      { rowIndex: 2, reason: "market_invalid" },
      { rowIndex: 3, reason: "language_invalid" },
    ]);
  });

  it("uses a provided cluster column verbatim as the subjectRef", () => {
    const mapping: CsvColumnMapping = { ...MAPPING, cluster: 4 };
    const text = "keyword,volume,market,language,cluster\nseo audit tools,100,US,en,my-cluster\n";
    const { observations } = normalizeCsv(text, mapping, { observedAt: OBSERVED_AT });
    expect(observations[0]!.subjectRef).toBe("my-cluster");
    expect(projectionOf(observations[0]!.valueJson).clusterKey).toBe("my-cluster");
  });

  it("applies market/language fallbacks when columns are unmapped", () => {
    const mapping: CsvColumnMapping = { ...MAPPING, marketCode: null, languageCode: null };
    const text = "keyword,volume\nseo tools,900\n";
    const { observations } = normalizeCsv(text, mapping, {
      observedAt: OBSERVED_AT,
      marketFallback: "DE",
      languageFallback: "de-DE",
    });
    const projection = projectionOf(observations[0]!.valueJson);
    expect(projection.marketCode).toBe("DE");
    expect(projection.languageCode).toBe("de-DE");
  });

  it("normalizes optional url/rank/competitor fields and nulls invalid ones", () => {
    const mapping: CsvColumnMapping = {
      ...MAPPING,
      currentUrl: 4,
      currentRank: 5,
      competitorDomain: 6,
      competitorRank: 7,
    };
    const text =
      "keyword,volume,market,language,url,rank,comp,comprank\n" +
      "seo tools,100,US,en,not-a-url,4,https://rival.com/x,\n";
    const projection = projectionOf(normalizeCsv(text, mapping, { observedAt: OBSERVED_AT }).observations[0]!.valueJson);
    expect(projection.currentUrl).toBeNull();
    expect(projection.currentRank).toBe(4);
    expect(projection.competitorDomain).toBe("rival.com");
    expect(projection.competitorRank).toBeNull();
  });

  it("throws INVALID_CONFIGURATION when a required column is unmapped", () => {
    const mapping: CsvColumnMapping = { ...MAPPING, searchVolume: null };
    const text = "keyword,volume,market,language\nseo tools,100,US,en\n";
    try {
      normalizeCsv(text, mapping, { observedAt: OBSERVED_AT });
      throw new Error("expected normalizeCsv to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SourceError);
      expect((error as SourceError).code).toBe("INVALID_CONFIGURATION");
    }
  });
});
