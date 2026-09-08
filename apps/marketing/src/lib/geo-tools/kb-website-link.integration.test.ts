// @input -- only a named loopback disposable Marketing database and synthetic values
// @output -- proof that a knowledge base is bound to its Website row, and cannot disagree with it
// @pos -- real SQL tests, never a provider or production invocation

/**
 * D10: the GEO knowledge base and the Website row that describes the same site
 * were joined only by an unenforced text column. These tests pin the three
 * things the composite foreign key now guarantees, and the one thing it
 * deliberately does not: a knowledge base may exist before its Website row.
 */
import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectFreshMarketingSchema } from "../credits/sql-test-harness.ts";

let db: Client;
beforeAll(async () => {
  db = await connectFreshMarketingSchema();
});
afterAll(async () => {
  await db?.end();
});

async function website(userId: string, siteKey: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    "insert into public.marketing_websites(id,user_id,canonical_site_key,origin,submitted_url,host) values($1,$2,$3,$4,$4,$5)",
    [id, userId, siteKey, `https://${siteKey}`, siteKey],
  );
  return id;
}

async function upsert(userId: string, siteKey: string) {
  return (
    await db.query("select * from public.marketing_geo_upsert_kb($1,$2,$3,$4)", [
      userId,
      `https://${siteKey}`,
      siteKey,
      siteKey,
    ])
  ).rows[0];
}

async function readKb(kbId: string) {
  return (
    await db.query(
      "select website_id, canonical_site_key from public.marketing_geo_knowledge_bases where id=$1",
      [kbId],
    )
  ).rows[0];
}

describe("the GEO knowledge base is bound to its Website row", () => {
  it("links a knowledge base to the Website row that already exists", async () => {
    const userId = randomUUID();
    const websiteId = await website(userId, "linked.example");
    const created = await upsert(userId, "linked.example");

    expect(created.created).toBe(true);
    expect((await readKb(created.kb_id)).website_id).toBe(websiteId);
  });

  it("still creates a knowledge base when no Website row exists yet, and links it later", async () => {
    const userId = randomUUID();
    // The GEO tools accept a URL without requiring a confirmed Profile, so this
    // is a real state, not a degraded one. Inventing a Website row here would
    // put a record in the Profile registry that nobody created.
    const created = await upsert(userId, "late.example");
    expect(created.created).toBe(true);
    expect((await readKb(created.kb_id)).website_id).toBeNull();

    const websiteId = await website(userId, "late.example");
    const again = await upsert(userId, "late.example");

    expect(again.created).toBe(false);
    expect(again.kb_id).toBe(created.kb_id);
    expect((await readKb(created.kb_id)).website_id).toBe(websiteId);
  });

  it("refuses a link whose site key disagrees with the Website row's", async () => {
    const userId = randomUUID();
    const websiteId = await website(userId, "one.example");
    const created = await upsert(userId, "two.example");
    expect((await readKb(created.kb_id)).website_id).toBeNull();

    // This is the case a plain (website_id, user_id) reference would have
    // accepted: a real Website row, owned by the right user, describing a
    // different site. The site key is part of the key, so it cannot.
    await expect(
      db.query("update public.marketing_geo_knowledge_bases set website_id=$1 where id=$2", [
        websiteId,
        created.kb_id,
      ]),
    ).rejects.toThrow(/marketing_geo_kb_website_fk/u);
  });

  it("refuses a link to another account's Website row", async () => {
    const owner = randomUUID();
    const other = randomUUID();
    const foreignWebsite = await website(other, "shared.example");
    const created = await upsert(owner, "shared.example");
    expect((await readKb(created.kb_id)).website_id).toBeNull();

    await expect(
      db.query("update public.marketing_geo_knowledge_bases set website_id=$1 where id=$2", [
        foreignWebsite,
        created.kb_id,
      ]),
    ).rejects.toThrow(/marketing_geo_kb_website_fk/u);
  });

  it("refuses to delete a Website row a knowledge base still points at", async () => {
    const userId = randomUUID();
    const websiteId = await website(userId, "kept.example");
    await upsert(userId, "kept.example");

    await expect(
      db.query("delete from public.marketing_websites where id=$1", [websiteId]),
    ).rejects.toThrow(/marketing_geo_kb_website_fk/u);
  });

  it("backfills the link for knowledge bases that predate the constraint", async () => {
    // The migration's backfill ran against an empty table in this harness, so
    // reproduce the pre-migration state and re-run the same statement: a row
    // whose only tie to its Website was the text column gets linked, and a row
    // with no Website stays null.
    const userId = randomUUID();
    const websiteId = await website(userId, "historical.example");
    const linked = await upsert(userId, "historical.example");
    const orphan = await upsert(userId, "orphan.example");
    await db.query("update public.marketing_geo_knowledge_bases set website_id=null where user_id=$1", [
      userId,
    ]);

    await db.query(`
      update public.marketing_geo_knowledge_bases as k
         set website_id = w.id
        from public.marketing_websites as w
       where k.website_id is null
         and w.user_id = k.user_id
         and w.canonical_site_key = k.canonical_site_key`);

    expect((await readKb(linked.kb_id)).website_id).toBe(websiteId);
    expect((await readKb(orphan.kb_id)).website_id).toBeNull();
  });

  it("keeps the knowledge base table out of the browser's reach", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.query("begin");
      await db.query(`set local role ${role}`);
      await expect(
        db.query("select website_id from public.marketing_geo_knowledge_bases limit 1"),
      ).rejects.toThrow(/permission denied/u);
      await db.query("rollback");
    }
  });
});
