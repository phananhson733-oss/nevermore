import { describe, expect, it, vi } from "vitest";
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
      { id: "f1", ruleId: "geo.crawler", reviewState: "confirmed" },
      { id: "f2", ruleId: "content.coverage", reviewState: "unreviewed" },
      { id: "f3", ruleId: "tech.linkgraph", reviewState: "ignored" },
      { id: "f4", ruleId: "cro.path", reviewState: "needs_more_data" },
    ],
    findingEvidenceLinks: [{ findingId: "f1", evidenceId: "e1" }],
    evidence: [{ id: "e1", grade: "A" }],
    actions: [{ id: "a1", title: "Fix robots" }],
    artifacts: [
      {
        id: "aaaaaaaa-0000-4000-8000-000000000001",
        status: "ready",
        currentRevision: 1,
        revisions: [
          { revision: 1, contentFormat: "markdown", content: "# Brief\n" },
          { revision: 2, contentFormat: "json", content: { title: "Rewrite" } },
        ],
      },
      {
        id: "bbbbbbbb-0000-4000-8000-000000000002",
        status: "draft",
        currentRevision: 1,
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

function clientReachabilityInput(): BundleInput {
  return {
    ...baseInput("client_bundle"),
    findings: [
      { id: "finding-visible", reviewState: "confirmed" },
      { id: "finding-hidden", reviewState: "ignored" },
      { id: "finding-needs-data", reviewState: "needs_more_data" },
    ],
    evidence: [
      { id: "evidence-visible-only", grade: "A" },
      { id: "evidence-shared", grade: "A" },
      { id: "evidence-hidden-only", grade: "B" },
      { id: "evidence-needs-data-only", grade: "C" },
    ],
    findingEvidenceLinks: [
      { findingId: "finding-visible", evidenceId: "evidence-visible-only" },
      { findingId: "finding-visible", evidenceId: "evidence-shared" },
      { findingId: "finding-hidden", evidenceId: "evidence-shared" },
      { findingId: "finding-hidden", evidenceId: "evidence-hidden-only" },
      {
        findingId: "finding-needs-data",
        evidenceId: "evidence-needs-data-only",
      },
    ],
  } as BundleInput;
}

function capturedRevisionInput(kind: BundleInput["kind"]): BundleInput {
  return {
    ...baseInput(kind),
    artifacts: [
      {
        id: "aaaaaaaa-0000-4000-8000-000000000001",
        status: "ready",
        currentRevision: 2,
        revisions: [
          { revision: 3, contentFormat: "markdown", content: "# Invalid future\n" },
          { revision: 2, contentFormat: "markdown", content: "# Current ready\n" },
          { revision: 1, contentFormat: "markdown", content: "# Historical draft\n" },
        ],
      },
    ],
  } as BundleInput;
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

  it("emits an empty observations.ndjson file when the snapshot has no observations", () => {
    const input = {
      ...baseInput("service_bundle"),
      observations: [],
    } satisfies BundleInput;
    const observationsEntry = readZip(assembleBundle(input).zip).find(
      (entry) => entry.path === "observations.ndjson",
    );

    expect(observationsEntry?.data).toEqual(Buffer.alloc(0));
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

  it("keeps only evidence reachable from visible findings while retaining shared evidence", () => {
    const { zip, itemCounts } = assembleBundle(clientReachabilityInput());
    const evidenceEntry = readZip(zip).find((e) => e.path === "evidence.json");
    const evidence = JSON.parse(evidenceEntry!.data.toString("utf8")) as readonly {
      readonly id: string;
    }[];

    expect(evidence.map((row) => row.id)).toEqual([
      "evidence-visible-only",
      "evidence-shared",
    ]);
    expect(itemCounts["evidence"]).toBe(2);
  });

  it("does not infer reachability from findings or evidence without string ids", () => {
    const input = {
      ...baseInput("client_bundle"),
      findings: [{ reviewState: "confirmed" }, { id: "visible" }],
      findingEvidenceLinks: [
        { findingId: "visible", evidenceId: "reachable" },
      ],
      evidence: [
        { id: "reachable", grade: "A" },
        { id: 7, grade: "B" },
        { grade: "C" },
      ],
    } satisfies BundleInput;
    const evidenceEntry = readZip(assembleBundle(input).zip).find(
      (entry) => entry.path === "evidence.json",
    );

    expect(JSON.parse(evidenceEntry!.data.toString("utf8"))).toEqual([
      { id: "reachable", grade: "A" },
    ]);
  });

  it("emits only the captured current revision of a ready artifact", () => {
    const { zip, itemCounts } = assembleBundle(
      capturedRevisionInput("client_bundle"),
    );
    const artifactPaths = pathsOf(zip).filter((path) =>
      path.startsWith("artifacts/"),
    );

    expect(artifactPaths).toEqual([
      "artifacts/aaaaaaaa-0000-4000-8000-000000000001/revision-2.md",
    ]);
    expect(itemCounts["artifactRevisions"]).toBe(1);
  });

  it("fails closed when a ready artifact lacks exactly one captured current revision", () => {
    const input = {
      ...baseInput("client_bundle"),
      artifacts: [
        {
          id: "aaaaaaaa-0000-4000-8000-000000000001",
          status: "ready",
          currentRevision: 2,
          revisions: [
            { revision: 1, contentFormat: "markdown", content: "# Old\n" },
          ],
        },
      ],
    } satisfies BundleInput;

    expect(() => assembleBundle(input)).toThrowError(
      "client bundle ready artifact current revision is unavailable",
    );
  });
});

describe("assembleBundle — bounded assembly", () => {
  it("keeps full artifact revision history in a service bundle", () => {
    const { zip, itemCounts } = assembleBundle(
      capturedRevisionInput("service_bundle"),
    );
    expect(pathsOf(zip).filter((path) => path.startsWith("artifacts/"))).toEqual([
      "artifacts/aaaaaaaa-0000-4000-8000-000000000001/revision-3.md",
      "artifacts/aaaaaaaa-0000-4000-8000-000000000001/revision-2.md",
      "artifacts/aaaaaaaa-0000-4000-8000-000000000001/revision-1.md",
    ]);
    expect(itemCounts["artifactRevisions"]).toBe(3);
  });

  it("raises a stable limit error before building an over-budget archive", () => {
    expect(() =>
      assembleBundle(baseInput("service_bundle"), {
        maxItems: 1,
        maxEstimatedBytes: 256,
        maxArchiveBytes: 512,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "EXPORT_BUNDLE_LIMIT_EXCEEDED" }),
    );
  });

  it("checks estimated section bytes before allocating the archive", () => {
    expect(() =>
      assembleBundle(baseInput("service_bundle"), {
        maxItems: 1_000,
        maxEstimatedBytes: 64,
        maxArchiveBytes: 1_024,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "EXPORT_BUNDLE_LIMIT_EXCEEDED" }),
    );
  });

  it("does not charge a logical item for a null context", () => {
    const withoutContext = {
      ...baseInput("service_bundle"),
      context: null,
    } satisfies BundleInput;
    const limits = {
      maxItems: 17,
      maxEstimatedBytes: 1024 * 1024,
      maxArchiveBytes: 1024 * 1024,
    };

    expect(() => assembleBundle(withoutContext, limits)).not.toThrow();
    expect(() =>
      assembleBundle(baseInput("service_bundle"), limits),
    ).toThrowError(
      expect.objectContaining({ code: "EXPORT_BUNDLE_LIMIT_EXCEEDED" }),
    );
  });

  it.each([
    ["maxItems", 0],
    ["maxEstimatedBytes", -1],
    ["maxArchiveBytes", 1.5],
  ] as const)("rejects invalid %s assembly limits", (field, value) => {
    const limits = {
      maxItems: 1_000,
      maxEstimatedBytes: 1024 * 1024,
      maxArchiveBytes: 1024 * 1024,
      [field]: value,
    };

    expect(() => assembleBundle(baseInput("service_bundle"), limits)).toThrowError(
      new TypeError("bundle assembly limits must be positive safe integers"),
    );
  });

  it("does not count input-only finding evidence links as archive items", () => {
    const input = {
      ...baseInput("service_bundle"),
      findingEvidenceLinks: new Array(100).fill({
        findingId: "f1",
        evidenceId: "e1",
      }),
    } satisfies BundleInput;

    expect(() =>
      assembleBundle(input, {
        maxItems: 18,
        maxEstimatedBytes: 1024 * 1024,
        maxArchiveBytes: 1024 * 1024,
      }),
    ).not.toThrow();
  });

  it("applies client exclusions before output item accounting while service remains full", () => {
    const hiddenFindings = Array.from({ length: 20 }, (_, index) => ({
      id: `hidden-${index}`,
      reviewState: index % 2 === 0 ? "ignored" : "needs_more_data",
    }));
    const client = {
      ...baseInput("client_bundle"),
      findings: [
        { id: "f1", reviewState: "confirmed" },
        ...hiddenFindings,
      ],
    } satisfies BundleInput;
    const limits = {
      maxItems: 15,
      maxEstimatedBytes: 1024 * 1024,
      maxArchiveBytes: 1024 * 1024,
    };

    expect(() => assembleBundle(client, limits)).not.toThrow();
    expect(() =>
      assembleBundle({ ...client, kind: "service_bundle" }, limits),
    ).toThrowError(
      expect.objectContaining({ code: "EXPORT_BUNDLE_LIMIT_EXCEEDED" }),
    );
  });

  it("rejects the exact STORE size before allocating an over-limit archive", () => {
    const input = baseInput("service_bundle");
    const exactBytes = assembleBundle(input).zip.length;
    const alloc = vi.spyOn(Buffer, "alloc");
    const allocUnsafe = vi.spyOn(Buffer, "allocUnsafe");

    try {
      expect(() =>
        assembleBundle(input, {
          maxItems: 1_000,
          maxEstimatedBytes: 1024 * 1024,
          maxArchiveBytes: exactBytes - 1,
        }),
      ).toThrowError(
        expect.objectContaining({ code: "EXPORT_BUNDLE_LIMIT_EXCEEDED" }),
      );
      expect(alloc).not.toHaveBeenCalled();
      expect(allocUnsafe).not.toHaveBeenCalled();
    } finally {
      alloc.mockRestore();
      allocUnsafe.mockRestore();
    }
  });

  it("maps ZIP32 assembler limits to the stable export limit error", () => {
    const oversizedPathInput = {
      ...baseInput("service_bundle"),
      artifacts: [
        {
          id: "a".repeat(65_536),
          status: "ready",
          currentRevision: 1,
          revisions: [
            { revision: 1, contentFormat: "markdown", content: "" },
          ],
        },
      ],
    } satisfies BundleInput;

    expect(() =>
      assembleBundle(oversizedPathInput, {
        maxItems: 1_000,
        maxEstimatedBytes: 1024 * 1024,
        maxArchiveBytes: 1024 * 1024,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "EXPORT_BUNDLE_LIMIT_EXCEEDED" }),
    );
  });

  it("does not misclassify a non-limit ZIP allocation failure", () => {
    const allocationFailure = new Error("allocation failed");
    const allocUnsafe = vi
      .spyOn(Buffer, "allocUnsafe")
      .mockImplementationOnce(() => {
        throw allocationFailure;
      });

    try {
      expect(() => assembleBundle(baseInput("service_bundle"))).toThrow(
        allocationFailure,
      );
    } finally {
      allocUnsafe.mockRestore();
    }
  });
});

describe("assembleBundle — manifest & checksum", () => {
  it("uses compact JSON for data files and the manifest", () => {
    const entries = readZip(assembleBundle(baseInput("service_bundle")).zip);
    const project = entries.find((entry) => entry.path === "project.json");
    const manifest = entries.find((entry) => entry.path === "manifest.json");
    expect(manifest).toBeDefined();
    const manifestText = manifest!.data.toString("utf8");

    expect(project?.data.toString("utf8")).toBe(
      `${JSON.stringify(baseInput("service_bundle").project)}\n`,
    );
    expect(manifestText).toBe(
      `${JSON.stringify(JSON.parse(manifestText))}\n`,
    );
  });

  it("produces a manifest with all required keys and pinned version literals", () => {
    const manifest = manifestOf(assembleBundle(baseInput("service_bundle")).zip);
    for (const key of REQUIRED_MANIFEST_KEYS) {
      expect(manifest).toHaveProperty(key);
    }
    for (const key of REQUIRED_ITEM_COUNT_KEYS) {
      expect(manifest.itemCounts).toHaveProperty(key);
    }
    expect(manifest.schemaVersion).toBe("signalframe.service-bundle.0.3.0");
    expect(manifest.productVersion).toBe("0.3.0");
    expect(manifest.contractVersion).toBe("2026-07-21");
    expect(manifest.ruleSetVersion).toBe("mvp.rules.0.2.3");
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
