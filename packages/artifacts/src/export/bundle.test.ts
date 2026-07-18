import { describe, expect, it } from "vitest";
import { assembleBundle } from "./bundle.ts";
import type { BundleInput } from "./bundle.ts";
import type { Manifest } from "./manifest.ts";
import { readZip } from "./zip.ts";

const EXPORT_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const SNAPSHOT_A = "33333333-3333-4333-8333-333333333333";
const SNAPSHOT_B = "44444444-4444-4444-8444-444444444444";

const SHA256_HEX = /^[a-f0-9]{64}$/;
const FILE_PATH = /^(?!\/)(?!.*\.\.\/)[A-Za-z0-9._/-]+$/;
const MEDIA_TYPES: ReadonlySet<string> = new Set([
  "application/json",
  "application/x-ndjson",
  "text/markdown; charset=utf-8",
  "text/csv; charset=utf-8",
]);

const REQUIRED_MANIFEST_KEYS = [
  "schemaVersion",
  "productVersion",
  "contractVersion",
  "exportId",
  "projectId",
  "kind",
  "generatedAt",
  "outputLocale",
  "ruleSetVersion",
  "sourceSnapshotIds",
  "files",
  "itemCounts",
] as const;

const REQUIRED_ITEM_COUNT_KEYS = [
  "projects",
  "contexts",
  "sources",
  "snapshots",
  "observations",
  "findings",
  "evidence",
  "actions",
  "artifacts",
  "artifactRevisions",
] as const;

function baseInput(kind: BundleInput["kind"]): BundleInput {
  return {
    exportId: EXPORT_ID,
    projectId: PROJECT_ID,
    kind,
    generatedAt: "2026-07-18T10:00:00.000Z",
    outputLocale: "en",
    sourceSnapshotIds: [SNAPSHOT_A, SNAPSHOT_B],
    project: { id: PROJECT_ID, name: "Acme" },
    context: { productName: "Acme SEO" },
    sources: [{ id: "s1", kind: "crawl" }],
    snapshots: [{ id: SNAPSHOT_A }, { id: SNAPSHOT_B }],
    observations: [
      { metricKey: "crawl.robots", availability: "available" },
      { metricKey: "gsc.decay", availability: "unavailable", value: null },
    ],
    findings: [
      { ruleId: "geo.crawler", reviewState: "confirmed" },
      { ruleId: "content.coverage", reviewState: "unreviewed" },
      { ruleId: "tech.linkgraph", reviewState: "ignored" },
      { ruleId: "cro.path", reviewState: "needs_more_data" },
    ],
    evidence: [{ evidenceId: "e1", grade: "A" }],
    actions: [{ id: "a1", title: "Fix robots" }],
    artifacts: [
      {
        id: "aaaaaaaa-0000-4000-8000-000000000001",
        status: "ready",
        revisions: [
          { revision: 1, contentFormat: "markdown", content: "# Brief\n" },
          { revision: 2, contentFormat: "json", content: { title: "Rewrite" } },
        ],
      },
      {
        id: "bbbbbbbb-0000-4000-8000-000000000002",
        status: "draft",
        revisions: [{ revision: 1, contentFormat: "markdown", content: "# Draft\n" }],
      },
    ],
  };
}

function pathsOf(zip: Buffer): readonly string[] {
  return readZip(zip).map((e) => e.path);
}

function manifestOf(zip: Buffer): Manifest {
  const manifestEntry = readZip(zip).find((e) => e.path === "manifest.json");
  expect(manifestEntry).toBeDefined();
  return JSON.parse(manifestEntry!.data.toString("utf8")) as Manifest;
}

describe("assembleBundle — service_bundle", () => {
  it("includes observations.ndjson and every canonical section", () => {
    const { zip } = assembleBundle(baseInput("service_bundle"));
    const paths = pathsOf(zip);
    expect(paths).toContain("manifest.json");
    expect(paths).toContain("project.json");
    expect(paths).toContain("context.json");
    expect(paths).toContain("sources.json");
    expect(paths).toContain("snapshots.json");
    expect(paths).toContain("observations.ndjson");
    expect(paths).toContain("findings.json");
    expect(paths).toContain("evidence.json");
    expect(paths).toContain("actions.json");
  });

  it("lays out artifact revisions under artifacts/<id>/revision-<n>.<ext>", () => {
    const { zip } = assembleBundle(baseInput("service_bundle"));
    const paths = pathsOf(zip);
    expect(paths).toContain("artifacts/aaaaaaaa-0000-4000-8000-000000000001/revision-1.md");
    expect(paths).toContain(
      "artifacts/aaaaaaaa-0000-4000-8000-000000000001/revision-2.json",
    );
  });

  it("serializes observations.ndjson as one JSON object per line", () => {
    const { zip } = assembleBundle(baseInput("service_bundle"));
    const obs = readZip(zip).find((e) => e.path === "observations.ndjson");
    const lines = obs!.data.toString("utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("keeps ignored/needs_more_data findings in the service bundle", () => {
    const { itemCounts } = assembleBundle(baseInput("service_bundle"));
    expect(itemCounts["findings"]).toBe(4);
    expect(itemCounts["observations"]).toBe(2);
    expect(itemCounts["artifacts"]).toBe(2);
    expect(itemCounts["artifactRevisions"]).toBe(3);
  });
});

describe("assembleBundle — client_bundle exclusions", () => {
  it("does NOT include observations.ndjson", () => {
    const { zip } = assembleBundle(baseInput("client_bundle"));
    expect(pathsOf(zip)).not.toContain("observations.ndjson");
  });

  it("excludes ignored and needs_more_data findings", () => {
    const { zip, itemCounts } = assembleBundle(baseInput("client_bundle"));
    expect(itemCounts["findings"]).toBe(2);
    expect(itemCounts["observations"]).toBe(0);
    const findingsEntry = readZip(zip).find((e) => e.path === "findings.json");
    const findings = JSON.parse(findingsEntry!.data.toString("utf8")) as readonly {
      readonly reviewState: string;
    }[];
    const states = findings.map((f) => f.reviewState);
    expect(states).not.toContain("ignored");
    expect(states).not.toContain("needs_more_data");
    expect(states).toEqual(["confirmed", "unreviewed"]);
  });

  it("excludes draft artifacts", () => {
    const { zip, itemCounts } = assembleBundle(baseInput("client_bundle"));
    expect(itemCounts["artifacts"]).toBe(1);
    const paths = pathsOf(zip);
    expect(paths).toContain("artifacts/aaaaaaaa-0000-4000-8000-000000000001/revision-1.md");
    expect(
      paths.some((p) => p.startsWith("artifacts/bbbbbbbb-0000-4000-8000-000000000002/")),
    ).toBe(false);
  });
});

describe("assembleBundle — manifest & checksum", () => {
  it("produces a manifest with all required keys and pinned version literals", () => {
    const manifest = manifestOf(assembleBundle(baseInput("service_bundle")).zip);
    for (const key of REQUIRED_MANIFEST_KEYS) {
      expect(manifest).toHaveProperty(key);
    }
    for (const key of REQUIRED_ITEM_COUNT_KEYS) {
      expect(manifest.itemCounts).toHaveProperty(key);
    }
    expect(manifest.schemaVersion).toBe("signalframe.service-bundle.0.2.0");
    expect(manifest.productVersion).toBe("0.2.0");
    expect(manifest.contractVersion).toBe("2026-07-18");
    expect(manifest.ruleSetVersion).toBe("mvp.rules.0.2.0");
    expect(manifest.exportId).toBe(EXPORT_ID);
    expect(manifest.projectId).toBe(PROJECT_ID);
    expect(manifest.sourceSnapshotIds).toEqual([SNAPSHOT_A, SNAPSHOT_B]);
  });

  it("lists every data file with a valid path, sha256, bytes, and mediaType", () => {
    const manifest = manifestOf(assembleBundle(baseInput("service_bundle")).zip);
    expect(manifest.files.length).toBeGreaterThan(0);
    for (const file of manifest.files) {
      expect(file.path).toMatch(FILE_PATH);
      expect(file.sha256).toMatch(SHA256_HEX);
      expect(typeof file.bytes).toBe("number");
      expect(file.bytes).toBeGreaterThanOrEqual(0);
      expect(MEDIA_TYPES.has(file.mediaType)).toBe(true);
    }
  });

  it("does not list manifest.json in its own files[] (no self-reference)", () => {
    const manifest = manifestOf(assembleBundle(baseInput("service_bundle")).zip);
    expect(manifest.files.some((f) => f.path === "manifest.json")).toBe(false);
  });

  it("labels observations.ndjson with the x-ndjson media type", () => {
    const manifest = manifestOf(assembleBundle(baseInput("service_bundle")).zip);
    const obs = manifest.files.find((f) => f.path === "observations.ndjson");
    expect(obs?.mediaType).toBe("application/x-ndjson");
  });

  it("returns a 64-hex archive checksum", () => {
    const { checksum } = assembleBundle(baseInput("service_bundle"));
    expect(checksum).toMatch(SHA256_HEX);
  });

  it("is deterministic (same checksum for identical input)", () => {
    const a = assembleBundle(baseInput("service_bundle"));
    const b = assembleBundle(baseInput("service_bundle"));
    expect(a.checksum).toBe(b.checksum);
    expect(a.zip.equals(b.zip)).toBe(true);
  });

  it("per-file sha256/bytes in the manifest match the archived bytes", () => {
    const { zip, manifest } = assembleBundle(baseInput("service_bundle"));
    const byPath = new Map(readZip(zip).map((e) => [e.path, e.data]));
    for (const file of manifest.files) {
      const data = byPath.get(file.path);
      expect(data).toBeDefined();
      expect(data!.length).toBe(file.bytes);
    }
  });
});
