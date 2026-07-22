import { createHash } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  normalizedUrlHash,
  SitePagesRepository,
  type SitePageRow,
} from "./site-pages.ts";

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

function fakeExecutor(): {
  readonly executor: never;
  readonly calls: Call[];
  enqueue(...values: unknown[]): void;
  last(method: string): Call;
} {
  const calls: Call[] = [];
  const results: unknown[] = [];
  const take = () => (results.length > 0 ? results.shift() : []);
  const query: object = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") {
          return (
            resolve: (value: unknown) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(take()).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          calls.push({ method: String(property), args });
          return query;
        };
      },
    },
  );
  const executor = new Proxy(
    {},
    {
      get(_target, property) {
        return (...args: unknown[]) => {
          calls.push({ method: String(property), args });
          return query;
        };
      },
    },
  );
  return {
    executor: executor as never,
    calls,
    enqueue: (...values: unknown[]) => results.push(...values),
    last(method: string): Call {
      const found = calls.findLast((call) => call.method === method);
      if (!found) throw new Error(`No ${method} call`);
      return found;
    },
  };
}

const values = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
  siteId: "00000000-0000-4000-8000-000000000003",
  normalizedUrl: "https://example.test/pricing/",
  templateKey: null,
};

function row(overrides: Partial<SitePageRow> = {}): SitePageRow {
  return {
    id: "00000000-0000-4000-8000-000000000004",
    workspace_id: values.workspaceId,
    project_id: values.projectId,
    site_id: values.siteId,
    normalized_url: values.normalizedUrl,
    normalized_url_hash: normalizedUrlHash(values.normalizedUrl),
    template_key: null,
    created_at: "2026-07-22T06:07:08.901Z",
    updated_at: "2026-07-22T06:07:08.901Z",
    ...overrides,
  };
}

describe("SitePagesRepository", () => {
  it("hashes the exact normalized URL UTF-8 bytes without JCS framing", () => {
    expect(normalizedUrlHash(values.normalizedUrl)).toBe(
      createHash("sha256").update(values.normalizedUrl, "utf8").digest("hex"),
    );
    expect(normalizedUrlHash(values.normalizedUrl)).not.toBe(
      createHash("sha256")
        .update(JSON.stringify(values.normalizedUrl), "utf8")
        .digest("hex"),
    );
  });

  it("derives identity internally and limits conflict updates to template metadata", async () => {
    const fake = fakeExecutor();
    const persisted = row();
    fake.enqueue([persisted]);

    await expect(
      new SitePagesRepository(fake.executor).upsertNormalizedUrl(values),
    ).resolves.toEqual(persisted);

    expect(fake.last("values").args[0]).toMatchObject({
      normalized_url: values.normalizedUrl,
      normalized_url_hash: normalizedUrlHash(values.normalizedUrl),
    });
    const conflict = fake.last("onConflictDoUpdate").args[0] as {
      readonly set: Record<string, unknown>;
      readonly setWhere?: unknown;
    };
    expect(Object.keys(conflict.set)).toEqual(["template_key"]);
    expect(conflict.setWhere).toBeDefined();
  });

  it("fails closed when a hash conflict does not return the exact durable identity", async () => {
    const fake = fakeExecutor();
    fake.enqueue([]);

    await expect(
      new SitePagesRepository(fake.executor).upsertNormalizedUrl(values),
    ).rejects.toThrow("site page URL hash conflicts with durable identity");
  });

  it("rejects an unexpected row even if the database returns one", async () => {
    const fake = fakeExecutor();
    fake.enqueue([row({ normalized_url: `${values.normalizedUrl}collision` })]);

    await expect(
      new SitePagesRepository(fake.executor).upsertNormalizedUrl(values),
    ).rejects.toThrow("site page URL hash conflicts with durable identity");
  });

  it("finds an exact URL identity only inside the requested Site scope", async () => {
    const fake = fakeExecutor();
    const persisted = row();
    fake.enqueue([persisted]);

    await expect(
      new SitePagesRepository(fake.executor).findExactNormalizedUrl(
        { workspaceId: values.workspaceId, projectId: values.projectId },
        values.siteId,
        values.normalizedUrl,
      ),
    ).resolves.toEqual(persisted);

    expect(fake.last("where").args[0]).toBeDefined();
    expect(fake.last("limit").args).toEqual([1]);
  });

  it("fails closed if an exact URL lookup returns a different durable identity", async () => {
    const fake = fakeExecutor();
    fake.enqueue([row({ site_id: "00000000-0000-4000-8000-000000000099" })]);

    await expect(
      new SitePagesRepository(fake.executor).findExactNormalizedUrl(
        { workspaceId: values.workspaceId, projectId: values.projectId },
        values.siteId,
        values.normalizedUrl,
      ),
    ).rejects.toThrow("site page exact URL lookup returned a foreign identity");
  });

  it.each(["", "x".repeat(2049)])(
    "rejects an unbounded exact URL lookup before querying",
    async (normalizedUrl) => {
      const fake = fakeExecutor();

      await expect(
        new SitePagesRepository(fake.executor).findExactNormalizedUrl(
          { workspaceId: values.workspaceId, projectId: values.projectId },
          values.siteId,
          normalizedUrl,
        ),
      ).rejects.toThrow("normalized URL must contain 1 to 2048 characters");
      expect(fake.calls).toEqual([]);
    },
  );

  it("resolves one exact slash variant for a canonical subject after taking the shared lock", async () => {
    const fake = fakeExecutor();
    const slashVariant = row({
      normalized_url: "https://example.test/pricing/",
      normalized_url_hash: normalizedUrlHash(
        "https://example.test/pricing/",
      ),
    });
    fake.enqueue([], [slashVariant]);

    const resolved = await new SitePagesRepository(
      fake.executor,
    ).resolveUnambiguousCanonicalSubjects(
      { workspaceId: values.workspaceId, projectId: values.projectId },
      values.siteId,
      [
        {
          subjectRef: "https://example.test/pricing",
          exactCandidates: [
            "https://example.test/pricing",
            "https://example.test/pricing/",
          ],
        },
      ],
    );

    expect(resolved.get("https://example.test/pricing")).toEqual(
      slashVariant,
    );
    expect(fake.calls.find((call) => call.method === "execute")).toBeDefined();
    expect(fake.last("limit").args).toEqual([2]);
    expect(fake.calls.filter((call) => call.method === "insert")).toHaveLength(
      0,
    );
  });

  it("returns null instead of choosing between two canonical-equivalent exact variants", async () => {
    const fake = fakeExecutor();
    const canonical = "https://example.test/pricing";
    fake.enqueue(
      [],
      [
        row({
          normalized_url: canonical,
          normalized_url_hash: normalizedUrlHash(canonical),
        }),
        row({
          id: "00000000-0000-4000-8000-000000000005",
          normalized_url: `${canonical}/`,
          normalized_url_hash: normalizedUrlHash(`${canonical}/`),
        }),
      ],
    );

    const resolved = await new SitePagesRepository(
      fake.executor,
    ).resolveUnambiguousCanonicalSubjects(
      { workspaceId: values.workspaceId, projectId: values.projectId },
      values.siteId,
      [
        {
          subjectRef: canonical,
          exactCandidates: [canonical, `${canonical}/`],
        },
      ],
    );

    expect(resolved.get(canonical)).toBeNull();
    expect(fake.calls.filter((call) => call.method === "insert")).toHaveLength(
      0,
    );
  });

  it("creates the canonical SitePage only when no exact variant exists", async () => {
    const fake = fakeExecutor();
    const canonical = "https://example.test/pricing";
    const created = row({
      normalized_url: canonical,
      normalized_url_hash: normalizedUrlHash(canonical),
    });
    fake.enqueue([], [], [created]);

    const resolved = await new SitePagesRepository(
      fake.executor,
    ).resolveUnambiguousCanonicalSubjects(
      { workspaceId: values.workspaceId, projectId: values.projectId },
      values.siteId,
      [
        {
          subjectRef: canonical,
          exactCandidates: [canonical, `${canonical}/`],
        },
      ],
    );

    expect(resolved.get(canonical)).toEqual(created);
    expect(fake.last("values").args[0]).toMatchObject({
      normalized_url: canonical,
      normalized_url_hash: normalizedUrlHash(canonical),
    });
  });

  it("takes canonical subject locks in one bounded, sorted, de-duplicated batch", async () => {
    const fake = fakeExecutor();
    fake.enqueue([]);

    await new SitePagesRepository(fake.executor).lockCanonicalSubjects(
      { workspaceId: values.workspaceId, projectId: values.projectId },
      values.siteId,
      [
        "https://example.test/z",
        "https://example.test/a",
        "https://example.test/z",
      ],
    );

    const executeCalls = fake.calls.filter(
      (call) => call.method === "execute",
    );
    expect(executeCalls).toHaveLength(1);
    const compiled = new PgDialect().sqlToQuery(
      executeCalls[0]!.args[0] as never,
    );
    expect(compiled.sql).toContain(
      "select app.lock_site_page_canonical_subjects(",
    );
    expect(compiled.params).toEqual([
      values.workspaceId,
      values.projectId,
      values.siteId,
      "https://example.test/a",
      "https://example.test/z",
    ]);
    expect(fake.calls.filter((call) => call.method === "select")).toHaveLength(
      0,
    );
  });
});
