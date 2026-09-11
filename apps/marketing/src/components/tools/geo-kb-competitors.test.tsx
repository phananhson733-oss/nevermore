// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import type { GeoGenerationInputV3 } from "../../lib/geo-tools/kb-v3-contract.ts";
import { V3_KB_ID } from "../../lib/geo-tools/kb-v3.test-fixtures.ts";
import { GeoKbCompetitors, type GeoKbCompetitorsProps } from "./geo-kb-competitors.tsx";

const ENDPOINT = "/api/tools/geo-knowledge-base/v3/competitors";
const NOW = "2026-09-11T08:00:00.000Z";
const copy = (locale: string) => (locale === "zh" ? zh : en).tools.geoKnowledgeBase.card.competitors;

const ROWS: GeoGenerationInputV3["competitors"] = [
  { domain: "astro.example", brandName: "", confirmed: false },
  { domain: "rival.example", brandName: "Rival", confirmed: true, aliases: ["Rival Inc"] },
  { domain: "", brandName: "Named Only", confirmed: false },
];

const IDENTITY = {
  status: "available", domain: "astro.example", brandName: "Astro", aliases: ["Astro Charts"],
  method: "json_ld", sourceUrl: "https://astro.example/", observedAt: NOW, cached: false,
};

function saved(competitors: GeoGenerationInputV3["competitors"], extra: Record<string, unknown> = {}) {
  return { kbId: V3_KB_ID, draftVersion: 5, contentHash: "d".repeat(64), updatedAt: NOW, generationInputHash: "e".repeat(64), competitors, released: [], changed: true, ...extra };
}

type Reply = (body: Record<string, unknown>) => Response | Promise<Response>;
/** The lookup goes to the route; the write goes to the editor hook, which the parent hands down. */
let reply: Reply;
let write: ReturnType<typeof vi.fn>;
let host: HTMLDivElement, root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  reply = () => Response.json({ error: { code: "not_found" } }, { status: 404 });
  write = vi.fn(async () => ({ ok: false, code: "not_found" }));
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init: RequestInit) => {
    if (String(url) !== ENDPOINT) throw new Error(`unexpected ${String(url)}`);
    return reply(JSON.parse(String(init.body)) as Record<string, unknown>);
  }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(locale = "en", overrides: Partial<GeoKbCompetitorsProps> = {}) {
  const props: GeoKbCompetitorsProps = {
    kbId: V3_KB_ID, competitors: ROWS, disabled: false,
    write: write as unknown as GeoKbCompetitorsProps["write"], ...overrides,
  };
  await act(async () => root.render(
    <NextIntlClientProvider locale={locale} timeZone="UTC" messages={locale === "zh" ? zh : en}>
      <GeoKbCompetitors {...props} />
    </NextIntlClientProvider>,
  ));
}

const rows = () => [...host.querySelectorAll<HTMLElement>("[data-geo-kb-competitor]")];
const row = (domain: string) => host.querySelector<HTMLElement>(`[data-geo-kb-competitor][data-domain="${domain}"]`)!;
const action = (element: HTMLElement, kind: string) => element.querySelector<HTMLButtonElement>(`[data-competitor-action="${kind}"]`);
const actions = (element: HTMLElement) => [...element.querySelectorAll<HTMLButtonElement>("[data-competitor-action]")].map((button) => button.dataset["competitorAction"]);
const calls = () => (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
const bodyOf = (index: number) => JSON.parse(String((calls()[index]![1] as RequestInit).body));
const gestures = () => write.mock.calls.map((call) => call[0]);
async function click(button: HTMLButtonElement | null) {
  if (button === null) throw new Error("no such button");
  await act(async () => button.click());
}
async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("draws one row per rival in the card's own row shape, with the state each one is in", async () => {
  await render("zh");
  expect(rows().map((element) => element.dataset["domain"])).toEqual(["astro.example", "rival.example", ""]);
  expect(rows().map((element) => element.dataset["confirmed"])).toEqual(["false", "true", "false"]);
  // The type chip and the state chip use the same tinted chip every other row on the card uses.
  expect(row("astro.example").querySelector("[data-item-type][data-chip-tone='label']")?.textContent).toBe(copy("zh").typeLabel);
  expect(row("astro.example").querySelector("[data-competitor-chip]")?.textContent).toBe(copy("zh").unconfirmed);
  expect(row("rival.example").querySelector("[data-competitor-chip]")?.textContent).toBe(copy("zh").confirmed);
  expect(row("astro.example").querySelector("[data-competitor-name]")?.textContent).toBe(copy("zh").unnamed);
  expect(row("rival.example").querySelector("[data-competitor-name]")?.textContent).toBe("Rival");
  expect(row("rival.example").querySelector("[data-competitor-aliases]")?.textContent).toBe(copy("zh").aliases.replace("{aliases}", "Rival Inc"));
  expect(row("astro.example").querySelector("[data-competitor-source]")?.textContent).toBe(`astro.example · ${copy("zh").fromProfile}`);
});

it("offers lookup and confirm on an unconfirmed rival, rename and withdraw on a confirmed one, nothing on a rival with no page", async () => {
  await render();
  expect(actions(row("astro.example"))).toEqual(["lookup", "confirm"]);
  expect(actions(row("rival.example"))).toEqual(["rename", "unconfirm"]);
  expect(actions(row(""))).toEqual([]);
  expect(row("").querySelector("[data-competitor-source]")?.textContent).toBe(copy("en").noDomain);
});

it("counts the confirmed rivals in the section line and says when the Profile names none", async () => {
  await render("zh");
  expect(host.querySelector("[data-kb-section='competitors'] [data-kb-section-items]")?.textContent).toBe(copy("zh").items.replace("{confirmed}", "1").replace("{total}", "3"));
  await render("zh", { competitors: [] });
  expect(rows()).toHaveLength(0);
  expect(host.querySelector("[data-competitors-empty]")?.textContent).toBe(copy("zh").empty);
});

it("looks a rival up and proposes the name its homepage declares, then confirms exactly that", async () => {
  reply = () => Response.json({ data: { kbId: V3_KB_ID, identity: IDENTITY } });
  write.mockResolvedValue({ ok: true, saved: saved([{ domain: "astro.example", brandName: "Astro", confirmed: true, aliases: ["Astro Charts"] }, ROWS[1]!, ROWS[2]!]) });
  await render("zh");
  await click(action(row("astro.example"), "lookup"));
  expect(bodyOf(0)).toEqual({ kbId: V3_KB_ID, intent: "identify", domain: "astro.example" });
  expect(row("astro.example").querySelector("[data-competitor-name]")?.textContent).toBe("Astro");
  expect(row("astro.example").querySelector("[data-competitor-aliases]")?.textContent).toBe(copy("zh").aliases.replace("{aliases}", "Astro Charts"));
  expect(row("astro.example").querySelector("[data-competitor-source]")?.textContent)
    .toBe(`astro.example · ${copy("zh").readFrom.replace("{url}", "https://astro.example/")} · ${copy("zh").method.json_ld}`);
  // Still unconfirmed: a lookup is a proposal, and only the gesture below writes.
  expect(row("astro.example").dataset["confirmed"]).toBe("false");
  await click(action(row("astro.example"), "confirm"));
  expect(gestures()).toEqual([{ kind: "confirm", domain: "astro.example", brandName: "Astro", aliases: ["Astro Charts"] }]);
  // The lookup went to the route exactly once; the write never did, it went to the hook.
  expect(calls()).toHaveLength(1);
});

it("asks for a name before confirming a rival nobody has named, and refuses an empty one without a request", async () => {
  write.mockResolvedValue({ ok: true, saved: saved([{ domain: "astro.example", brandName: "Astro Seek", confirmed: true }, ROWS[1]!, ROWS[2]!]) });
  await render("zh");
  await click(action(row("astro.example"), "confirm"));
  expect(write).not.toHaveBeenCalled();
  const input = row("astro.example").querySelector<HTMLInputElement>("input[data-competitor-name-input]")!;
  expect(input.value).toBe("");
  await click(action(row("astro.example"), "save"));
  expect(write).not.toHaveBeenCalled();
  expect(row("astro.example").querySelector("[data-competitor-error]")?.textContent).toBe(copy("zh").nameRequired);
  await type(input, "  Astro Seek ");
  await click(action(row("astro.example"), "save"));
  expect(gestures()).toEqual([{ kind: "confirm", domain: "astro.example", brandName: "Astro Seek", aliases: [] }]);
  expect(row("astro.example").querySelector("input[data-competitor-name-input]")).toBeNull();
});

it("renames a confirmed rival under its existing aliases, and cancel closes the field without writing", async () => {
  write.mockResolvedValue({ ok: true, saved: saved([ROWS[0]!, { domain: "rival.example", brandName: "Rival Ltd", confirmed: true, aliases: ["Rival Inc"] }, ROWS[2]!]) });
  await render();
  await click(action(row("rival.example"), "rename"));
  const input = row("rival.example").querySelector<HTMLInputElement>("input[data-competitor-name-input]")!;
  expect(input.value).toBe("Rival");
  await click(action(row("rival.example"), "cancel"));
  expect(row("rival.example").querySelector("input[data-competitor-name-input]")).toBeNull();
  expect(write).not.toHaveBeenCalled();
  await click(action(row("rival.example"), "rename"));
  await type(row("rival.example").querySelector<HTMLInputElement>("input[data-competitor-name-input]")!, "Rival Ltd");
  await click(action(row("rival.example"), "save"));
  expect(gestures()).toEqual([{ kind: "confirm", domain: "rival.example", brandName: "Rival Ltd", aliases: ["Rival Inc"] }]);
});

it("withdraws a confirmation", async () => {
  write.mockResolvedValue({ ok: true, saved: saved([ROWS[0]!, { domain: "rival.example", brandName: "Rival", confirmed: false, aliases: ["Rival Inc"] }, ROWS[2]!]) });
  await render();
  await click(action(row("rival.example"), "unconfirm"));
  expect(gestures()).toEqual([{ kind: "unconfirm", domain: "rival.example" }]);
});

/**
 * A row's source line says where the name ON THE ROW came from, and for a
 * confirmed row that is the owner: they pressed confirm, whether they took a
 * proposal, edited it or typed the name. It never says "from the Profile" of
 * a name the Profile never held, and never keeps crediting a homepage for a
 * name the owner has since replaced.
 */
it("credits a confirmed name to the owner, whatever a lookup once proposed", async () => {
  reply = () => Response.json({ data: { kbId: V3_KB_ID, identity: IDENTITY } });
  write.mockResolvedValue({ ok: true, saved: saved([{ domain: "astro.example", brandName: "Astro Seek", confirmed: true }, ROWS[1]!, ROWS[2]!]) });
  await render("zh");
  expect(row("rival.example").querySelector("[data-competitor-source]")?.textContent).toBe(`rival.example · ${copy("zh").ownerConfirmed}`);
  await click(action(row("astro.example"), "lookup"));
  await click(action(row("astro.example"), "confirm"));
  // The parent redraws the row confirmed under a different name than the lookup proposed.
  await render("zh", { competitors: [{ domain: "astro.example", brandName: "Astro Seek", confirmed: true }, ROWS[1]!, ROWS[2]!] });
  expect(row("astro.example").querySelector("[data-competitor-name]")?.textContent).toBe("Astro Seek");
  expect(row("astro.example").querySelector("[data-competitor-source]")?.textContent).toBe(`astro.example · ${copy("zh").ownerConfirmed}`);
  expect(row("astro.example").querySelector("[data-competitor-aliases]")).toBeNull();
});

/**
 * A proposal is superseded by the write that followed it. Withdrawing a
 * confirmation shows the stored name -- the one the owner last wrote -- not
 * the proposal from before it; confirming again writes that stored name.
 */
it("forgets a lookup's proposal once a write has superseded it", async () => {
  reply = () => Response.json({ data: { kbId: V3_KB_ID, identity: IDENTITY } });
  const renamed = { domain: "astro.example", brandName: "Beta", confirmed: true, aliases: ["Astro Charts"] };
  write.mockResolvedValueOnce({ ok: true, saved: saved([renamed, ROWS[1]!, ROWS[2]!]) });
  await render("zh");
  await click(action(row("astro.example"), "lookup"));
  await click(action(row("astro.example"), "confirm"));
  await render("zh", { competitors: [renamed, ROWS[1]!, ROWS[2]!] });
  const withdrawn = { ...renamed, confirmed: false };
  write.mockResolvedValueOnce({ ok: true, saved: saved([withdrawn, ROWS[1]!, ROWS[2]!]) });
  await click(action(row("astro.example"), "unconfirm"));
  await render("zh", { competitors: [withdrawn, ROWS[1]!, ROWS[2]!] });
  expect(row("astro.example").querySelector("[data-competitor-name]")?.textContent).toBe("Beta");
  expect(row("astro.example").querySelector("[data-competitor-source]")?.textContent).toBe(`astro.example · ${copy("zh").fromProfile}`);
  write.mockResolvedValueOnce({ ok: true, saved: saved([renamed, ROWS[1]!, ROWS[2]!]) });
  await click(action(row("astro.example"), "confirm"));
  expect(gestures()[2]).toEqual({ kind: "confirm", domain: "astro.example", brandName: "Beta", aliases: ["Astro Charts"] });
});

it("locks the name field while its write is out, so nothing typed meanwhile is silently dropped", async () => {
  let release: (result: unknown) => void = () => undefined;
  write.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
  await render();
  await click(action(row("rival.example"), "rename"));
  await type(row("rival.example").querySelector<HTMLInputElement>("input[data-competitor-name-input]")!, "Beta");
  await click(action(row("rival.example"), "save"));
  expect(row("rival.example").querySelector<HTMLInputElement>("input[data-competitor-name-input]")?.disabled).toBe(true);
  await act(async () => { release({ ok: true, saved: saved([ROWS[0]!, { domain: "rival.example", brandName: "Beta", confirmed: true }, ROWS[2]!]) }); });
  expect(row("rival.example").querySelector("input[data-competitor-name-input]")).toBeNull();
});

/** The hook may decline to attempt the write at all; that is not a failure to show. */
it("shows nothing and keeps the field when the hook did not attempt the write", async () => {
  write.mockResolvedValueOnce(null);
  await render();
  await click(action(row("rival.example"), "rename"));
  await click(action(row("rival.example"), "save"));
  expect(row("rival.example").querySelector("[data-competitor-error]")).toBeNull();
  expect(row("rival.example").querySelector("input[data-competitor-name-input]")).not.toBeNull();
});

it("says why a lookup could not name the rival, and still lets the owner type a name", async () => {
  reply = () => Response.json({ data: { kbId: V3_KB_ID, identity: { status: "unavailable", domain: "astro.example", reason: "blocked" } } });
  await render("zh");
  await click(action(row("astro.example"), "lookup"));
  expect(row("astro.example").querySelector("[data-competitor-source]")?.textContent)
    .toBe(`astro.example · ${copy("zh").lookupFailed.replace("{reason}", copy("zh").reasons.blocked)}`);
  expect(row("astro.example").querySelector("[data-competitor-name]")?.textContent).toBe(copy("zh").unnamed);
  await click(action(row("astro.example"), "confirm"));
  expect(row("astro.example").querySelector("input[data-competitor-name-input]")).not.toBeNull();
});

it("renders a reason this build has no word for as the generic one rather than the code", async () => {
  reply = () => Response.json({ data: { kbId: V3_KB_ID, identity: { status: "unavailable", domain: "astro.example", reason: "moon_phase" } } });
  await render("zh");
  await click(action(row("astro.example"), "lookup"));
  const source = row("astro.example").querySelector("[data-competitor-source]")?.textContent ?? "";
  expect(source).toContain(copy("zh").reasons.unknown);
  expect(source).not.toContain("moon_phase");
});

it("reports the server's refusal in the owner's words", async () => {
  write.mockResolvedValueOnce({ ok: false, code: "conflict", draftVersion: 9 });
  await render("zh");
  await click(action(row("rival.example"), "unconfirm"));
  expect(row("rival.example").querySelector("[data-competitor-error]")?.textContent).toBe(copy("zh").failed.conflict);
  expect(row("rival.example").querySelector("[data-competitor-error]")?.getAttribute("role")).toBe("alert");
});

it("holds every gesture while one is in flight, and all of them while the card says so", async () => {
  let release: (response: Response) => void = () => undefined;
  reply = () => new Promise<Response>((resolve) => { release = resolve; });
  await render();
  await click(action(row("astro.example"), "lookup"));
  expect([...host.querySelectorAll<HTMLButtonElement>("[data-competitor-action]")].every((button) => button.disabled)).toBe(true);
  expect(action(row("astro.example"), "lookup")?.textContent).toBe(copy("en").lookupBusy);
  await act(async () => { release(Response.json({ data: { kbId: V3_KB_ID, identity: IDENTITY } })); });
  expect([...host.querySelectorAll<HTMLButtonElement>("[data-competitor-action]")].some((button) => !button.disabled)).toBe(true);
  await render("en", { disabled: true });
  expect([...host.querySelectorAll<HTMLButtonElement>("[data-competitor-action]")].every((button) => button.disabled)).toBe(true);
});

/**
 * Two clicks in one task see the same render, so a guard that lives in state
 * cannot tell the second from the first. The latch is a ref.
 */
it("sends one lookup for two clicks that land before a render", async () => {
  reply = () => Response.json({ data: { kbId: V3_KB_ID, identity: IDENTITY } });
  await render();
  const button = action(row("astro.example"), "lookup")!;
  await act(async () => { button.click(); button.click(); });
  expect(calls()).toHaveLength(1);
});

/** The rows are drawn from the props, so the parent's redraw after a save is what moves them. */
it("redraws from the competitors it is handed rather than from what it last sent", async () => {
  await render("zh");
  expect(row("astro.example").dataset["confirmed"]).toBe("false");
  await render("zh", { competitors: [{ domain: "astro.example", brandName: "Astro", confirmed: true }, ROWS[1]!, ROWS[2]!] });
  expect(row("astro.example").dataset["confirmed"]).toBe("true");
  expect(row("astro.example").querySelector("[data-competitor-name]")?.textContent).toBe("Astro");
  expect(actions(row("astro.example"))).toEqual(["rename", "unconfirm"]);
});
