// @input -- only a named loopback disposable Marketing database and synthetic values
// @output -- the website evidence ledger's append-only guarantee, its refusals and its owner scope
// @pos -- real SQL tests, never a provider or production invocation
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectFreshMarketingSchema } from "../credits/sql-test-harness.ts";
import {
  geoEvidenceGscKey,
  parseGeoEvidenceObservation,
} from "./kb-evidence-observations.ts";

let db: Client;
beforeAll(async () => {
  db = await connectFreshMarketingSchema();
});
afterAll(async () => {
  await db?.end();
});

const BODY = "a".repeat(64);

async function website() {
  const userId = randomUUID();
  const websiteId = randomUUID();
  await db.query(
    "insert into public.marketing_websites(id,user_id,canonical_site_key,origin,submitted_url,host) values($1,$2,'acme.test','https://acme.test','https://acme.test','acme.test')",
    [websiteId, userId],
  );
  return { userId, websiteId };
}

type Append = {
  readonly userId: string;
  readonly websiteId: string;
  readonly kind?: string;
  readonly url?: string;
  readonly observedAt?: string | null;
  readonly status?: string;
  readonly reason?: string | null;
  readonly bodyHash?: string | null;
  readonly excerpts?: unknown;
  readonly structured?: unknown;
  readonly independence?: string | null;
};

async function record(input: Append) {
  const result = await db.query(
    "select * from public.marketing_website_record_evidence_observation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [
      input.userId,
      input.websiteId,
      input.kind ?? "own_page",
      input.url ?? "https://acme.test/pricing",
      input.observedAt === undefined ? new Date().toISOString() : input.observedAt,
      input.status ?? "ok",
      input.reason ?? null,
      input.bodyHash === undefined ? BODY : input.bodyHash,
      JSON.stringify(input.excerpts ?? ["Plans start at $29 per month."]),
      JSON.stringify(input.structured ?? { jsonLdTypes: ["Organization"] }),
      input.independence ?? null,
    ],
  );
  return result.rows[0] as { outcome: string; observation: unknown };
}

async function readLatest(input: { userId: string; websiteId: string; kind?: string; url?: string }) {
  const result = await db.query(
    "select * from public.marketing_website_read_latest_evidence_observation($1,$2,$3,$4)",
    [input.userId, input.websiteId, input.kind ?? "own_page", input.url ?? "https://acme.test/pricing"],
  );
  return result.rows[0] as { outcome: string; observation: unknown };
}

describe("appending one observation", () => {
  it("stores it and hands back the row the reader accepts", async () => {
    const site = await website();
    const written = await record(site);
    expect(written.outcome).toBe("recorded");
    const parsed = parseGeoEvidenceObservation(written.observation);
    expect(parsed.status).toEqual({
      kind: "ok",
      bodyHash: BODY,
      excerpts: ["Plans start at $29 per month."],
      structured: { jsonLdTypes: ["Organization"] },
    });
    // The reader compares against `new Date(v).toISOString()`; PostgreSQL's own
    // timestamptz spelling is microseconds with a numeric offset and would not
    // survive that comparison.
    expect((written.observation as { observedAt: string }).observedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
    );
  });

  it("is idempotent on the natural key and returns what is stored", async () => {
    const site = await website();
    const observedAt = new Date().toISOString();
    const first = await record({ ...site, observedAt });
    const again = await record({ ...site, observedAt, bodyHash: "b".repeat(64) });
    expect(first.outcome).toBe("recorded");
    expect(again.outcome).toBe("duplicate");
    // The caller wanted "the ledger holds this observation", and what it holds
    // is the first write, not the second one's body.
    expect((again.observation as { bodyHash: string }).bodyHash).toBe(BODY);
  });

  it("appends a second row when the bytes are identical, and leaves the first alone", async () => {
    // This is the whole reason the table exists. Confirming an old row by
    // touching its timestamp would date two-month-old evidence today.
    const site = await website();
    const older = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const newer = new Date().toISOString();
    await record({ ...site, observedAt: older });
    await record({ ...site, observedAt: newer });
    const rows = await db.query(
      "select observed_at, body_hash from public.marketing_website_evidence_observations where website_id=$1 order by observed_at",
      [site.websiteId],
    );
    expect(rows.rowCount).toBe(2);
    expect(rows.rows[0].body_hash).toBe(rows.rows[1].body_hash);
    expect(new Date(rows.rows[0].observed_at as Date).toISOString()).toBe(older);
    const latest = await readLatest(site);
    expect(parseGeoEvidenceObservation(latest.observation).observedAt).toBe(newer);
  });
});

describe("refusing what the ledger must not hold", () => {
  it("refuses a missing observation time instead of falling through to the insert", async () => {
    // `NULL > now()` is NULL and an IF on NULL takes the false branch; a guard
    // written without the null test lets this reach the table.
    const site = await website();
    expect((await record({ ...site, observedAt: null })).outcome).toBe("invalid");
  });

  it("refuses an observation time from the future or the distant past", async () => {
    const site = await website();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const ancient = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    expect((await record({ ...site, observedAt: future })).outcome).toBe("invalid");
    expect((await record({ ...site, observedAt: ancient })).outcome).toBe("invalid");
  });

  it("refuses an unavailable observation that carries content", async () => {
    const site = await website();
    expect(
      (
        await record({
          ...site,
          status: "unavailable",
          reason: "timeout",
          bodyHash: null,
          excerpts: ["left over from the previous run"],
        })
      ).outcome,
    ).toBe("invalid");
    expect(
      (await record({ ...site, status: "unavailable", reason: "timeout", bodyHash: null, excerpts: [], structured: {} }))
        .outcome,
    ).toBe("recorded");
  });

  it("refuses a gate refusal as an observation of the site", async () => {
    // `rate_limited` is a fact about our quota. Storing it would suppress the
    // real fetch for a whole TTL and say nothing about the target.
    const site = await website();
    expect(
      (await record({ ...site, status: "unavailable", reason: "rate_limited", bodyHash: null, excerpts: [], structured: {} }))
        .outcome,
    ).toBe("invalid");
  });

  it("keeps independence a third-party judgement, in both directions", async () => {
    const site = await website();
    expect((await record({ ...site, independence: "independent" })).outcome).toBe("invalid");
    expect((await record({ ...site, kind: "third_party", url: "https://press.test/acme" })).outcome).toBe("invalid");
    expect(
      (await record({ ...site, kind: "third_party", url: "https://press.test/acme", independence: "undetermined" }))
        .outcome,
    ).toBe("recorded");
  });

  it("keeps a Search Console observation keyed by its exact window", async () => {
    const site = await website();
    const key = geoEvidenceGscKey({
      property: "sc-domain:acme.test",
      windowStart: "2026-06-09",
      windowEnd: "2026-09-07",
    });
    expect(key).toBe("sc-domain:acme.test#2026-06-09..2026-09-07");
    expect((await record({ ...site, kind: "gsc", url: key as string })).outcome).toBe("recorded");
    expect((await record({ ...site, kind: "gsc", url: "sc-domain:acme.test" })).outcome).toBe("invalid");
  });

  it("refuses more excerpts than the reader will accept", async () => {
    // A row the ledger stores and its only reader rejects reads downstream as
    // `unavailable` -- i.e. "fetch it again" -- forever.
    const site = await website();
    expect((await record({ ...site, excerpts: Array.from({ length: 9 }, (_, index) => `line ${index}`) })).outcome).toBe(
      "invalid",
    );
    expect((await record({ ...site, excerpts: [{ not: "a string" }] })).outcome).toBe("invalid");
    expect((await record({ ...site, excerpts: [""] })).outcome).toBe("invalid");
  });

  it("refuses an unknown kind or status", async () => {
    const site = await website();
    expect((await record({ ...site, kind: "screenshot" })).outcome).toBe("invalid");
    expect((await record({ ...site, status: "maybe" })).outcome).toBe("invalid");
  });
});

describe("owner scope", () => {
  it("refuses a website that is not this user's, on both the read and the write", async () => {
    const site = await website();
    const stranger = randomUUID();
    expect((await record({ ...site, userId: stranger })).outcome).toBe("not_found");
    await record(site);
    expect((await readLatest({ ...site, userId: stranger })).outcome).toBe("not_found");
    expect((await readLatest(site)).outcome).toBe("found");
  });

  it("reports never-observed separately from unknown website", async () => {
    const site = await website();
    expect((await readLatest({ ...site, url: "https://acme.test/never" })).outcome).toBe("none");
  });
});

describe("the ledger is append-only", () => {
  it("refuses update, delete and truncate", async () => {
    const site = await website();
    await record(site);
    await expect(
      db.query("update public.marketing_website_evidence_observations set body_hash=$1 where website_id=$2", [
        "c".repeat(64),
        site.websiteId,
      ]),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.query("delete from public.marketing_website_evidence_observations where website_id=$1", [site.websiteId]),
    ).rejects.toThrow(/append-only/);
    // TRUNCATE fires no row trigger; a lone row trigger is a locked door beside
    // an open one.
    await expect(db.query("truncate public.marketing_website_evidence_observations")).rejects.toThrow(/append-only/);
  });
});

describe("privileges are the boundary", () => {
  it("keeps the browser roles out of the table and the RPCs", async () => {
    const site = await website();
    for (const role of ["anon", "authenticated"]) {
      await db.query(`set role ${role}`);
      await expect(db.query("select 1 from public.marketing_website_evidence_observations")).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        db.query("select * from public.marketing_website_read_latest_evidence_observation($1,$2,'own_page','x')", [
          site.userId,
          site.websiteId,
        ]),
      ).rejects.toThrow(/permission denied/);
      await db.query("reset role");
    }
  });

  it("gives service_role no way to write around the RPC", async () => {
    const site = await website();
    await db.query("set role service_role");
    await expect(
      db.query(
        "insert into public.marketing_website_evidence_observations(website_id,user_id,kind,url,observed_at,status,body_hash) values($1,$2,'own_page','https://acme.test/',now(),'ok',$3)",
        [site.websiteId, site.userId, BODY],
      ),
    ).rejects.toThrow(/permission denied/);
    // Reading is granted; writing has to prove ownership, which only the RPC does.
    await db.query("select 1 from public.marketing_website_evidence_observations");
    await db.query("reset role");
  });
});
