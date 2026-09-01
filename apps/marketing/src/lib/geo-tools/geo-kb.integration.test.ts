// @input  -- a disposable Postgres with every marketing migration applied
// @output -- proof that 0006 is re-runnable and that its CAS, digest, immutability and isolation rules hold in real SQL
// @pos    -- the only place the GEO knowledge base tables and RPCs are actually executed

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  connectFreshMarketingSchema,
  openConcurrentClient,
} from "../credits/sql-test-harness.ts";
import {
  GEO_KB_LIMITS,
  GEO_KB_SCHEMA_VERSION,
  parseGeoKbPayload,
  type GeoKbPayload,
  type GeoKbValue,
} from "./kb-contract.ts";
import { geoKbDigest } from "./kb-digest.ts";
import {
  buildGeoQuestionSet,
  geoQuestionSetDigest,
  type GeoQuestionSet,
} from "./kb-questions.ts";

const MIGRATION_SQL = readFileSync(
  fileURLToPath(
    new URL(
      "../../../supabase/migrations/0006_geo_knowledge_base.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const SITE_A = "example.com";
const SITE_B = "docs.example.com";

interface UpsertRow {
  readonly kb_id: string;
  readonly created: boolean;
}

interface DraftRow {
  readonly outcome: "saved" | "conflict" | "hash_mismatch" | "not_found";
  readonly draft_version: number | null;
  readonly content_hash: string | null;
  readonly updated_at: Date | null;
}

interface FreezeRow {
  readonly outcome:
    | "frozen"
    | "conflict"
    | "hash_mismatch"
    | "not_found"
    | "no_draft";
  readonly snapshot_id: string | null;
  readonly revision: number | null;
  readonly content_hash: string | null;
  readonly frozen_at: Date | null;
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
  // The pointer has to be released before the snapshots go, and the append-only
  // trigger has to be lifted before anything goes at all. Production never does
  // either; only a test owns the whole database.
  await db.query(
    "update public.marketing_geo_knowledge_bases set current_frozen_snapshot_id = null",
  );
  await db.query(
    "alter table public.marketing_geo_kb_snapshots disable trigger marketing_geo_kb_snapshots_immutable_row",
  );
  await db.query("delete from public.marketing_geo_kb_snapshots");
  await db.query(
    "alter table public.marketing_geo_kb_snapshots enable trigger marketing_geo_kb_snapshots_immutable_row",
  );
  await db.query("delete from public.marketing_geo_kb_drafts");
  await db.query("delete from public.marketing_geo_knowledge_bases");
});

/**
 * The contract's own idiom for the same cast it performs internally: a payload
 * is a `GeoKbValue`, TypeScript just cannot see through the named interface.
 */
function payloadDigest(payload: GeoKbPayload): string {
  return geoKbDigest(payload as unknown as GeoKbValue);
}

function payloadFor(officialName: string): GeoKbPayload {
  const parsed = parseGeoKbPayload({
    schemaVersion: GEO_KB_SCHEMA_VERSION,
    targetUrl: "https://example.com/product",
    officialName,
    // One non-ASCII alias on purpose. The digest the database recomputes has to
    // survive a round trip through jsonb, and an all-ASCII fixture would prove
    // the two canonical forms agree only where they cannot disagree.
    aliases: [officialName, "北极星"],
    categoryTerms: ["product analytics"],
    market: { country: "US", language: "en" },
    roles: [
      {
        id: "pm",
        label: "product manager",
        segment: "B2B SaaS",
        painPoints: ["no funnel data"],
        decisionCriteria: ["fast setup"],
        vocabulary: ["retention"],
      },
    ],
    competitors: [
      { domain: "amplitude.com", brandName: "Amplitude", confirmed: true },
    ],
    facts: [
      {
        key: "founded",
        value: "2021",
        reason: "",
        sourceUrl: "https://example.com/about",
        observedAt: "2026-08-29",
      },
    ],
    importedFrom: null,
  });
  // A fixture that the contract itself rejects would test the database against
  // a payload the product can never send.
  if (!parsed.ok) {
    throw new Error(`fixture is not a valid payload: ${parsed.reason}`);
  }
  return parsed.value;
}

async function upsertKb(
  client: Client,
  userId: string,
  siteKey: string,
): Promise<UpsertRow> {
  const response = await client.query<UpsertRow>(
    "select * from public.marketing_geo_upsert_kb($1, $2, $3, $4)",
    [userId, `https://${siteKey}`, siteKey, siteKey],
  );
  return response.rows[0] as UpsertRow;
}

async function saveDraft(
  client: Client,
  userId: string,
  kbId: string,
  baseVersion: number | null,
  payload: GeoKbPayload,
  hash: string = payloadDigest(payload),
): Promise<DraftRow> {
  const response = await client.query<DraftRow>(
    "select * from public.marketing_geo_save_kb_draft($1, $2, $3, $4, $5, $6)",
    [userId, kbId, GEO_KB_SCHEMA_VERSION, payload, hash, baseVersion],
  );
  return response.rows[0] as DraftRow;
}

async function freeze(
  client: Client,
  userId: string,
  kbId: string,
  baseVersion: number,
  set: GeoQuestionSet,
  hash: string = geoQuestionSetDigest(set),
): Promise<FreezeRow> {
  const response = await client.query<FreezeRow>(
    "select * from public.marketing_geo_freeze_kb($1, $2, $3, $4, $5, $6)",
    [userId, kbId, GEO_KB_SCHEMA_VERSION, baseVersion, set, hash],
  );
  return response.rows[0] as FreezeRow;
}

async function countRows(table: string): Promise<number> {
  const response = await db.query<{ n: number }>(
    `select count(*)::int as n from public.${table}`,
  );
  return response.rows[0]?.n ?? -1;
}

describe("0006 migration", () => {
  it("applies a second time without duplicating or losing anything", async () => {
    const kb = await upsertKb(db, USER_A, SITE_A);
    const payload = payloadFor("Northstar Analytics");
    await saveDraft(db, USER_A, kb.kb_id, 0, payload);
    const frozen = await freeze(
      db,
      USER_A,
      kb.kb_id,
      1,
      buildGeoQuestionSet(payload),
    );
    expect(frozen.outcome).toBe("frozen");

    await db.query(MIGRATION_SQL);

    // The two immutability triggers are the reason this matters: `create
    // trigger` is not idempotent on its own, so a missing `drop trigger if
    // exists` would either fail here or leave the rule installed twice.
    const triggers = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_trigger
        where tgrelid = 'public.marketing_geo_kb_snapshots'::regclass
          and not tgisinternal`,
    );
    expect(triggers.rows[0]?.n).toBe(2);
    expect(await countRows("marketing_geo_kb_snapshots")).toBe(1);

    const pointer = await db.query<{ current_frozen_snapshot_id: string }>(
      "select current_frozen_snapshot_id from public.marketing_geo_knowledge_bases where id = $1",
      [kb.kb_id],
    );
    expect(pointer.rows[0]?.current_frozen_snapshot_id).toBe(
      frozen.snapshot_id,
    );

    // Replaced functions, not broken ones.
    expect(
      await saveDraft(db, USER_A, kb.kb_id, 1, payloadFor("Northstar")),
    ).toMatchObject({ outcome: "saved", draft_version: 2 });
  });
});

describe("GEO knowledge base identity", () => {
  it("registers a site once per account and keeps accounts apart", async () => {
    const first = await upsertKb(db, USER_A, SITE_A);
    expect(first.created).toBe(true);

    const again = await upsertKb(db, USER_A, SITE_A);
    expect(again).toEqual({ kb_id: first.kb_id, created: false });

    const other = await upsertKb(db, USER_B, SITE_A);
    expect(other.created).toBe(true);
    expect(other.kb_id).not.toBe(first.kb_id);

    const second = await upsertKb(db, USER_A, SITE_B);
    expect(second.kb_id).not.toBe(first.kb_id);
    expect(await countRows("marketing_geo_knowledge_bases")).toBe(3);
  });
});

describe("GEO knowledge base draft CAS", () => {
  let kbId: string;

  beforeEach(async () => {
    kbId = (await upsertKb(db, USER_A, SITE_A)).kb_id;
  });

  it("creates, refuses a stale token, and advances one version at a time", async () => {
    const first = payloadFor("Northstar Analytics");
    const second = payloadFor("Northstar");

    expect(await saveDraft(db, USER_A, kbId, 0, first)).toMatchObject({
      outcome: "saved",
      draft_version: 1,
      content_hash: payloadDigest(first),
    });
    expect(await saveDraft(db, USER_A, kbId, 0, second)).toMatchObject({
      outcome: "conflict",
      draft_version: 1,
      content_hash: payloadDigest(first),
    });
    expect(await saveDraft(db, USER_A, kbId, 1, second)).toMatchObject({
      outcome: "saved",
      draft_version: 2,
      content_hash: payloadDigest(second),
    });
  });

  it("refuses a first draft that claims to be based on an existing one", async () => {
    expect(
      await saveDraft(db, USER_A, kbId, 3, payloadFor("Northstar")),
    ).toMatchObject({ outcome: "conflict", draft_version: null });
    expect(await countRows("marketing_geo_kb_drafts")).toBe(0);

    // A null token is read as "I expect no draft", which is where this RPC
    // differs from `marketing_save_website_profile_draft` - that one answers
    // conflict. The difference is bounded rather than merely lenient: once a
    // draft row exists, null is `distinct from` its version, so a caller that
    // forgot to send a token can create the first draft and can never
    // overwrite one. The second half of this test is what bounds it.
    expect(
      await saveDraft(db, USER_A, kbId, null, payloadFor("Northstar")),
    ).toMatchObject({ outcome: "saved", draft_version: 1 });
    expect(
      await saveDraft(db, USER_A, kbId, null, payloadFor("North Star")),
    ).toMatchObject({ outcome: "conflict", draft_version: 1 });
  });

  it("refuses a hash it cannot reproduce, and answers with the one it can", async () => {
    const payload = payloadFor("Northstar Analytics");

    const wrongHash = await saveDraft(
      db,
      USER_A,
      kbId,
      0,
      payload,
      "f".repeat(64),
    );
    expect(wrongHash).toMatchObject({
      outcome: "hash_mismatch",
      draft_version: null,
      content_hash: payloadDigest(payload),
    });

    // The case the mismatch check exists for: a payload edited in transit that
    // arrives carrying the digest of the payload the caller meant to send.
    const edited = payloadFor("Not Northstar");
    const swapped = await saveDraft(
      db,
      USER_A,
      kbId,
      0,
      edited,
      payloadDigest(payload),
    );
    expect(swapped).toMatchObject({
      outcome: "hash_mismatch",
      content_hash: payloadDigest(edited),
    });
    expect(await countRows("marketing_geo_kb_drafts")).toBe(0);
  });

  it("hides another account's knowledge base behind the same code as a missing one", async () => {
    expect(
      await saveDraft(db, USER_B, kbId, 0, payloadFor("Northstar")),
    ).toMatchObject({
      outcome: "not_found",
      draft_version: null,
      content_hash: null,
    });
    expect(await countRows("marketing_geo_kb_drafts")).toBe(0);
  });

  it("lets exactly one of two racing writers through", async () => {
    await saveDraft(db, USER_A, kbId, 0, payloadFor("Northstar Analytics"));

    const other = await openConcurrentClient();
    try {
      const outcomes = await Promise.all([
        saveDraft(db, USER_A, kbId, 1, payloadFor("Northstar")),
        saveDraft(other, USER_A, kbId, 1, payloadFor("North Star")),
      ]);
      expect(outcomes.map((row) => row.outcome).sort()).toEqual([
        "conflict",
        "saved",
      ]);
    } finally {
      await other.end();
    }
    const stored = await db.query<{ draft_version: number }>(
      "select draft_version from public.marketing_geo_kb_drafts where kb_id = $1",
      [kbId],
    );
    expect(stored.rows[0]?.draft_version).toBe(2);
  });
});

describe("GEO knowledge base freeze", () => {
  let kbId: string;
  const payload = payloadFor("Northstar Analytics");
  const questionSet = buildGeoQuestionSet(payload);

  beforeEach(async () => {
    kbId = (await upsertKb(db, USER_A, SITE_A)).kb_id;
  });

  it("refuses to freeze nothing", async () => {
    expect(await freeze(db, USER_A, kbId, 0, questionSet)).toMatchObject({
      outcome: "no_draft",
      snapshot_id: null,
      revision: null,
    });
  });

  it("refuses a question set hash it cannot reproduce", async () => {
    await saveDraft(db, USER_A, kbId, 0, payload);
    expect(
      await freeze(db, USER_A, kbId, 1, questionSet, "a".repeat(64)),
    ).toMatchObject({
      outcome: "hash_mismatch",
      snapshot_id: null,
      content_hash: geoQuestionSetDigest(questionSet),
    });
    expect(await countRows("marketing_geo_kb_snapshots")).toBe(0);
  });

  it("refuses a draft version that is no longer current", async () => {
    await saveDraft(db, USER_A, kbId, 0, payload);
    await saveDraft(db, USER_A, kbId, 1, payloadFor("Northstar"));
    expect(await freeze(db, USER_A, kbId, 1, questionSet)).toMatchObject({
      outcome: "conflict",
      snapshot_id: null,
      revision: 2,
    });
    expect(await countRows("marketing_geo_kb_snapshots")).toBe(0);
  });

  it("mints one revision per payload however many times it is asked", async () => {
    await saveDraft(db, USER_A, kbId, 0, payload);

    const first = await freeze(db, USER_A, kbId, 1, questionSet);
    expect(first).toMatchObject({
      outcome: "frozen",
      revision: 1,
      content_hash: payloadDigest(payload),
      reused_existing: false,
    });

    const replay = await freeze(db, USER_A, kbId, 1, questionSet);
    expect(replay).toMatchObject({
      outcome: "frozen",
      snapshot_id: first.snapshot_id,
      revision: 1,
      reused_existing: true,
    });
    expect(await countRows("marketing_geo_kb_snapshots")).toBe(1);
  });

  it("stores the question set the frozen payload implies", async () => {
    await saveDraft(db, USER_A, kbId, 0, payload);
    const frozen = await freeze(db, USER_A, kbId, 1, questionSet);

    const stored = await db.query<{
      payload: unknown;
      question_set: unknown;
      question_set_hash: string;
      schema_version: string;
    }>(
      "select payload, question_set, question_set_hash, schema_version from public.marketing_geo_kb_snapshots where id = $1",
      [frozen.snapshot_id],
    );
    // Reproducibility is the whole reason the set lives on the snapshot: a
    // later registry release must not be able to change what a past run asked.
    expect(stored.rows[0]?.question_set).toEqual(questionSet);
    expect(stored.rows[0]?.question_set_hash).toBe(
      geoQuestionSetDigest(questionSet),
    );
    expect(stored.rows[0]?.payload).toEqual(payload);
    expect(stored.rows[0]?.schema_version).toBe(GEO_KB_SCHEMA_VERSION);
  });

  it("advances the revision and the pointer only after the payload changes", async () => {
    await saveDraft(db, USER_A, kbId, 0, payload);
    const first = await freeze(db, USER_A, kbId, 1, questionSet);

    const changed = payloadFor("Northstar");
    const changedSet = buildGeoQuestionSet(changed);
    await saveDraft(db, USER_A, kbId, 1, changed);
    const second = await freeze(db, USER_A, kbId, 2, changedSet);
    expect(second).toMatchObject({
      outcome: "frozen",
      revision: 2,
      content_hash: payloadDigest(changed),
      reused_existing: false,
    });
    expect(second.snapshot_id).not.toBe(first.snapshot_id);

    const pointer = await db.query<{ current_frozen_snapshot_id: string }>(
      "select current_frozen_snapshot_id from public.marketing_geo_knowledge_bases where id = $1",
      [kbId],
    );
    expect(pointer.rows[0]?.current_frozen_snapshot_id).toBe(
      second.snapshot_id,
    );
    expect(await countRows("marketing_geo_kb_snapshots")).toBe(2);
  });

  it("gives two racing freezes one snapshot between them", async () => {
    await saveDraft(db, USER_A, kbId, 0, payload);

    const other = await openConcurrentClient();
    try {
      const results = await Promise.all([
        freeze(db, USER_A, kbId, 1, questionSet),
        freeze(other, USER_A, kbId, 1, questionSet),
      ]);
      expect(new Set(results.map((row) => row.snapshot_id)).size).toBe(1);
      expect(results.map((row) => row.revision)).toEqual([1, 1]);
      expect(results.map((row) => row.reused_existing).sort()).toEqual([
        false,
        true,
      ]);
    } finally {
      await other.end();
    }
    expect(await countRows("marketing_geo_kb_snapshots")).toBe(1);
  });

  it("hides another account's knowledge base", async () => {
    await saveDraft(db, USER_A, kbId, 0, payload);
    expect(await freeze(db, USER_B, kbId, 1, questionSet)).toMatchObject({
      outcome: "not_found",
      snapshot_id: null,
      revision: null,
    });
  });
});

describe("GEO knowledge base database permissions", () => {
  it("refuses to change a frozen snapshot, including to the table owner", async () => {
    const kbId = (await upsertKb(db, USER_A, SITE_A)).kb_id;
    const payload = payloadFor("Northstar Analytics");
    await saveDraft(db, USER_A, kbId, 0, payload);
    await freeze(db, USER_A, kbId, 1, buildGeoQuestionSet(payload));

    await expect(
      db.query("update public.marketing_geo_kb_snapshots set revision = 9"),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.query("delete from public.marketing_geo_kb_snapshots"),
    ).rejects.toThrow(/append-only/);
    // TRUNCATE is the one a row trigger never sees, which is why the migration
    // installs a second, statement-level trigger for it.
    await expect(
      db.query("truncate public.marketing_geo_kb_snapshots cascade"),
    ).rejects.toThrow(/append-only/);
    expect(await countRows("marketing_geo_kb_snapshots")).toBe(1);
  });

  it("refuses an oversized payload even through its privileged RPC", async () => {
    const kbId = (await upsertKb(db, USER_A, SITE_A)).kb_id;
    const oversized = {
      big: "x".repeat(GEO_KB_LIMITS.payloadBytes + 1),
    } as const satisfies GeoKbValue;
    await expect(
      db.query(
        "select * from public.marketing_geo_save_kb_draft($1, $2, $3, $4, $5, $6)",
        [
          USER_A,
          kbId,
          GEO_KB_SCHEMA_VERSION,
          oversized,
          geoKbDigest(oversized),
          0,
        ],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it.each(["anon", "authenticated"])(
    "gives %s no reach into the tables or the RPCs",
    async (role) => {
      const kbId = (await upsertKb(db, USER_A, SITE_A)).kb_id;
      const payload = payloadFor("Northstar Analytics");

      await db.query(`set role ${role}`);
      try {
        for (const table of [
          "marketing_geo_knowledge_bases",
          "marketing_geo_kb_drafts",
          "marketing_geo_kb_snapshots",
        ]) {
          await expect(
            db.query(`select * from public.${table}`),
          ).rejects.toThrow(/permission denied/);
        }
        await expect(upsertKb(db, USER_A, SITE_B)).rejects.toThrow(
          /permission denied/,
        );
        await expect(saveDraft(db, USER_A, kbId, 0, payload)).rejects.toThrow(
          /permission denied/,
        );
        await expect(
          freeze(db, USER_A, kbId, 1, buildGeoQuestionSet(payload)),
        ).rejects.toThrow(/permission denied/);
      } finally {
        await db.query("reset role");
      }
    },
  );

  it("lets service_role call the RPCs and read, but never write a table directly", async () => {
    await db.query("set role service_role");
    try {
      const kb = await upsertKb(db, USER_A, SITE_A);
      expect(kb.created).toBe(true);
      const payload = payloadFor("Northstar Analytics");
      expect(await saveDraft(db, USER_A, kb.kb_id, 0, payload)).toMatchObject({
        outcome: "saved",
      });
      expect(
        await freeze(db, USER_A, kb.kb_id, 1, buildGeoQuestionSet(payload)),
      ).toMatchObject({ outcome: "frozen" });

      // service_role carries BYPASSRLS, so the ban on writing around the RPCs
      // can only be a privilege ban. These three are what proves it is one.
      await expect(
        db.query(
          "insert into public.marketing_geo_knowledge_bases (user_id, canonical_site_key, origin, host) values ($1, $2, $3, $4)",
          [USER_A, SITE_B, `https://${SITE_B}`, SITE_B],
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query(
          "update public.marketing_geo_kb_drafts set draft_version = 99 where kb_id = $1",
          [kb.kb_id],
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query("delete from public.marketing_geo_kb_snapshots"),
      ).rejects.toThrow(/permission denied/);

      const rows = await db.query(
        "select * from public.marketing_geo_kb_snapshots",
      );
      expect(rows.rows).toHaveLength(1);
    } finally {
      await db.query("reset role");
    }
  });
});
