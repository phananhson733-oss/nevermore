// @input  -- a disposable Postgres rebuilt by db/tasks/migrate.sh
// @output -- proof that the task center's SQL does what the stores promise, promoter accounts included
// @pos    -- the only test that executes task center SQL
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Pool, type Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  claimTask,
  followPromoCode,
  listClaimsForDrama,
  listMyClaims,
  promoRedirectUrl,
} from "./claims-store.ts";
import {
  listAccountsForReview,
  listMyAccounts,
  reviewAccount,
  submitAccount,
  withdrawAccount,
} from "./accounts-store.ts";
import { MAX_ACCOUNTS_PER_USER, type DramaInput } from "./contracts.ts";
import {
  createDrama,
  createPendingAsset,
  deleteAsset,
  getPublicAsset,
  getPublishedDrama,
  listPublishedDramas,
  listPublishedFacets,
  markAssetReady,
  setDramaCover,
  setDramaStatus,
  updateDrama,
} from "./dramas-store.ts";
import { getMyEarnings, importEarnings, listEarningImports } from "./earnings-store.ts";
import {
  connectFreshTaskSchema,
  migrateScript,
  requireTaskTestDatabaseUrl,
  runMigrations,
} from "./sql-test-harness.ts";

const ADMIN = "ops@gengrowth.ai";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

let db: Client;

beforeAll(async () => {
  db = await connectFreshTaskSchema();
});

afterAll(async () => {
  await db?.end();
});

beforeEach(async () => {
  await db.query(
    "truncate task_center.earnings, task_center.earning_imports, task_center.promo_clicks, task_center.task_claims, task_center.drama_assets, task_center.dramas, task_center.promoter_accounts",
  );
});

function drama(overrides: Partial<DramaInput> = {}): DramaInput {
  return {
    title: "The Heiress Returns",
    titleCn: "千金归来",
    platform: "reelshort",
    language: "en",
    episodes: 80,
    payStart: 10,
    synopsis: null,
    promoTargetUrl: "https://example.com/d/1?src=gg",
    promoCodeParam: null,
    ...overrides,
  };
}

async function publishedDrama(overrides: Partial<DramaInput> = {}): Promise<string> {
  const id = await createDrama(db, drama(overrides), ADMIN);
  expect(await setDramaStatus(db, id, "published")).toEqual({ ok: true });
  return id;
}

const everything = { sort: "newest", page: 1, pageSize: 50 } as const;

describe("migrate.sh", () => {
  it("skips files it already applied", () => {
    expect(runMigrations()).toBe("");
  });

  it("rolls a failing file back whole and stops before the next", async () => {
    const dir = mkdtempSync(join(tmpdir(), "task-migrate-"));
    try {
      copyFileSync(migrateScript, join(dir, "migrate.sh"));
      copyFileSync(
        new URL("../../../db/tasks/0001_task_center.sql", import.meta.url),
        join(dir, "0001_task_center.sql"),
      );
      writeFileSync(
        join(dir, "0002_broken.sql"),
        "create table task_center.half_done (id int); select 1/0;",
      );
      writeFileSync(join(dir, "0003_later.sql"), "create table task_center.later (id int);");
      expect(() => runMigrations(join(dir, "migrate.sh"))).toThrow();
      const { rows } = await db.query(
        `select to_regclass('task_center.half_done') as half, to_regclass('task_center.later') as later,
                (select count(*)::int from task_center.schema_migrations where filename = '0002_broken.sql') as recorded`,
      );
      expect(rows[0]).toEqual({ half: null, later: null, recorded: 0 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a file name it would have to splice unsafely", () => {
    const dir = mkdtempSync(join(tmpdir(), "task-migrate-"));
    try {
      copyFileSync(migrateScript, join(dir, "migrate.sh"));
      writeFileSync(join(dir, "0009_x';drop.sql"), "select 1;");
      expect(() => runMigrations(join(dir, "migrate.sh"))).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("dramas", () => {
  it("keeps drafts out of the public list and detail", async () => {
    const id = await createDrama(db, drama(), ADMIN);
    expect((await listPublishedDramas(db, everything)).total).toBe(0);
    expect(await getPublishedDrama(db, id)).toBeNull();
  });

  it("will not publish a drama with nowhere to send visitors", async () => {
    const id = await createDrama(db, drama({ promoTargetUrl: null }), ADMIN);
    expect(await setDramaStatus(db, id, "published")).toEqual({
      ok: false,
      code: "published_needs_target",
    });
    await setDramaStatus(db, (await publishedDrama()), "published");
    const live = await publishedDrama({ title: "Live" });
    expect(await updateDrama(db, live, drama({ promoTargetUrl: null }))).toEqual({
      ok: false,
      code: "published_needs_target",
    });
  });

  it("keeps the first listing time when a drama is republished", async () => {
    const id = await publishedDrama();
    const first = (await getPublishedDrama(db, id))!.drama.listedAt;
    await setDramaStatus(db, id, "archived");
    expect(await getPublishedDrama(db, id)).toBeNull();
    await setDramaStatus(db, id, "published");
    expect((await getPublishedDrama(db, id))!.drama.listedAt).toBe(first);
  });

  it("filters, searches literally, sorts by promoters and pages", async () => {
    const a = await publishedDrama({ title: "100% Revenge", platform: "reelshort" });
    const b = await publishedDrama({ title: "Moon_Light", titleCn: "月光", platform: "dramabox", language: "es" });
    const c = await publishedDrama({ title: "Plain", platform: "dramabox" });
    await claimTask(db, { userId: USER_A, dramaId: c, channel: "tiktok" });
    await claimTask(db, { userId: USER_A, dramaId: c, channel: "youtube" });
    await claimTask(db, { userId: USER_B, dramaId: c, channel: "tiktok" });
    await claimTask(db, { userId: USER_A, dramaId: b, channel: "tiktok" });

    const byPlatform = await listPublishedDramas(db, { ...everything, platform: "dramabox" });
    expect(byPlatform.items.map((d) => d.id).sort()).toEqual([b, c].sort());

    expect((await listPublishedDramas(db, { ...everything, search: "%" })).items.map((d) => d.id)).toEqual([a]);
    // "_" as a wildcard would match "Moon"; as a letter it matches nothing.
    expect((await listPublishedDramas(db, { ...everything, search: "M_on" })).total).toBe(0);
    expect((await listPublishedDramas(db, { ...everything, search: "n_l" })).items.map((d) => d.id)).toEqual([b]);
    expect((await listPublishedDramas(db, { ...everything, search: "月光" })).items.map((d) => d.id)).toEqual([b]);
    expect((await listPublishedDramas(db, { ...everything, language: "es" })).items.map((d) => d.id)).toEqual([b]);

    const popular = await listPublishedDramas(db, { ...everything, sort: "promoters" });
    expect(popular.items.map((d) => [d.id, d.promoterCount])).toEqual([
      [c, 2],
      [b, 1],
      [a, 0],
    ]);

    const page2 = await listPublishedDramas(db, { sort: "promoters", page: 2, pageSize: 2 });
    expect(page2).toMatchObject({ total: 3, items: [{ id: a }] });

    expect(await listPublishedFacets(db)).toEqual({
      platforms: ["dramabox", "reelshort"],
      languages: ["en", "es"],
    });
  });

  it("sets a cover only on a drama that exists", async () => {
    const id = await createDrama(db, drama(), ADMIN);
    expect(await setDramaCover(db, id, "covers/a.jpg")).toBe(true);
    expect(await setDramaCover(db, USER_A, "covers/c.jpg")).toBe(false);
  });
});

describe("assets", () => {
  it("shows an asset only once it is ready and its drama is published", async () => {
    const dramaId = await createDrama(db, drama(), ADMIN);
    const assetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(
      await createPendingAsset(db, {
        id: assetId,
        dramaId,
        title: "Ep 1 hook",
        objectKey: `dramas/${dramaId}/${assetId}.mp4`,
        contentType: "video/mp4",
        byteSize: 52_000_000,
        createdBy: ADMIN,
      }),
    ).toBe(true);
    expect(await getPublicAsset(db, assetId)).toBeNull();
    await markAssetReady(db, assetId);
    expect(await getPublicAsset(db, assetId)).toBeNull();
    await setDramaStatus(db, dramaId, "published");
    expect(await getPublicAsset(db, assetId)).toMatchObject({ kind: "video", byteSize: 52_000_000 });
    expect((await getPublishedDrama(db, dramaId))!.assets).toHaveLength(1);
    expect(await deleteAsset(db, assetId)).toBe(`dramas/${dramaId}/${assetId}.mp4`);
    expect(await deleteAsset(db, assetId)).toBeNull();
    // A completion that arrives after the delete has nothing to mark.
    expect(await markAssetReady(db, assetId)).toBe(false);
  });

  it("refuses an asset for a drama that does not exist", async () => {
    expect(
      await createPendingAsset(db, {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        dramaId: USER_A,
        title: "x",
        objectKey: "dramas/x/y.png",
        contentType: "image/png",
        byteSize: 10,
        createdBy: ADMIN,
      }),
    ).toBe(false);
  });
});

describe("claims and promo links", () => {
  it("returns the same code when the same channel is claimed twice", async () => {
    const id = await publishedDrama();
    const first = await claimTask(db, { userId: USER_A, dramaId: id, channel: "tiktok" });
    const again = await claimTask(db, { userId: USER_A, dramaId: id, channel: "tiktok" });
    const other = await claimTask(db, { userId: USER_A, dramaId: id, channel: "youtube" });
    expect(first.ok && again.ok && other.ok).toBe(true);
    if (!first.ok || !again.ok || !other.ok) return;
    expect(first.created).toBe(true);
    expect(again).toMatchObject({ created: false, claim: { code: first.claim.code } });
    expect(other.claim.code).not.toBe(first.claim.code);
    expect((await listClaimsForDrama(db, USER_A, id)).map((c) => c.channel)).toEqual(["tiktok", "youtube"]);
    expect(await listClaimsForDrama(db, USER_B, id)).toEqual([]);
  });

  it("gives one link per drama on channel all, beside codes claimed per channel before", async () => {
    const id = await publishedDrama();
    const old = await claimTask(db, { userId: USER_A, dramaId: id, channel: "tiktok" });
    const first = await claimTask(db, { userId: USER_A, dramaId: id, channel: "all" });
    const again = await claimTask(db, { userId: USER_A, dramaId: id, channel: "all" });
    if (!old.ok || !first.ok || !again.ok) throw new Error("claim failed");
    expect(first.created).toBe(true);
    expect(again).toMatchObject({ created: false, claim: { code: first.claim.code, channel: "all" } });
    expect(first.claim.code).not.toBe(old.claim.code);
    expect((await listClaimsForDrama(db, USER_A, id)).map((c) => c.channel)).toEqual(["tiktok", "all"]);
    expect(await followPromoCode(db, first.claim.code)).not.toBeNull();
    await expect(
      db.query(
        "insert into task_center.task_claims (user_id, drama_id, channel, code) values ($1, $2, 'twitter', 'cccc4444')",
        [USER_B, id],
      ),
    ).rejects.toMatchObject({ constraint: "task_claims_channel_check" });
  });

  it("will not hand out a code for a drama that is not live", async () => {
    const draft = await createDrama(db, drama(), ADMIN);
    expect(await claimTask(db, { userId: USER_A, dramaId: draft, channel: "tiktok" })).toEqual({
      ok: false,
      code: "not_found",
    });
  });

  it("draws a new code when the first one is taken", async () => {
    const id = await publishedDrama();
    const taken = await claimTask(db, { userId: USER_A, dramaId: id, channel: "tiktok" }, () => "aaaa2222");
    expect(taken.ok && taken.claim.code).toBe("aaaa2222");
    const codes = ["aaaa2222", "bbbb3333"];
    const next = await claimTask(db, { userId: USER_B, dramaId: id, channel: "tiktok" }, () => codes.shift()!);
    expect(next.ok && next.claim.code).toBe("bbbb3333");
  });

  it("counts each followed link and forwards with the code when the platform takes one", async () => {
    const id = await publishedDrama({ promoCodeParam: "sub_id" });
    const claim = await claimTask(db, { userId: USER_A, dramaId: id, channel: "facebook" });
    if (!claim.ok) throw new Error("claim failed");
    const code = claim.claim.code;

    const target = await followPromoCode(db, code);
    await followPromoCode(db, code);
    expect(target).toEqual({ targetUrl: "https://example.com/d/1?src=gg", codeParam: "sub_id" });
    expect(promoRedirectUrl(target!, code)).toBe(`https://example.com/d/1?src=gg&sub_id=${code}`);
    // A Location header must be ASCII, with or without a code parameter.
    expect(promoRedirectUrl({ targetUrl: "https://example.com/剧/1", codeParam: null }, code)).toBe(
      "https://example.com/%E5%89%A7/1",
    );
    expect(await followPromoCode(db, "zzzz9999")).toBeNull();

    await setDramaStatus(db, id, "archived");
    expect(await followPromoCode(db, code)).not.toBeNull();

    const mine = await listMyClaims(db, USER_A);
    expect(mine).toMatchObject([{ code, clicks: 3, dramaTitle: "The Heiress Returns", channel: "facebook" }]);
  });
});

describe("earnings", () => {
  async function claimedCode(userId: string, dramaId: string, channel: "tiktok" | "youtube"): Promise<string> {
    const claim = await claimTask(db, { userId, dramaId, channel });
    if (!claim.ok) throw new Error("claim failed");
    return claim.claim.code;
  }

  it("refuses the whole file when any code has no owner", async () => {
    const id = await publishedDrama();
    const code = await claimedCode(USER_A, id, "tiktok");
    const result = await importEarnings(db, {
      importedBy: ADMIN,
      fileName: "nov.csv",
      currency: "USD",
      rows: [
        { day: "2026-11-01", code, orders: 1, adAmountMinor: null, incomeMinor: 100 },
        { day: "2026-11-01", code: "zzzz9999", orders: 1, adAmountMinor: null, incomeMinor: 100 },
      ],
    });
    expect(result).toEqual({ ok: false, code: "unknown_codes", unknownCodes: ["zzzz9999"] });
    expect(await listEarningImports(db)).toEqual([]);
    expect((await getMyEarnings(db, USER_A)).totals).toEqual([]);
  });

  it("replaces a day imported twice and keeps unreported figures unknown", async () => {
    const id = await publishedDrama({ platform: "reelshort" });
    const other = await publishedDrama({ title: "Other", platform: "dramabox" });
    const tiktok = await claimedCode(USER_A, id, "tiktok");
    const youtube = await claimedCode(USER_A, other, "youtube");
    const stranger = await claimedCode(USER_B, id, "tiktok");

    await importEarnings(db, {
      importedBy: ADMIN,
      fileName: "a.csv",
      currency: "USD",
      rows: [
        { day: "2026-11-01", code: tiktok, orders: 3, adAmountMinor: null, incomeMinor: 1050 },
        { day: "2026-11-02", code: tiktok, orders: 1, adAmountMinor: null, incomeMinor: 200 },
        { day: "2026-11-02", code: stranger, orders: 9, adAmountMinor: 900, incomeMinor: 9000 },
      ],
    });
    await importEarnings(db, {
      importedBy: ADMIN,
      fileName: "b.csv",
      currency: "USD",
      rows: [{ day: "2026-11-02", code: tiktok, orders: 2, adAmountMinor: null, incomeMinor: 400 }],
    });
    await importEarnings(db, {
      importedBy: ADMIN,
      fileName: "c.csv",
      currency: "JPY",
      rows: [{ day: "2026-11-03", code: youtube, orders: null, adAmountMinor: null, incomeMinor: 500 }],
    });

    const unknown = { total: null, partial: false };
    const mine = await getMyEarnings(db, USER_A);
    expect(mine.totals).toEqual([
      {
        currency: "JPY",
        firstDay: "2026-11-03",
        lastDay: "2026-11-03",
        orders: unknown,
        adAmountMinor: unknown,
        incomeMinor: { total: "500", partial: false },
      },
      {
        currency: "USD",
        firstDay: "2026-11-01",
        lastDay: "2026-11-02",
        orders: { total: "5", partial: false },
        adAmountMinor: unknown,
        incomeMinor: { total: "1450", partial: false },
      },
    ]);
    expect(mine.byPlatform).toEqual([
      {
        platform: "dramabox",
        currency: "JPY",
        orders: unknown,
        adAmountMinor: unknown,
        incomeMinor: { total: "500", partial: false },
      },
      {
        platform: "reelshort",
        currency: "USD",
        orders: { total: "5", partial: false },
        adAmountMinor: unknown,
        incomeMinor: { total: "1450", partial: false },
      },
    ]);
    expect((await getMyEarnings(db, USER_B)).totals).toMatchObject([{ incomeMinor: { total: "9000" } }]);
    expect((await listEarningImports(db)).map((i) => i.fileName)).toEqual(["c.csv", "b.csv", "a.csv"]);
  });

  it("marks a total that some days did not report as partial", async () => {
    const id = await publishedDrama();
    const code = await claimedCode(USER_A, id, "tiktok");
    await importEarnings(db, {
      importedBy: ADMIN,
      fileName: "mixed.csv",
      currency: "USD",
      rows: [
        { day: "2026-11-01", code, orders: 2, adAmountMinor: null, incomeMinor: null },
        { day: "2026-11-02", code, orders: null, adAmountMinor: null, incomeMinor: 300 },
      ],
    });
    expect((await getMyEarnings(db, USER_A)).totals).toMatchObject([
      {
        orders: { total: "2", partial: true },
        adAmountMinor: { total: null, partial: false },
        incomeMinor: { total: "300", partial: true },
      },
    ]);
  });

  it("adds amounts past Number.MAX_SAFE_INTEGER without rounding", async () => {
    const id = await publishedDrama();
    const code = await claimedCode(USER_A, id, "tiktok");
    await importEarnings(db, {
      importedBy: ADMIN,
      fileName: "big.csv",
      currency: "USD",
      rows: [
        { day: "2026-11-01", code, orders: null, adAmountMinor: null, incomeMinor: Number.MAX_SAFE_INTEGER },
        { day: "2026-11-02", code, orders: null, adAmountMinor: null, incomeMinor: Number.MAX_SAFE_INTEGER },
      ],
    });
    expect((await getMyEarnings(db, USER_A)).totals).toMatchObject([
      { incomeMinor: { total: "18014398509481982", partial: false } },
    ]);
  });
});

describe("promoter accounts", () => {
  it("files an account once per handle in any letter case and keeps its review", async () => {
    const first = await submitAccount(db, { userId: USER_A, userEmail: "a@example.com", platform: "tiktok", handle: " @Drama.Fan " });
    if (!first.ok) throw new Error("submit failed");
    expect(first).toMatchObject({ created: true, account: { handle: "@Drama.Fan", status: "submitted", reviewedAt: null } });

    expect(await reviewAccount(db, first.account.id, "whitelisted", ADMIN)).toBe(true);
    const again = await submitAccount(db, { userId: USER_A, userEmail: "a@example.com", platform: "tiktok", handle: "@drama.fan" });
    expect(again).toMatchObject({ ok: true, created: false, account: { id: first.account.id, status: "whitelisted" } });

    // The same handle on the other platform, or for someone else, is its own account.
    const facebook = await submitAccount(db, { userId: USER_A, userEmail: null, platform: "facebook", handle: "@drama.fan" });
    const other = await submitAccount(db, { userId: USER_B, userEmail: null, platform: "tiktok", handle: "@drama.fan" });
    expect(facebook.ok && facebook.created && other.ok && other.created).toBe(true);
    expect((await listMyAccounts(db, USER_A)).map((a) => a.platform)).toEqual(["tiktok", "facebook"]);
  });

  it("stops at the cap per person", async () => {
    for (let i = 0; i < MAX_ACCOUNTS_PER_USER; i += 1) {
      const result = await submitAccount(db, { userId: USER_A, userEmail: null, platform: "tiktok", handle: `@fan${i}` });
      expect(result.ok).toBe(true);
    }
    expect(await submitAccount(db, { userId: USER_A, userEmail: null, platform: "tiktok", handle: "@one.more" })).toEqual({
      ok: false,
      code: "too_many_accounts",
    });
    // A handle already on file still answers, cap or not.
    expect(await submitAccount(db, { userId: USER_A, userEmail: null, platform: "tiktok", handle: "@FAN0" })).toMatchObject({
      ok: true,
      created: false,
    });
  });

  it("holds the cap when submissions arrive at the same time", async () => {
    for (let i = 0; i < MAX_ACCOUNTS_PER_USER - 1; i += 1) {
      await submitAccount(db, { userId: USER_A, userEmail: null, platform: "tiktok", handle: `@fan${i}` });
    }
    // Separate connections, so the submissions really overlap.
    const pool = new Pool({ connectionString: requireTaskTestDatabaseUrl(), max: 6 });
    try {
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          submitAccount(pool, { userId: USER_A, userEmail: null, platform: "facebook", handle: `@race${i}` }),
        ),
      );
      expect(results.filter((r) => r.ok).length).toBe(1);
      expect(await listMyAccounts(db, USER_A)).toHaveLength(MAX_ACCOUNTS_PER_USER);
    } finally {
      await pool.end();
    }
  });

  it("lets a promoter withdraw only their own account, and only while it waits", async () => {
    const a = await submitAccount(db, { userId: USER_A, userEmail: null, platform: "tiktok", handle: "@a" });
    const b = await submitAccount(db, { userId: USER_A, userEmail: null, platform: "facebook", handle: "fb.com/a" });
    const c = await submitAccount(db, { userId: USER_A, userEmail: null, platform: "tiktok", handle: "@c" });
    if (!a.ok || !b.ok || !c.ok) throw new Error("submit failed");
    await reviewAccount(db, b.account.id, "whitelisted", ADMIN);
    await reviewAccount(db, c.account.id, "rejected", ADMIN);

    expect(await withdrawAccount(db, USER_B, a.account.id)).toBe(false);
    expect(await withdrawAccount(db, USER_A, b.account.id)).toBe(false);
    // Deleting a rejection and resubmitting would wipe it, so it stays.
    expect(await withdrawAccount(db, USER_A, c.account.id)).toBe(false);
    expect(await withdrawAccount(db, USER_A, a.account.id)).toBe(true);
    expect((await listMyAccounts(db, USER_A)).map((x) => x.id)).toEqual([b.account.id, c.account.id]);
  });

  it("lists waiting accounts first for review and records who reviewed", async () => {
    const older = await submitAccount(db, { userId: USER_A, userEmail: "a@example.com", platform: "tiktok", handle: "@older" });
    const reviewed = await submitAccount(db, { userId: USER_B, userEmail: "b@example.com", platform: "tiktok", handle: "@done" });
    const newer = await submitAccount(db, { userId: USER_B, userEmail: "b@example.com", platform: "facebook", handle: "@newer" });
    if (!older.ok || !reviewed.ok || !newer.ok) throw new Error("submit failed");
    expect(await reviewAccount(db, reviewed.account.id, "rejected", ADMIN)).toBe(true);
    expect(await reviewAccount(db, "33333333-3333-4333-8333-333333333333", "rejected", ADMIN)).toBe(false);

    const list = await listAccountsForReview(db);
    expect(list.map((a) => a.handle)).toEqual(["@older", "@newer", "@done"]);
    expect(list[2]).toMatchObject({ status: "rejected", reviewedBy: ADMIN, userEmail: "b@example.com", userId: USER_B });
    expect(list[2]!.reviewedAt).not.toBeNull();

    // Reviewed rows must say by whom; the table refuses one that does not.
    await expect(
      db.query("update task_center.promoter_accounts set reviewed_by = null where id = $1", [reviewed.account.id]),
    ).rejects.toThrow();
  });
});
