// @input  -- a disposable Postgres with all Marketing migrations applied
// @output -- concurrency, isolation, CAS, and immutable-snapshot proof
// @pos    -- real-SQL acceptance for Marketing account websites

import { createHash } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  connectFreshMarketingSchema,
  openConcurrentClient,
} from "../credits/sql-test-harness.ts";
import {
  MARKETING_WEBSITE_PROFILE_VERSION,
  canonicalProfileJson,
  emptyMarketingWebsiteProfile,
  profileSha256,
  type MarketingWebsiteProfileV1,
} from "./contracts.ts";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const SITE_A = "example.com";
const SITE_B = "docs.example.com";

interface WebsiteRpcRow {
  readonly outcome: "created" | "duplicate" | "ok" | "not_found";
  readonly website_id: string | null;
  readonly canonical_site_key: string | null;
  readonly is_primary: boolean | null;
}

interface DraftRpcRow {
  readonly outcome:
    | "ok"
    | "conflict"
    | "snapshot_conflict"
    | "not_found"
    | "invalid_hash";
  readonly draft_version: number | null;
  readonly content_hash: string | null;
  readonly profile: Record<string, unknown> | null;
}

interface ConfirmRpcRow {
  readonly outcome: "ok" | "conflict" | "not_found" | "no_draft";
  readonly snapshot_id: string | null;
  readonly snapshot_revision: number | null;
  readonly content_hash: string | null;
  readonly reused_existing: boolean | null;
}

let db: Client;

beforeAll(async () => {
  db = await connectFreshMarketingSchema();
});

afterAll(async () => {
  await db?.end();
});

beforeEach(async () => {
  await db.query(
    "update public.marketing_websites set current_confirmed_snapshot_id = null",
  );
  await db.query(
    "alter table public.marketing_website_profile_snapshots disable trigger marketing_website_profile_snapshots_immutable_row",
  );
  await db.query("delete from public.marketing_website_profile_snapshots");
  await db.query(
    "alter table public.marketing_website_profile_snapshots enable trigger marketing_website_profile_snapshots_immutable_row",
  );
  await db.query("delete from public.marketing_website_profile_drafts");
  await db.query("delete from public.marketing_websites");
});

async function addWebsite(
  client: Client,
  userId: string,
  siteKey: string,
): Promise<WebsiteRpcRow> {
  const response = await client.query<WebsiteRpcRow>(
    "select * from public.marketing_add_website($1, $2, $3, $4, $5, $6)",
    [
      userId,
      `https://${siteKey}`,
      `https://${siteKey}`,
      siteKey,
      siteKey,
      null,
    ],
  );
  return response.rows[0] as WebsiteRpcRow;
}

async function setPrimary(
  client: Client,
  userId: string,
  websiteId: string,
): Promise<WebsiteRpcRow> {
  const response = await client.query<WebsiteRpcRow>(
    "select * from public.marketing_set_primary_website($1, $2)",
    [userId, websiteId],
  );
  return response.rows[0] as WebsiteRpcRow;
}

function profile(productName: string): MarketingWebsiteProfileV1 {
  return {
    ...emptyMarketingWebsiteProfile(),
    productName,
    oneLinePositioning: `${productName} positioning`,
    valueProposition: `${productName} value`,
    primaryIcp: `${productName} ICP`,
    locale: "en-US",
  };
}

async function saveDraft(
  client: Client,
  userId: string,
  websiteId: string,
  baseVersion: number,
  productName: string,
): Promise<DraftRpcRow> {
  const payload = profile(productName);
  const canonical = canonicalProfileJson(payload);
  const hash = await profileSha256(payload);
  const response = await client.query<DraftRpcRow>(
    "select * from public.marketing_save_website_profile_draft($1, $2, $3, $4, $5, $6, $7)",
    [
      userId,
      websiteId,
      baseVersion,
      MARKETING_WEBSITE_PROFILE_VERSION,
      payload,
      canonical,
      hash,
    ],
  );
  return response.rows[0] as DraftRpcRow;
}

async function confirm(
  client: Client,
  userId: string,
  websiteId: string,
  baseVersion: number,
): Promise<ConfirmRpcRow> {
  const response = await client.query<ConfirmRpcRow>(
    "select * from public.marketing_confirm_website_profile($1, $2, $3)",
    [userId, websiteId, baseVersion],
  );
  return response.rows[0] as ConfirmRpcRow;
}

async function saveDraftFromSnapshot(
  client: Client,
  userId: string,
  websiteId: string,
  baseVersion: number,
  productName: string,
  snapshotId: string,
  snapshotHash: string,
): Promise<DraftRpcRow> {
  const payload = profile(productName);
  const canonical = canonicalProfileJson(payload);
  const hash = await profileSha256(payload);
  const response = await client.query<DraftRpcRow>(
    "select * from public.marketing_save_website_profile_draft_from_snapshot($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [
      userId,
      websiteId,
      baseVersion,
      MARKETING_WEBSITE_PROFILE_VERSION,
      payload,
      canonical,
      hash,
      snapshotId,
      snapshotHash,
    ],
  );
  return response.rows[0] as DraftRpcRow;
}

describe("Marketing website identity", () => {
  it("stores the submitted source page separately from canonical identity", async () => {
    const submittedUrl = "https://www.example.com/pricing?utm_source=account";
    const response = await db.query<WebsiteRpcRow>(
      "select * from public.marketing_add_website($1, $2, $3, $4, $5, $6)",
      [
        USER_A,
        submittedUrl,
        "https://example.com",
        SITE_A,
        SITE_A,
        null,
      ],
    );
    const stored = await db.query<{
      submitted_url: string;
      origin: string;
      canonical_site_key: string;
    }>(
      "select submitted_url, origin, canonical_site_key from public.marketing_websites where id = $1",
      [response.rows[0]?.website_id],
    );

    expect(stored.rows[0]).toEqual({
      submitted_url: submittedUrl,
      origin: "https://example.com",
      canonical_site_key: SITE_A,
    });
  });

  it("makes the first website primary and returns a stable duplicate", async () => {
    const first = await addWebsite(db, USER_A, SITE_A);
    expect(first).toMatchObject({
      outcome: "created",
      canonical_site_key: SITE_A,
      is_primary: true,
    });

    const duplicate = await addWebsite(db, USER_A, SITE_A);
    expect(duplicate).toMatchObject({
      outcome: "duplicate",
      website_id: first.website_id,
      is_primary: true,
    });

    const otherUser = await addWebsite(db, USER_B, SITE_A);
    expect(otherUser).toMatchObject({ outcome: "created", is_primary: true });
  });

  it("serializes concurrent first-site creation to exactly one primary", async () => {
    const other = await openConcurrentClient();
    try {
      await Promise.all([
        addWebsite(db, USER_A, SITE_A),
        addWebsite(other, USER_A, SITE_B),
      ]);
    } finally {
      await other.end();
    }
    const count = await db.query<{ count: number }>(
      "select count(*)::int as count from public.marketing_websites where user_id = $1 and is_primary",
      [USER_A],
    );
    expect(count.rows[0]?.count).toBe(1);
  });

  it("switches the primary website atomically and hides foreign IDs", async () => {
    const first = await addWebsite(db, USER_A, SITE_A);
    const second = await addWebsite(db, USER_A, SITE_B);
    expect(await setPrimary(db, USER_B, first.website_id as string)).toMatchObject({
      outcome: "not_found",
    });

    const other = await openConcurrentClient();
    try {
      await Promise.all([
        setPrimary(db, USER_A, first.website_id as string),
        setPrimary(other, USER_A, second.website_id as string),
      ]);
    } finally {
      await other.end();
    }
    const rows = await db.query<{ id: string; is_primary: boolean }>(
      "select id, is_primary from public.marketing_websites where user_id = $1 order by id",
      [USER_A],
    );
    expect(rows.rows.filter((row) => row.is_primary)).toHaveLength(1);
  });
});

describe("Marketing website profile draft CAS", () => {
  it("creates, no-ops, updates, and rejects a stale draft", async () => {
    const website = await addWebsite(db, USER_A, SITE_A);
    const websiteId = website.website_id as string;

    const hashA = await profileSha256(profile("A"));
    const hashB = await profileSha256(profile("B"));
    expect(await saveDraft(db, USER_A, websiteId, 0, "A")).toMatchObject({
      outcome: "ok",
      draft_version: 1,
      content_hash: hashA,
    });
    expect(await saveDraft(db, USER_A, websiteId, 1, "A")).toMatchObject({
      outcome: "ok",
      draft_version: 1,
    });
    expect(await saveDraft(db, USER_A, websiteId, 0, "stale")).toMatchObject({
      outcome: "conflict",
      draft_version: 1,
      content_hash: hashA,
    });
    expect(await saveDraft(db, USER_A, websiteId, 1, "B")).toMatchObject({
      outcome: "ok",
      draft_version: 2,
      content_hash: hashB,
    });
  });

  it("rejects a missing CAS token and profile/hash disagreement", async () => {
    const website = await addWebsite(db, USER_A, SITE_A);
    const websiteId = website.website_id as string;
    const payload = profile("A");
    const canonical = canonicalProfileJson(payload);
    const realHash = await profileSha256(payload);

    const missingBase = await db.query<DraftRpcRow>(
      "select * from public.marketing_save_website_profile_draft($1, $2, $3, $4, $5, $6, $7)",
      [
        USER_A,
        websiteId,
        null,
        MARKETING_WEBSITE_PROFILE_VERSION,
        payload,
        canonical,
        realHash,
      ],
    );
    expect(missingBase.rows[0]).toMatchObject({ outcome: "conflict" });

    const wrongHash = await db.query<DraftRpcRow>(
      "select * from public.marketing_save_website_profile_draft($1, $2, $3, $4, $5, $6, $7)",
      [
        USER_A,
        websiteId,
        0,
        MARKETING_WEBSITE_PROFILE_VERSION,
        payload,
        canonical,
        "f".repeat(64),
      ],
    );
    expect(wrongHash.rows[0]).toMatchObject({ outcome: "invalid_hash" });

    const differentPayload = profile("B");
    const wrongProfile = await db.query<DraftRpcRow>(
      "select * from public.marketing_save_website_profile_draft($1, $2, $3, $4, $5, $6, $7)",
      [
        USER_A,
        websiteId,
        0,
        MARKETING_WEBSITE_PROFILE_VERSION,
        differentPayload,
        canonical,
        realHash,
      ],
    );
    expect(wrongProfile.rows[0]).toMatchObject({ outcome: "invalid_hash" });

    expect(await saveDraft(db, USER_A, websiteId, 0, "A")).toMatchObject({
      outcome: "ok",
      draft_version: 1,
    });
    const alternateText = JSON.stringify(payload, null, 2);
    const alternateHash = createHash("sha256")
      .update(alternateText)
      .digest("hex");
    const alternateSerialization = await db.query<DraftRpcRow>(
      "select * from public.marketing_save_website_profile_draft($1, $2, $3, $4, $5, $6, $7)",
      [
        USER_A,
        websiteId,
        1,
        MARKETING_WEBSITE_PROFILE_VERSION,
        payload,
        alternateText,
        alternateHash,
      ],
    );
    expect(alternateSerialization.rows[0]).toMatchObject({
      outcome: "invalid_hash",
    });
    const stored = await db.query<{ draft_version: number }>(
      "select draft_version from public.marketing_website_profile_drafts where website_id = $1",
      [websiteId],
    );
    expect(stored.rows[0]?.draft_version).toBe(1);
  });

  it("allows one concurrent writer and returns the other current version", async () => {
    const website = await addWebsite(db, USER_A, SITE_A);
    const websiteId = website.website_id as string;
    await saveDraft(db, USER_A, websiteId, 0, "A");

    const other = await openConcurrentClient();
    try {
      const outcomes = await Promise.all([
        saveDraft(db, USER_A, websiteId, 1, "B"),
        saveDraft(other, USER_A, websiteId, 1, "C"),
      ]);
      expect(outcomes.map((row) => row.outcome).sort()).toEqual([
        "conflict",
        "ok",
      ]);
    } finally {
      await other.end();
    }
  });

  it("refuses Save Back after the referenced confirmed snapshot changes", async () => {
    const website = await addWebsite(db, USER_A, SITE_A);
    const websiteId = website.website_id as string;
    await saveDraft(db, USER_A, websiteId, 0, "A");
    const first = await confirm(db, USER_A, websiteId, 1);
    await saveDraft(db, USER_A, websiteId, 1, "B");
    const second = await confirm(db, USER_A, websiteId, 2);

    expect(
      await saveDraftFromSnapshot(
        db,
        USER_A,
        websiteId,
        2,
        "Agent edit",
        first.snapshot_id as string,
        first.content_hash as string,
      ),
    ).toMatchObject({
      outcome: "snapshot_conflict",
      draft_version: 2,
    });
    const unchanged = await db.query<{
      draft_version: number;
      content_hash: string;
    }>(
      "select draft_version, content_hash from public.marketing_website_profile_drafts where website_id = $1",
      [websiteId],
    );
    expect(unchanged.rows[0]).toMatchObject({
      draft_version: 2,
      content_hash: await profileSha256(profile("B")),
    });

    expect(
      await saveDraftFromSnapshot(
        db,
        USER_A,
        websiteId,
        2,
        "Agent edit",
        second.snapshot_id as string,
        second.content_hash as string,
      ),
    ).toMatchObject({
      outcome: "ok",
      draft_version: 3,
    });
  });

  it("does not expose a foreign website through the draft RPC", async () => {
    const website = await addWebsite(db, USER_A, SITE_A);
    expect(
      await saveDraft(db, USER_B, website.website_id as string, 0, "Foreign"),
    ).toMatchObject({ outcome: "not_found", draft_version: null });
  });
});

describe("Marketing website profile confirmation", () => {
  it("confirms an immutable snapshot and idempotently reuses it", async () => {
    const website = await addWebsite(db, USER_A, SITE_A);
    const websiteId = website.website_id as string;
    expect(await confirm(db, USER_A, websiteId, 0)).toMatchObject({
      outcome: "no_draft",
    });
    await saveDraft(db, USER_A, websiteId, 0, "A");

    const first = await confirm(db, USER_A, websiteId, 1);
    expect(first).toMatchObject({
      outcome: "ok",
      snapshot_revision: 1,
      content_hash: await profileSha256(profile("A")),
      reused_existing: false,
    });
    const replay = await confirm(db, USER_A, websiteId, 1);
    expect(replay).toMatchObject({
      outcome: "ok",
      snapshot_id: first.snapshot_id,
      snapshot_revision: 1,
      reused_existing: true,
    });
  });

  it("creates one monotonic revision after a changed draft", async () => {
    const website = await addWebsite(db, USER_A, SITE_A);
    const websiteId = website.website_id as string;
    await saveDraft(db, USER_A, websiteId, 0, "A");
    await confirm(db, USER_A, websiteId, 1);
    await saveDraft(db, USER_A, websiteId, 1, "B");

    const other = await openConcurrentClient();
    try {
      const results = await Promise.all([
        confirm(db, USER_A, websiteId, 2),
        confirm(other, USER_A, websiteId, 2),
      ]);
      expect(new Set(results.map((row) => row.snapshot_id)).size).toBe(1);
      expect(results.map((row) => row.snapshot_revision)).toEqual([2, 2]);
      expect(results.map((row) => row.reused_existing).sort()).toEqual([
        false,
        true,
      ]);
    } finally {
      await other.end();
    }
  });

  it("returns conflict or not-found without leaking another account", async () => {
    const website = await addWebsite(db, USER_A, SITE_A);
    const websiteId = website.website_id as string;
    await saveDraft(db, USER_A, websiteId, 0, "A");
    expect(await confirm(db, USER_A, websiteId, 99)).toMatchObject({
      outcome: "conflict",
    });
    expect(await confirm(db, USER_B, websiteId, 1)).toMatchObject({
      outcome: "not_found",
      snapshot_id: null,
    });
  });
});

describe("Marketing website database permissions", () => {
  it.each([
    [
      "submitted URL",
      `https://example.com/${"x".repeat(2_049)}`,
      "https://example.com",
      "example.com",
      "example.com",
      null,
    ],
    ["canonical site key", "https://example.com", "https://example.com", "example.com", "x".repeat(256), null],
    ["origin", "https://example.com", `https://example.com/${"x".repeat(2_049)}`, "example.com", "example.com", null],
    ["host", "https://example.com", "https://example.com", "x".repeat(256), "example.com", null],
    ["display name", "https://example.com", "https://example.com", "example.com", "example.com", "x".repeat(161)],
  ])("enforces the %s storage bound", async (_label, submittedUrl, origin, host, key, name) => {
    await expect(
      db.query(
        "select * from public.marketing_add_website($1, $2, $3, $4, $5, $6)",
        [USER_A, submittedUrl, origin, host, key, name],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("rejects an oversized profile even through its privileged RPC", async () => {
    const website = await addWebsite(db, USER_A, SITE_A);
    const canonical = JSON.stringify({ payload: "x".repeat(140_000) });
    const hash = createHash("sha256").update(canonical).digest("hex");
    await expect(
      db.query(
        "select * from public.marketing_save_website_profile_draft($1, $2, $3, $4, $5, $6, $7)",
        [
          USER_A,
          website.website_id,
          0,
          MARKETING_WEBSITE_PROFILE_VERSION,
          JSON.parse(canonical),
          canonical,
          hash,
        ],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("makes snapshots immutable even to the table owner", async () => {
    const website = await addWebsite(db, USER_A, SITE_A);
    const websiteId = website.website_id as string;
    await saveDraft(db, USER_A, websiteId, 0, "A");
    await confirm(db, USER_A, websiteId, 1);

    await expect(
      db.query("update public.marketing_website_profile_snapshots set revision = 9"),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.query("delete from public.marketing_website_profile_snapshots"),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.query("truncate public.marketing_website_profile_snapshots cascade"),
    ).rejects.toThrow(/append-only/);
  });

  it("allows only service_role RPC execution and read-only table access", async () => {
    await db.query("set role anon");
    await expect(
      db.query("select * from public.marketing_websites"),
    ).rejects.toThrow(/permission denied/);
    await expect(addWebsite(db, USER_A, SITE_A)).rejects.toThrow(
      /permission denied/,
    );
    await db.query("reset role");

    await db.query("set role authenticated");
    await expect(
      db.query("select * from public.marketing_websites"),
    ).rejects.toThrow(/permission denied/);
    await expect(addWebsite(db, USER_A, SITE_A)).rejects.toThrow(
      /permission denied/,
    );
    await db.query("reset role");

    await db.query("set role service_role");
    expect(await addWebsite(db, USER_A, SITE_A)).toMatchObject({
      outcome: "created",
    });
    await expect(
      db.query(
        "insert into public.marketing_websites (user_id, origin, host, canonical_site_key) values ($1, $2, $3, $4)",
        [USER_A, "https://other.example", "other.example", "other.example"],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(
        "insert into public.marketing_website_profile_drafts (website_id, user_id, schema_version, draft_version, profile, content_hash) values ($1, $2, $3, 1, '{}'::jsonb, $4)",
        [
          "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6",
          USER_A,
          MARKETING_WEBSITE_PROFILE_VERSION,
          "a".repeat(64),
        ],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(
        "insert into public.marketing_website_profile_snapshots (website_id, user_id, revision, schema_version, profile, content_hash, source_draft_version) values ($1, $2, 1, $3, '{}'::jsonb, $4, 1)",
        [
          "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6",
          USER_A,
          MARKETING_WEBSITE_PROFILE_VERSION,
          "a".repeat(64),
        ],
      ),
    ).rejects.toThrow(/permission denied/);
    const rows = await db.query("select * from public.marketing_websites");
    expect(rows.rows).toHaveLength(1);
    await db.query("reset role");
  });
});
