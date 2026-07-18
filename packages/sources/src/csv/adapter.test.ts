import { describe, expect, it } from "vitest";
import { SourceError } from "../adapter.ts";
import type { CollectionContext, NormalizeContext, NormalizedObservation } from "../adapter.ts";
import { csvAdapter, type CsvParams } from "./adapter.ts";
import { suggestMapping } from "./mapping.ts";

const collectCtx: CollectionContext = {
  workspaceId: "ws",
  projectId: "pr",
  siteId: "si",
  runId: "run",
};

const normalizeCtx: NormalizeContext = {
  workspaceId: "ws",
  projectId: "pr",
  siteId: "si",
  capturedAt: "2026-07-18T00:00:00.000Z",
};

const TEXT = "keyword,volume,market,language\nseo tools,1200,US,en-US\nlink building,,GB,en-GB\n";
const PARAMS: CsvParams = {
  text: TEXT,
  mapping: suggestMapping(["keyword", "volume", "market", "language"]),
};

describe("csvAdapter", () => {
  it("advertises the csv.keyword_gap.v1 capability", async () => {
    const config = await csvAdapter.validateConfig({ templateId: "keyword_gap_v1" });
    const capabilities = await csvAdapter.capabilities(config);
    expect(capabilities[0]?.datasetKey).toBe("csv.keyword_gap.v1");
    expect(capabilities[0]?.operation).toBe("keyword_gap_import");
  });

  it("rejects an unsupported template in validateConfig", async () => {
    await expect(csvAdapter.validateConfig({ templateId: "nope" })).rejects.toBeInstanceOf(SourceError);
  });

  it("collect wraps the raw content with a row count and available result", async () => {
    const result = await csvAdapter.collect(PARAMS, collectCtx);
    expect(result.availability).toBe("available");
    expect(result.rowCount).toBe(2);
    expect(result.raw.text).toBe(TEXT);
  });

  it("normalize streams one observation per accepted row using ctx.capturedAt", async () => {
    const result = await csvAdapter.collect(PARAMS, collectCtx);
    const observations: NormalizedObservation[] = [];
    for await (const observation of csvAdapter.normalize(result.raw, normalizeCtx)) {
      observations.push(observation);
    }
    expect(observations).toHaveLength(2);
    expect(observations.every((o) => o.observedAt === normalizeCtx.capturedAt)).toBe(true);
    expect(observations.every((o) => o.metricKey === "csv.keyword_gap.v1")).toBe(true);
  });
});
