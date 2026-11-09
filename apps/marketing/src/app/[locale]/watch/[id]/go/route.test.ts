// @input  -- GET from ./route.ts with getPlatformLink and getTaskDb stubbed
// @output -- regression tests pinning the 302 to the platform link (code added only when the store vouches for it), the way back to the drama's page in the reader's language when there is no platform link, 404 for a malformed id, and 503 when the task database is missing or failing
// @pos    -- the boundary tests of the 去看全集 hop; the SQL behind getPlatformLink is covered by task-center.integration.test.ts
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { afterEach, describe, expect, it, vi } from "vitest";

const getPlatformLink = vi.hoisted(() => vi.fn());
const getTaskDb = vi.hoisted(() => vi.fn());

vi.mock("../../../../../lib/task-center/claims-store.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/task-center/claims-store.ts")>();
  return { ...actual, getPlatformLink };
});

vi.mock("../../../../../lib/task-center/db.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/task-center/db.ts")>();
  return { ...actual, getTaskDb };
});

import { GET } from "./route.ts";

const DB = { query: vi.fn() };
const DRAMA_ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const TARGET = { targetUrl: "https://example.com/d/1?src=gg", codeParam: "sub_id" } as const;

function go(id: string, query = "", locale = "en"): Promise<Response> {
  return GET(new Request(`https://gengrowth.ai/watch/${id}/go${query}`), {
    params: Promise.resolve({ locale, id }),
  });
}

afterEach(() => {
  getPlatformLink.mockReset();
  getTaskDb.mockReset();
  vi.restoreAllMocks();
});

describe("GET /watch/<id>/go", () => {
  it("sends the reader to the platform link, with the code the store vouched for", async () => {
    getTaskDb.mockReturnValue(DB);
    getPlatformLink.mockResolvedValue({ target: TARGET, code: "k7m2xq9p" });

    const response = await go(DRAMA_ID, "?ref=K7M2XQ9P");

    expect(getPlatformLink).toHaveBeenCalledExactlyOnceWith(DB, DRAMA_ID, "k7m2xq9p");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/d/1?src=gg&sub_id=k7m2xq9p");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("asks without a code when the ref is missing or cannot be one, and adds none the store did not return", async () => {
    getTaskDb.mockReturnValue(DB);
    getPlatformLink.mockResolvedValue({ target: TARGET, code: null });

    expect((await go(DRAMA_ID)).headers.get("location")).toBe("https://example.com/d/1?src=gg");
    await go(DRAMA_ID, "?ref=..%2Fadmin");
    expect(getPlatformLink.mock.calls).toEqual([
      [DB, DRAMA_ID, null],
      [DB, DRAMA_ID, null],
    ]);
  });

  it("goes back to the drama's page, in the reader's language, when there is no platform link", async () => {
    getTaskDb.mockReturnValue(DB);
    getPlatformLink.mockResolvedValue(null);

    expect((await go(DRAMA_ID, "?ref=k7m2xq9p")).headers.get("location")).toBe(`/watch/${DRAMA_ID}`);
    expect((await go(DRAMA_ID, "", "zh")).headers.get("location")).toBe(`/zh/watch/${DRAMA_ID}`);
    // Not a locale we serve: never echoed into the Location.
    expect((await go(DRAMA_ID, "", "evil.example")).headers.get("location")).toBe(`/watch/${DRAMA_ID}`);
  });

  it("answers 404 for an id that cannot be a drama, without asking the database", async () => {
    getTaskDb.mockReturnValue(DB);
    expect((await go("not-a-uuid")).status).toBe(404);
    expect(getPlatformLink).not.toHaveBeenCalled();
  });

  it("answers 503 when the task database is missing or failing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getTaskDb.mockReturnValue(null);
    expect((await go(DRAMA_ID)).status).toBe(503);
    expect(getPlatformLink).not.toHaveBeenCalled();

    getTaskDb.mockReturnValue(DB);
    getPlatformLink.mockRejectedValue(new Error("connection terminated"));
    const response = await go(DRAMA_ID);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
