// @input  -- GET from ./route.ts with followPromoCode, getPlatformLink and getTaskDb stubbed (promoRedirectUrl is the real one)
// @output -- regression tests pinning the one recorded click, the 302 straight to the platform with the code in its sub-channel parameter, the fallback to the drama's page on our site when there is no platform link, 404 for an unknown or malformed code, and 503 (never 404) when the task database is missing or failing
// @pos    -- the boundary tests of the 资源推广链接 route; the SQL behind followPromoCode and getPlatformLink is covered by task-center.integration.test.ts
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { afterEach, describe, expect, it, vi } from "vitest";

const followPromoCode = vi.hoisted(() => vi.fn());
const getPlatformLink = vi.hoisted(() => vi.fn());
const getTaskDb = vi.hoisted(() => vi.fn());

vi.mock("../../../../lib/task-center/claims-store.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/task-center/claims-store.ts")>();
  return { ...actual, followPromoCode, getPlatformLink };
});

vi.mock("../../../../lib/task-center/db.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/task-center/db.ts")>();
  return { ...actual, getTaskDb };
});

import { GET } from "./route.ts";

const DB = { query: vi.fn() };
const DRAMA_ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

function follow(code: string): Promise<Response> {
  return GET(new Request(`https://gengrowth.ai/t/${code}/go`), { params: Promise.resolve({ code }) });
}

afterEach(() => {
  followPromoCode.mockReset();
  getPlatformLink.mockReset();
  getTaskDb.mockReset();
  vi.restoreAllMocks();
});

describe("GET /t/<code>/go", () => {
  it("records one click and sends the reader straight to the drama on its platform, with the code", async () => {
    getTaskDb.mockReturnValue(DB);
    followPromoCode.mockResolvedValue({ dramaId: DRAMA_ID });
    getPlatformLink.mockResolvedValue({
      target: { targetUrl: "https://www.reelshort.com/episodes/abc?sub=old", codeParam: "sub" },
      code: "k7m2xq9p",
    });

    const response = await follow(" K7M2XQ9P ");

    expect(followPromoCode).toHaveBeenCalledExactlyOnceWith(DB, "k7m2xq9p");
    expect(getPlatformLink).toHaveBeenCalledExactlyOnceWith(DB, DRAMA_ID, "k7m2xq9p");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://www.reelshort.com/episodes/abc?sub=k7m2xq9p");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("goes to the platform link as stored when the platform takes no sub-channel parameter", async () => {
    getTaskDb.mockReturnValue(DB);
    followPromoCode.mockResolvedValue({ dramaId: DRAMA_ID });
    getPlatformLink.mockResolvedValue({
      target: { targetUrl: "https://reelslink.com/cps/lxfqPt", codeParam: null },
      code: "k7m2xq9p",
    });

    const response = await follow("k7m2xq9p");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://reelslink.com/cps/lxfqPt");
  });

  it("sends the reader to the drama's page on our site while the drama has no platform link", async () => {
    getTaskDb.mockReturnValue(DB);
    followPromoCode.mockResolvedValue({ dramaId: DRAMA_ID });
    getPlatformLink.mockResolvedValue(null);

    const response = await follow("k7m2xq9p");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`/watch/${DRAMA_ID}?ref=k7m2xq9p`);
  });

  it("answers 404 for a code nobody claimed, and for one that cannot be a code without asking the database", async () => {
    getTaskDb.mockReturnValue(DB);
    followPromoCode.mockResolvedValue(null);

    expect((await follow("k7m2xq9p")).status).toBe(404);
    expect((await follow("..%2Fadmin")).status).toBe(404);
    expect(followPromoCode).toHaveBeenCalledTimes(1);
    expect(getPlatformLink).not.toHaveBeenCalled();
  });

  it("answers 503, never 404, when the task database is missing or failing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getTaskDb.mockReturnValue(null);
    expect((await follow("k7m2xq9p")).status).toBe(503);
    expect(followPromoCode).not.toHaveBeenCalled();

    getTaskDb.mockReturnValue(DB);
    followPromoCode.mockResolvedValue({ dramaId: DRAMA_ID });
    getPlatformLink.mockRejectedValue(new Error("connection terminated"));
    const response = await follow("k7m2xq9p");
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
