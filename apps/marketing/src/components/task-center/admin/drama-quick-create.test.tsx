// @vitest-environment jsdom
// @input  -- drama-quick-create.tsx with adminFetch and the router faked
// @output -- proof that a miss is turned into the right next step (switch to the platform 选剧台's 剧库 has the drama on, or the hand form filled from the 剧库), and that the waiting note says 剧库 or 北斗 honestly
// @pos    -- unit tests for the 查剧 panel on /admin/tasks; no network
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: unknown[] = [];
const answers: unknown[] = [];

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./admin-fetch.ts", () => ({
  adminFetch: async (_path: string, _method: string, body: unknown) => {
    calls.push(body);
    return answers.shift();
  },
  describeError: () => "出错了",
}));

const { DramaQuickCreate, missed, waitingNote } = await import("./drama-quick-create.tsx");

const ASCENT = "The Ascent: Formative Years Season 2";
const FLICK = {
  platform: "flickreels",
  title: ASCENT,
  titleCn: "龙抬头2：一骑绝尘",
  language: "en",
  episodes: null,
  payStart: null,
};
const QUERY = { title: ASCENT, platform: "reelshort", language: null };

describe("missed", () => {
  it("offers the platform the 剧库 has the drama on, once per platform and language", () => {
    const step = missed(QUERY, [FLICK, { ...FLICK }, { ...FLICK, platform: "kalostv", language: "es", titleCn: null }]);
    expect(step).toMatchObject({ kind: "manual", query: QUERY });
    if (step.kind !== "manual") throw new Error(step.kind);
    expect(step.elsewhere?.map((hint) => `${hint.platform}|${hint.language}`)).toEqual(["flickreels|en", "kalostv|es"]);
    expect(step.why).toContain("FlickReels、KalosTV 有同名的剧");
    expect(step.prefill).toBeUndefined();
  });

  it("fills the hand form from the 剧库 when it has the drama on this very platform", () => {
    const step = missed({ ...QUERY, platform: "flickreels" }, [FLICK, { ...FLICK, platform: "dramabox" }]);
    if (step.kind !== "manual") throw new Error(step.kind);
    expect(step.prefill).toEqual({ title: ASCENT, titleCn: "龙抬头2：一骑绝尘", language: "en" });
    expect(step.elsewhere).toBeUndefined();
    expect(step.why).toContain("剧名、中文名和语种已按剧库填好");
  });

  it("does not fill in a 剧库 row in another language than the one asked for", () => {
    const step = missed({ ...QUERY, platform: "flickreels", language: "es" }, [FLICK]);
    if (step.kind !== "manual") throw new Error(step.kind);
    expect(step.prefill).toBeUndefined();
    expect(step.why).toBe(`选剧台在 FlickReels 没查到「${ASCENT}」，请手填。`);
  });

  it("keeps the old note when the 剧库 has nothing either", () => {
    expect(missed(QUERY, [])).toEqual({ kind: "manual", query: QUERY, why: `选剧台在 ReelShort 没查到「${ASCENT}」，请手填。` });
  });
});

describe("waitingNote", () => {
  it("says 剧库 first for the four 剧库-first platforms, then 北斗 once it is slow", () => {
    expect(waitingNote("reelshort", false)).toBe("正在查选剧台的剧库，一般一两秒。");
    expect(waitingNote("netshort", true)).toContain("转去问北斗");
  });

  it("says 北斗 straight away for the others", () => {
    expect(waitingNote("flickreels", false)).toContain("正在通过选剧台问北斗");
    expect(waitingNote("dramabox", true)).toContain("正在通过选剧台问北斗");
  });
});

describe("DramaQuickCreate", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    calls.length = 0;
    answers.length = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function field(name: string): HTMLInputElement | HTMLSelectElement {
    const found = host.querySelectorAll<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
    return found[found.length - 1] as HTMLInputElement | HTMLSelectElement;
  }

  it("switches a miss on ReelShort to FlickReels and fills the form from the 剧库 there", async () => {
    act(() => root.render(<DramaQuickCreate adminBase="/zh/admin/tasks" />));
    const title = host.querySelector<HTMLInputElement>('input[name="title"]');
    if (title === null) throw new Error("no title");
    title.value = ASCENT;

    answers.push({ ok: true, status: 200, data: { configured: true, dramas: [], inCatalog: [FLICK] } });
    await act(async () => {
      host.querySelector("form")?.requestSubmit();
    });
    expect(calls).toEqual([QUERY]);
    const switchButton = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("换成 FlickReels 查"));
    expect(switchButton?.textContent).toBe("换成 FlickReels 查（英语） · 龙抬头2：一骑绝尘");

    answers.push({ ok: true, status: 200, data: { configured: true, dramas: [], inCatalog: [FLICK] } });
    await act(async () => {
      switchButton?.click();
    });
    expect(calls[1]).toEqual({ ...QUERY, platform: "flickreels" });
    expect((host.querySelector('select[name="platform"]') as HTMLSelectElement).value).toBe("flickreels");
    expect(host.textContent).toContain("剧名、中文名和语种已按剧库填好");
    expect(field("titleCn").value).toBe("龙抬头2：一骑绝尘");
    expect(field("language").value).toBe("en");
  });
});
