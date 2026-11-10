// @input  -- POST to ./route.ts with the admin check, 选剧台 lookup, theater page, dramas store and cover copy stubbed (toImportedDrama and pickMatch are the real ones)
// @output -- regression tests pinning that a drama typed by hand is matched by its exact title and filled from the theater's page in its own language, that a cover is copied only when the drama has none, that a near title, two same titles or a second listing of the drama change nothing, and that a platform 查剧 does not know is never looked up
// @pos    -- the boundary tests of 从官网补全资料; the SQL behind refillDrama is covered by task-center.integration.test.ts
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LookupDrama } from "../../../../../../../lib/task-center/drama-lookup.ts";
import type { DramaDetail } from "../../../../../../../lib/task-center/dramas-store.ts";
import type { TheaterDetails } from "../../../../../../../lib/task-center/theater-details.ts";

const readAdminMutation = vi.hoisted(() => vi.fn());
const lookupDramas = vi.hoisted(() => vi.fn());
const readLookupConfig = vi.hoisted(() => vi.fn());
const getDramaForAdmin = vi.hoisted(() => vi.fn());
const refillDrama = vi.hoisted(() => vi.fn());
const fetchTheaterDetails = vi.hoisted(() => vi.fn());
const copyCover = vi.hoisted(() => vi.fn());

vi.mock("../../../../../../../lib/task-center/route-http.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../../../lib/task-center/route-http.ts")>();
  return { ...actual, readAdminMutation };
});
vi.mock("../../../../../../../lib/task-center/drama-lookup.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../../../lib/task-center/drama-lookup.ts")>();
  return { ...actual, lookupDramas, readLookupConfig };
});
vi.mock("../../../../../../../lib/task-center/dramas-store.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../../../lib/task-center/dramas-store.ts")>();
  return { ...actual, getDramaForAdmin, refillDrama };
});
vi.mock("../../../../../../../lib/task-center/theater-details.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../../../lib/task-center/theater-details.ts")>();
  return { ...actual, fetchTheaterDetails };
});
vi.mock("../../../../../../../lib/task-center/drama-cover.ts", () => ({ copyCover }));

import { POST } from "./route.ts";

const DB = { query: vi.fn() };
const DRAMA_ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const OTHER_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const SOURCE_ID = "6ad4c0012ea7059aa9045e57";

/** Surf God's Revenge as it was typed by hand on 2026-11-06. */
const DRAMA: DramaDetail = {
  id: DRAMA_ID,
  title: "Surf God's Revenge",
  titleCn: null,
  platform: "reelshort",
  language: "en",
  episodes: 14,
  payStart: 14,
  coverKey: null,
  audience: null,
  genre: "male",
  tags: [],
  listedAt: "2026-11-06T08:00:00.000Z",
  promoterCount: 3,
  synopsis: null,
  finished: null,
  source: null,
  sourceDramaId: null,
  status: "published",
  promoTargetUrl: "https://www.reelshort.com/movie/x",
  promoCodeParam: "ref",
  createdAt: "2026-11-06T08:00:00.000Z",
  updatedAt: "2026-11-06T08:00:00.000Z",
};

const FOUND: LookupDrama = {
  platformDramaId: SOURCE_ID,
  title: "Surf God’s Revenge",
  titleCn: null,
  exact: true,
  language: "en",
  listedOn: null,
  episodeCount: 52,
  payStart: 15,
  finished: null,
  description: null,
  tags: [],
  coverUrl: "https://cdn.example.com/beidou.jpg",
};

const THEATER: TheaterDetails = {
  platform: "reelshort",
  dramaId: SOURCE_ID,
  title: "Surf God's Revenge",
  language: "en",
  episodes: 52,
  paid: true,
  payStart: 15,
  synopsis: "Duke Koa is secretly the God of the Island.",
  tags: ["Romance", "Toxic Romance"],
  audience: "male",
  genre: "romance",
  coverUrl: "https://v-img.crazymaplestudios.com/c.jpg",
};

function refill(id = DRAMA_ID): Promise<Response> {
  return POST(new Request(`https://gengrowth.ai/api/admin/tasks/dramas/${id}/refill`, { method: "POST", body: "{}" }), {
    params: Promise.resolve({ dramaId: id }),
  });
}

function admin(): void {
  readAdminMutation.mockResolvedValue({ ok: true, value: { email: "ops@example.com", body: {}, db: DB } });
  readLookupConfig.mockReturnValue({ url: "http://pick", token: "t" });
}

afterEach(() => {
  for (const mock of [readAdminMutation, lookupDramas, readLookupConfig, getDramaForAdmin, refillDrama, fetchTheaterDetails, copyCover]) {
    mock.mockReset();
  }
});

describe("POST /api/admin/tasks/dramas/<id>/refill", () => {
  it("matches a drama typed by hand by its title and fills it from the theater's page", async () => {
    admin();
    getDramaForAdmin.mockResolvedValue({ drama: DRAMA, assets: [] });
    lookupDramas.mockResolvedValue({ ok: true, dramas: [{ ...FOUND, platformDramaId: "6ad4c0012ea7059aa9045e99", title: "Surf God's Revenge 2" }, FOUND] });
    fetchTheaterDetails.mockResolvedValue(THEATER);
    refillDrama.mockResolvedValue({ ok: true });
    copyCover.mockResolvedValue("saved");

    const response = await refill();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { details: "official", cover: "saved" } });
    expect(lookupDramas).toHaveBeenCalledWith(expect.anything(), { platform: "reelshort", title: "Surf God's Revenge", language: "en" });
    expect(fetchTheaterDetails).toHaveBeenCalledWith("reelshort", SOURCE_ID, fetch, expect.any(Number));
    expect(refillDrama).toHaveBeenCalledWith(DB, DRAMA_ID, {
      title: "Surf God's Revenge",
      titleCn: null,
      platform: "reelshort",
      language: "en",
      episodes: 52,
      payStart: 15,
      synopsis: "Duke Koa is secretly the God of the Island.",
      tags: ["Romance", "Toxic Romance"],
      audience: "male",
      genre: "romance",
      finished: null,
      sourceDramaId: SOURCE_ID,
    });
    expect(copyCover).toHaveBeenCalledWith(DB, DRAMA_ID, THEATER.coverUrl, expect.any(Number));
  });

  it("keeps a cover the drama already has and says so", async () => {
    admin();
    getDramaForAdmin.mockResolvedValue({ drama: { ...DRAMA, coverKey: "dramas/x/covers/a.jpg" }, assets: [] });
    lookupDramas.mockResolvedValue({ ok: true, dramas: [FOUND] });
    fetchTheaterDetails.mockResolvedValue(null);
    refillDrama.mockResolvedValue({ ok: true });

    const response = await refill();

    expect(await response.json()).toEqual({ data: { details: "beidou", cover: "kept" } });
    expect(copyCover).not.toHaveBeenCalled();
  });

  it("matches a drama from 查剧 by its platform id, not its title", async () => {
    admin();
    getDramaForAdmin.mockResolvedValue({
      drama: { ...DRAMA, title: "Renamed by hand", source: "beidou", sourceDramaId: SOURCE_ID },
      assets: [],
    });
    lookupDramas.mockResolvedValue({ ok: true, dramas: [FOUND] });
    fetchTheaterDetails.mockResolvedValue(THEATER);
    refillDrama.mockResolvedValue({ ok: true });
    copyCover.mockResolvedValue("saved");

    expect((await refill()).status).toBe(200);
    expect(refillDrama).toHaveBeenCalledWith(DB, DRAMA_ID, expect.objectContaining({ sourceDramaId: SOURCE_ID }));
  });

  it("changes nothing for a near title, even when it is the only result", async () => {
    admin();
    getDramaForAdmin.mockResolvedValue({ drama: DRAMA, assets: [] });
    lookupDramas.mockResolvedValue({ ok: true, dramas: [{ ...FOUND, title: "Surf God's Revenge 2" }] });

    const response = await refill();

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "lookup_not_found" } });
    expect(fetchTheaterDetails).not.toHaveBeenCalled();
    expect(refillDrama).not.toHaveBeenCalled();
  });

  it("changes nothing when two dramas share the title", async () => {
    admin();
    getDramaForAdmin.mockResolvedValue({ drama: DRAMA, assets: [] });
    lookupDramas.mockResolvedValue({ ok: true, dramas: [FOUND, { ...FOUND, platformDramaId: "6ad4c0012ea7059aa9045e99" }] });

    const response = await refill();

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "lookup_ambiguous" } });
    expect(refillDrama).not.toHaveBeenCalled();
  });

  it("names the other drama when this one is a second listing of it, and copies no cover", async () => {
    admin();
    getDramaForAdmin.mockResolvedValue({ drama: DRAMA, assets: [] });
    lookupDramas.mockResolvedValue({ ok: true, dramas: [FOUND] });
    fetchTheaterDetails.mockResolvedValue(THEATER);
    refillDrama.mockResolvedValue({ ok: false, code: "already_listed", id: OTHER_ID });

    const response = await refill();

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "already_listed", id: OTHER_ID } });
    expect(copyCover).not.toHaveBeenCalled();
  });

  it("never looks up a platform 查剧 does not know, or a drama that is not there", async () => {
    admin();
    getDramaForAdmin.mockResolvedValue({ drama: { ...DRAMA, platform: "some-app" }, assets: [] });
    expect((await refill()).status).toBe(422);

    getDramaForAdmin.mockResolvedValue(null);
    expect((await refill()).status).toBe(404);
    expect((await refill("not-a-uuid")).status).toBe(404);
    expect(lookupDramas).not.toHaveBeenCalled();
  });

  it("answers for the admin check when it refuses", async () => {
    readAdminMutation.mockResolvedValue({ ok: false, response: new Response(null, { status: 404 }) });

    expect((await refill()).status).toBe(404);
    expect(getDramaForAdmin).not.toHaveBeenCalled();
  });
});
