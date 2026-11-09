// @input  -- a disposable Postgres rebuilt by db/tasks/migrate.sh
// @output -- proof that the task center's SQL does what the stores promise: the clip grid (its filters, the 标签 one included, and their choices) and its 本周爆款 rule, each listed drama's dialog details, imports from 查剧 (频道 and genre from the theater's page, one drama whichever 北斗 id found it, 完结 left unknown for a 剧库 row, GoodShort's base64 ids) and tags, publishing without a platform link, the reader's drama page (trailer pick, taken-down dramas kept, drafts not), promo clicks that open it, and 去看全集 carrying only a code claimed for that drama, promoter accounts included
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
  getPlatformLink,
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
import { MAX_ACCOUNTS_PER_USER, type ClipType, type DramaInput } from "./contracts.ts";
import { toImportedDrama, type LookupDrama } from "./drama-lookup.ts";
import {
  createDrama,
  createPendingAsset,
  deleteAsset,
  getDramaForAdmin,
  getLandingDrama,
  getPublicAsset,
  getPublishedDrama,
  importDrama,
  listedBySource,
  listPlazaDramaDetails,
  listPublishedAssets,
  listPublishedFacets,
  markAssetReady,
  updateAsset,
  setDramaCover,
  setDramaStatus,
  updateDrama,
} from "./dramas-store.ts";
import { getMyEarnings, importEarnings, listEarningImports } from "./earnings-store.ts";
import type { TheaterDetails } from "./theater-details.ts";
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
    audience: null,
    genre: null,
    ...overrides,
  };
}

async function publishedDrama(overrides: Partial<DramaInput> = {}): Promise<string> {
  const id = await createDrama(db, drama(overrides), ADMIN);
  expect(await setDramaStatus(db, id, "published")).toEqual({ ok: true });
  return id;
}

const everything = { sort: "newest", page: 1, pageSize: 50 } as const;

let assetSeq = 0;

/** A ready clip on a drama; uploads are spaced a second apart so "newest" is certain. */
async function readyClip(
  dramaId: string,
  options: { title?: string; clipType?: ClipType | null; contentType?: string; posterKey?: string | null } = {},
): Promise<string> {
  assetSeq += 1;
  const id = `cccccccc-cccc-4ccc-8ccc-${String(assetSeq).padStart(12, "0")}`;
  const contentType = options.contentType ?? "video/mp4";
  expect(
    await createPendingAsset(db, {
      id,
      dramaId,
      title: options.title ?? `Clip ${assetSeq}`,
      objectKey: `dramas/${dramaId}/assets/${id}.${contentType === "video/mp4" ? "mp4" : "png"}`,
      contentType,
      byteSize: 1_000 + assetSeq,
      clipType: options.clipType ?? null,
      createdBy: ADMIN,
    }),
  ).toBe(true);
  expect(await markAssetReady(db, id, options.posterKey ?? null)).toEqual({ posterKey: options.posterKey ?? null });
  await db.query(
    "update task_center.drama_assets set uploaded_at = now() - make_interval(secs => 1000 - $2::int) where id = $1",
    [id, assetSeq],
  );
  return id;
}

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
    await readyClip(id);
    expect((await listPublishedAssets(db, everything)).total).toBe(0);
    expect(await getPublishedDrama(db, id)).toBeNull();
  });

  it("publishes a drama without a platform link, and still takes only https for one", async () => {
    const id = await createDrama(db, drama({ promoTargetUrl: null }), ADMIN);
    expect(await setDramaStatus(db, id, "published")).toEqual({ ok: true });
    const live = await publishedDrama({ title: "Live" });
    expect(await updateDrama(db, live, drama({ promoTargetUrl: null }))).toEqual({ ok: true });
    expect((await getPublishedDrama(db, live))?.drama.promoTargetUrl).toBeNull();
    await expect(
      db.query("update task_center.dramas set promo_target_url = 'http://example.com/d/1' where id = $1", [live]),
    ).rejects.toMatchObject({ constraint: "dramas_promo_target_url_check" });
  });

  it("gives a listed drama's reader page: a trailer-tagged video first, else the first video, never the platform URL", async () => {
    const live = await publishedDrama({ synopsis: "A long-lost heiress.", tags: ["CEO"] });
    await readyClip(live, { clipType: "highlight" });
    const trailer = await readyClip(live, { clipType: "trailer" });
    const still = `dramas/${live}/posters/${trailer}.jpg`;
    await markAssetReady(db, trailer, still);
    await readyClip(live, { clipType: "trailer", contentType: "image/png" });
    const page = await getLandingDrama(db, live);
    expect(page).toEqual({
      id: live,
      title: "The Heiress Returns",
      titleCn: "千金归来",
      platform: "reelshort",
      language: "en",
      episodes: 80,
      genre: null,
      tags: ["CEO"],
      synopsis: "A long-lost heiress.",
      coverKey: null,
      hasPlatformLink: true,
      trailer: { objectKey: `dramas/${live}/assets/${trailer}.mp4`, posterKey: still },
    });
    expect(JSON.stringify(page)).not.toContain("example.com");

    const plain = await publishedDrama({ title: "Plain", promoTargetUrl: null });
    await readyClip(plain, { contentType: "image/png" });
    const first = await readyClip(plain);
    // Tagged, but not as a trailer: no better than an untagged clip.
    await readyClip(plain, { clipType: "highlight" });
    await readyClip(plain);
    expect(await getLandingDrama(db, plain)).toMatchObject({
      hasPlatformLink: false,
      trailer: { objectKey: `dramas/${plain}/assets/${first}.mp4`, posterKey: null },
    });
    const bare = await publishedDrama({ title: "Bare" });
    expect(await getLandingDrama(db, bare)).toMatchObject({ trailer: null, tags: [] });

    // Taken down, its posted links still open the page; never listed, there is none.
    await setDramaStatus(db, live, "archived");
    expect(await getLandingDrama(db, live)).toMatchObject({ id: live });
    const draft = await createDrama(db, drama({ title: "Draft" }), ADMIN);
    await readyClip(draft);
    expect(await getLandingDrama(db, draft)).toBeNull();
    expect(await getLandingDrama(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("gives each listed drama's synopsis and ready clips in order, and nothing for a draft", async () => {
    const live = await publishedDrama({ synopsis: "A long-lost heiress." });
    const plain = await publishedDrama({ title: "Plain" });
    const draft = await createDrama(db, drama({ title: "Draft" }), ADMIN);
    await readyClip(draft);
    const first = await readyClip(live, { title: "One" });
    const second = await readyClip(live, { title: "Two" });
    // Still uploading: not a clip anyone can download yet.
    assetSeq += 1;
    const pending = `cccccccc-cccc-4ccc-8ccc-${String(assetSeq).padStart(12, "0")}`;
    await createPendingAsset(db, {
      id: pending,
      dramaId: live,
      title: "Pending",
      objectKey: `dramas/${live}/assets/${pending}.mp4`,
      contentType: "video/mp4",
      byteSize: 1_000,
      clipType: null,
      createdBy: ADMIN,
    });
    const details = await listPlazaDramaDetails(db, [live, plain, live, draft]);
    expect(Object.keys(details).sort()).toEqual([live, plain].sort());
    expect(details[live]).toMatchObject({
      synopsis: "A long-lost heiress.",
      clips: [
        { id: first, title: "One" },
        { id: second, title: "Two" },
      ],
    });
    expect(details[plain]).toEqual({ synopsis: null, clips: [] });
    expect(await listPlazaDramaDetails(db, [])).toEqual({});
  });

  it("keeps the first listing time when a drama is republished", async () => {
    const id = await publishedDrama();
    const first = (await getPublishedDrama(db, id))!.drama.listedAt;
    await setDramaStatus(db, id, "archived");
    expect(await getPublishedDrama(db, id)).toBeNull();
    await setDramaStatus(db, id, "published");
    expect((await getPublishedDrama(db, id))!.drama.listedAt).toBe(first);
  });

  it("filters clips, searches literally, sorts by promoters and pages", async () => {
    // a has no tags: the facets must still count it.
    const a = await publishedDrama({ title: "100% Revenge", platform: "reelshort", audience: "female", genre: "revenge" });
    const b = await publishedDrama({
      title: "Moon_Light",
      titleCn: "月光",
      platform: "dramabox",
      language: "es",
      genre: "werewolf",
      tags: ["Werewolf", "Alpha"],
    });
    const c = await publishedDrama({ title: "Plain", platform: "dramabox", audience: "male", tags: ["Alpha"] });
    const draft = await createDrama(db, drama({ title: "Draft", tags: ["Alpha", "Hidden"] }), ADMIN);
    const clipA = await readyClip(a, { clipType: "recap" });
    const clipB = await readyClip(b, { title: "Full moon hook", clipType: "highlight" });
    const clipC1 = await readyClip(c, { clipType: "recap" });
    const clipC2 = await readyClip(c, { contentType: "image/png" });
    await readyClip(draft);
    await claimTask(db, { userId: USER_A, dramaId: c, channel: "all" });
    await claimTask(db, { userId: USER_B, dramaId: c, channel: "all" });
    await claimTask(db, { userId: USER_A, dramaId: b, channel: "all" });

    const ids = async (query: Partial<Parameters<typeof listPublishedAssets>[1]>) =>
      (await listPublishedAssets(db, { ...everything, ...query })).items.map((item) => item.id);

    // Newest upload first, every ready clip of every published drama.
    expect(await ids({})).toEqual([clipC2, clipC1, clipB, clipA]);
    expect(await ids({ platform: "dramabox" })).toEqual([clipC2, clipC1, clipB]);
    expect(await ids({ audience: "female" })).toEqual([clipA]);
    expect(await ids({ genre: "werewolf" })).toEqual([clipB]);
    expect(await ids({ clipType: "recap" })).toEqual([clipC1, clipA]);
    expect(await ids({ language: "es" })).toEqual([clipB]);

    // 标签: one tag, spelled as stored, on a published drama.
    expect(await ids({ tag: "Alpha" })).toEqual([clipC2, clipC1, clipB]);
    expect(await ids({ tag: "Werewolf" })).toEqual([clipB]);
    expect(await ids({ tag: "werewolf" })).toEqual([]);
    expect(await ids({ tag: "Hidden" })).toEqual([]);
    expect(await ids({ tag: "Alpha", clipType: "highlight" })).toEqual([clipB]);

    expect(await ids({ search: "%" })).toEqual([clipA]);
    // "_" as a wildcard would match "Moon"; as a letter it matches nothing.
    expect(await ids({ search: "M_on" })).toEqual([]);
    expect(await ids({ search: "n_l" })).toEqual([clipB]);
    expect(await ids({ search: "月光" })).toEqual([clipB]);
    // The clip's own title is searched too.
    expect(await ids({ search: "full moon" })).toEqual([clipB]);

    const popular = await listPublishedAssets(db, { ...everything, sort: "promoters" });
    expect(popular.items.map((item) => [item.id, item.drama.promoterCount])).toEqual([
      [clipC2, 2],
      [clipC1, 2],
      [clipB, 1],
      [clipA, 0],
    ]);
    expect(popular.items[0]).toMatchObject({ kind: "image", drama: { audience: "male", genre: null } });

    const page2 = await listPublishedAssets(db, { sort: "newest", page: 2, pageSize: 3 });
    expect(page2).toMatchObject({ total: 4, items: [{ id: clipA }] });

    // Each tag once, and none that only a draft has.
    expect(await listPublishedFacets(db)).toEqual({
      platforms: ["dramabox", "reelshort"],
      languages: ["en", "es"],
      genres: ["revenge", "werewolf"],
      tags: ["Alpha", "Werewolf"],
    });
  });

  it("badges the three dramas the most people claimed in the last seven days", async () => {
    const users = Array.from({ length: 4 }, (_, i) => `3333333${i}-3333-4333-8333-333333333333`);
    const dramas = await Promise.all(
      ["One", "Two", "Three", "Four", "Five"].map((title) => publishedDrama({ title })),
    );
    for (const id of dramas) await readyClip(id);
    const hot = async () =>
      (await listPublishedAssets(db, everything)).items.filter((item) => item.hot).map((item) => item.drama.id).sort();

    // Nobody has claimed anything: no badge at all.
    expect(await hot()).toEqual([]);

    const claim = (userId: string, dramaId: string) => claimTask(db, { userId, dramaId, channel: "all" });
    // Four people this week on One, three on Two, two on Three, one on Four.
    for (const [index, count] of [4, 3, 2, 1].entries()) {
      for (const userId of users.slice(0, count)) await claim(userId, dramas[index]!);
    }
    // Five had four people too, but eight days ago, which does not count.
    for (const userId of users) await claim(userId, dramas[4]!);
    await db.query(
      "update task_center.task_claims set claimed_at = now() - interval '8 days' where drama_id = $1",
      [dramas[4]],
    );
    // A second code (tiktok) for Four's one claimant still counts them once, so Four does not tie Three.
    await claimTask(db, { userId: users[0]!, dramaId: dramas[3]!, channel: "tiktok" });
    expect(await hot()).toEqual([dramas[0], dramas[1], dramas[2]].sort());

    // A drama taken down drops out and the next one moves up.
    await setDramaStatus(db, dramas[0]!, "archived");
    expect(await hot()).toEqual([dramas[1], dramas[2], dramas[3]].sort());
  });

  it("sets a cover only on a drama that exists", async () => {
    const id = await createDrama(db, drama(), ADMIN);
    expect(await setDramaCover(db, id, "covers/a.jpg")).toBe(true);
    expect(await setDramaCover(db, USER_A, "covers/c.jpg")).toBe(false);
  });
});

describe("imports from 查剧", () => {
  const beidou = {
    title: "Surf God's Revenge",
    titleCn: "冲浪之神的复仇",
    platform: "reelshort",
    language: "en",
    episodes: 70,
    payStart: 8,
    synopsis: "He came back.",
    tags: ["Revenge", "Sports"],
    audience: "male",
    genre: "sports",
    finished: true,
    sourceDramaId: "68a1b2c3d4",
  } as const;

  it("lists a platform drama once: a second import gets the first one's id", async () => {
    const first = await importDrama(db, beidou, ADMIN);
    expect(first.ok).toBe(true);
    const id = first.id;
    expect(await importDrama(db, { ...beidou, title: "Surf God's Revenge (again)" }, ADMIN)).toEqual({
      ok: false,
      code: "already_listed",
      id,
    });

    const found = await getDramaForAdmin(db, id);
    expect(found?.drama).toMatchObject({
      status: "draft",
      source: "beidou",
      sourceDramaId: "68a1b2c3d4",
      tags: ["Revenge", "Sports"],
      audience: "male",
      genre: "sports",
      finished: true,
      episodes: 70,
      payStart: 8,
    });
    expect(await listedBySource(db, "reelshort", ["68a1b2c3d4", "nope"])).toEqual(new Map([["68a1b2c3d4", id]]));

    // A 剧库 row from 选剧台 does not say whether the drama is finished.
    const fromCatalog = await importDrama(db, { ...beidou, sourceDramaId: "6ae450d91cd653e9b90dcf54", finished: null }, ADMIN);
    expect(fromCatalog.ok).toBe(true);
    expect((await getDramaForAdmin(db, fromCatalog.ok ? fromCatalog.id : ""))?.drama.finished).toBeNull();
    expect(await listedBySource(db, "dramabox", ["68a1b2c3d4"])).toEqual(new Map());
    // The same platform id on another platform is another drama.
    expect((await importDrama(db, { ...beidou, platform: "dramabox" }, ADMIN)).ok).toBe(true);
  });

  it("lists a ReelShort drama once whichever of 北斗's ids found it", async () => {
    // 2026-11-08: 北斗 had two ids for this drama; ReelShort's page for either is the same drama.
    const row = (platformDramaId: string): LookupDrama => ({
      platformDramaId,
      title: "Lazos rotos de los hermanos fae",
      titleCn: null,
      exact: true,
      language: "es",
      listedOn: null,
      episodeCount: 54,
      payStart: 10,
      finished: true,
      description: null,
      tags: [],
      coverUrl: null,
    });
    const page: TheaterDetails = {
      platform: "reelshort",
      dramaId: "6ad88d9e996727b60c007958",
      title: "Lazos rotos de los hermanos fae",
      language: "es",
      episodes: 54,
      paid: true,
      payStart: 10,
      synopsis: "Traicionada por los príncipes fae.",
      tags: ["Inmortal", "Romance"],
      audience: "female",
      genre: "romance",
      coverUrl: null,
    };
    const query = { platform: "reelshort", language: null };
    const first = await importDrama(db, toImportedDrama(row("6ad88d9e996727b60c007958"), query, page)!, ADMIN);
    expect(first.ok).toBe(true);
    expect(await importDrama(db, toImportedDrama(row("6ad192a1f3d20df996045012"), query, page)!, ADMIN)).toEqual({
      ok: false,
      code: "already_listed",
      id: first.id,
    });
    expect((await getDramaForAdmin(db, first.id))?.drama).toMatchObject({
      sourceDramaId: "6ad88d9e996727b60c007958",
      tags: ["Inmortal", "Romance"],
      audience: "female",
      genre: "romance",
    });
  });

  it("lists a GoodShort drama once by 北斗's base64 id (0005)", async () => {
    // 2026-11-08: 北斗's GoodShort ids are base64; 0004 refused them.
    const goodShort = { ...beidou, platform: "goodshort", audience: null, genre: null, sourceDramaId: "9i/dssELM0MvEetSwJbzYw==" };
    const first = await importDrama(db, goodShort, ADMIN);
    expect(first.ok).toBe(true);
    expect(await importDrama(db, goodShort, ADMIN)).toEqual({ ok: false, code: "already_listed", id: first.id });
    expect(await listedBySource(db, "goodshort", ["9i/dssELM0MvEetSwJbzYw==", "9i/dssELM0MvEetSwJbzYw"])).toEqual(
      new Map([["9i/dssELM0MvEetSwJbzYw==", first.id]]),
    );
    expect((await getDramaForAdmin(db, first.id))?.drama).toMatchObject({ source: "beidou", sourceDramaId: "9i/dssELM0MvEetSwJbzYw==" });
    for (const bad of ["../etc", "a=b", "a b", "x".repeat(65)]) {
      await expect(importDrama(db, { ...goodShort, sourceDramaId: bad }, ADMIN)).rejects.toMatchObject({
        constraint: "dramas_source_drama_id_check",
      });
    }
  });

  it("keeps tags through an edit that leaves them out and replaces them when sent", async () => {
    const id = await createDrama(db, drama({ tags: ["Romance"] }), ADMIN);
    await updateDrama(db, id, drama({ title: "Renamed" }));
    expect((await getDramaForAdmin(db, id))?.drama.tags).toEqual(["Romance"]);
    await updateDrama(db, id, drama({ tags: ["CEO", "Revenge"] }));
    expect((await getDramaForAdmin(db, id))?.drama).toMatchObject({ title: "The Heiress Returns", tags: ["CEO", "Revenge"] });
  });

  it("refuses more than twenty tags and a source without its id", async () => {
    await expect(createDrama(db, drama({ tags: Array.from({ length: 21 }, (_, n) => `t${n}`) }), ADMIN)).rejects.toThrow();
    await expect(
      db.query(
        `insert into task_center.dramas (title, platform, language, source, created_by)
         values ('x', 'reelshort', 'en', 'beidou', $1)`,
        [ADMIN],
      ),
    ).rejects.toThrow(/dramas_source_has_id/);
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
        clipType: null,
        createdBy: ADMIN,
      }),
    ).toBe(true);
    expect(await getPublicAsset(db, assetId)).toBeNull();
    await markAssetReady(db, assetId);
    expect(await getPublicAsset(db, assetId)).toBeNull();
    await setDramaStatus(db, dramaId, "published");
    expect(await getPublicAsset(db, assetId)).toMatchObject({ kind: "video", byteSize: 52_000_000 });
    expect((await getPublishedDrama(db, dramaId))!.assets).toHaveLength(1);
    expect(await deleteAsset(db, assetId)).toEqual({
      objectKey: `dramas/${dramaId}/${assetId}.mp4`,
      posterKey: null,
    });
    expect(await deleteAsset(db, assetId)).toBeNull();
    // A completion that arrives after the delete has nothing to mark.
    expect(await markAssetReady(db, assetId)).toBeNull();
  });

  it("keeps a clip's still through a retried completion, retags it, and hands back both keys on delete", async () => {
    const dramaId = await publishedDrama();
    const id = await readyClip(dramaId, { clipType: "trailer" });
    const poster = `dramas/${dramaId}/posters/${id}.jpg`;
    expect(await markAssetReady(db, id, poster)).toEqual({ posterKey: poster });
    // A retry that could not send a still again leaves the first one, and says so.
    expect(await markAssetReady(db, id)).toEqual({ posterKey: poster });
    // Nothing but the clip's own still path can be recorded.
    await expect(markAssetReady(db, id, `dramas/${dramaId}/${id}.mp4`)).rejects.toThrow(/check/);
    expect(await getPublicAsset(db, id)).toMatchObject({ clipType: "trailer", posterKey: poster });

    expect(await updateAsset(db, id, { clipType: "mixcut" })).toBe(true);
    // A rename alone leaves the type; a retag alone leaves the title.
    expect(await updateAsset(db, id, { title: "Ep 1 hook" })).toBe(true);
    expect(await getPublicAsset(db, id)).toMatchObject({ clipType: "mixcut", title: "Ep 1 hook" });
    expect(await updateAsset(db, id, { clipType: null })).toBe(true);
    expect(await getPublicAsset(db, id)).toMatchObject({ clipType: null, title: "Ep 1 hook" });
    expect(await getPublicAsset(db, id)).toMatchObject({ clipType: null });
    expect(await updateAsset(db, USER_A, { clipType: "recap" })).toBe(false);
    await expect(
      db.query("update task_center.drama_assets set clip_type = 'vlog' where id = $1", [id]),
    ).rejects.toThrow(/check/);

    expect(await deleteAsset(db, id)).toEqual({ objectKey: expect.stringContaining(id), posterKey: poster });
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
        clipType: null,
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

  it("counts each followed code and opens its drama's page, even once the drama is taken down", async () => {
    const id = await publishedDrama({ promoCodeParam: "sub_id" });
    const claim = await claimTask(db, { userId: USER_A, dramaId: id, channel: "facebook" });
    if (!claim.ok) throw new Error("claim failed");
    const code = claim.claim.code;

    expect(await followPromoCode(db, code)).toEqual({ dramaId: id });
    await followPromoCode(db, code);
    expect(await followPromoCode(db, "zzzz9999")).toBeNull();

    // Taken down and its platform link cleared: a posted link still opens the page.
    await setDramaStatus(db, id, "archived");
    await updateDrama(db, id, drama({ promoTargetUrl: null }));
    expect(await followPromoCode(db, code)).toEqual({ dramaId: id });

    const mine = await listMyClaims(db, USER_A);
    expect(mine).toMatchObject([{ code, clicks: 3, dramaTitle: "The Heiress Returns", channel: "facebook" }]);
  });

  it("sends 去看全集 to the platform link, with the code only when it was claimed for that drama", async () => {
    const id = await publishedDrama({ promoCodeParam: "sub_id" });
    const other = await publishedDrama({ title: "Other" });
    const claim = await claimTask(db, { userId: USER_A, dramaId: id, channel: "all" });
    const elsewhere = await claimTask(db, { userId: USER_B, dramaId: other, channel: "all" });
    if (!claim.ok || !elsewhere.ok) throw new Error("claim failed");
    const code = claim.claim.code;

    const link = await getPlatformLink(db, id, code);
    expect(link).toEqual({ target: { targetUrl: "https://example.com/d/1?src=gg", codeParam: "sub_id" }, code });
    expect(promoRedirectUrl(link!.target, link!.code)).toBe(`https://example.com/d/1?src=gg&sub_id=${code}`);
    // A code claimed for another drama, an unknown one, or none: the link, no code.
    expect(await getPlatformLink(db, id, elsewhere.claim.code)).toMatchObject({ code: null });
    expect(await getPlatformLink(db, id, "zzzz9999")).toMatchObject({ code: null });
    expect(await getPlatformLink(db, id, null)).toMatchObject({ code: null });
    expect(promoRedirectUrl(link!.target, null)).toBe("https://example.com/d/1?src=gg");
    // A sub-channel value pasted into the stored link is replaced, or dropped without a code.
    const pasted = { targetUrl: "https://example.com/d/1?src=gg&sub_id=stale1&sub_id=stale2", codeParam: "sub_id" };
    expect(promoRedirectUrl(pasted, code)).toBe(`https://example.com/d/1?src=gg&sub_id=${code}`);
    expect(promoRedirectUrl(pasted, null)).toBe("https://example.com/d/1?src=gg");
    // A Location header must be ASCII, with or without a code parameter.
    expect(promoRedirectUrl({ targetUrl: "https://example.com/剧/1", codeParam: null }, code)).toBe(
      "https://example.com/%E5%89%A7/1",
    );
    // The hop to the platform records no promo click: /t/<code> already did.
    expect((await listMyClaims(db, USER_A))[0]?.clicks).toBe(0);

    // Taken down, the button still goes; without a platform link, or never listed, it has nowhere to go.
    await setDramaStatus(db, id, "archived");
    expect(await getPlatformLink(db, id, code)).toMatchObject({ code });
    await updateDrama(db, id, drama({ promoTargetUrl: null }));
    expect(await getPlatformLink(db, id, code)).toBeNull();
    const draft = await createDrama(db, drama({ title: "Draft" }), ADMIN);
    expect(await getPlatformLink(db, draft, null)).toBeNull();
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
