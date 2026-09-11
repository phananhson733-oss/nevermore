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
const HASH = "c".repeat(64);
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
let reply: Reply;
let host: HTMLDivElement, root: Root;
let onSaved: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  onSaved = vi.fn();
  reply = () => Response.json({ error: { code: "not_found" } }, { status: 404 });
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
    kbId: V3_KB_ID, competitors: ROWS, baseVersion: 4, generationInputHash: HASH, disabled: false,
    onSaved: onSaved as unknown as GeoKbCompetitorsProps["onSaved"], ...overrides,
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
  reply = (body) => body.intent === "identify"
    ? Response.json({ data: { kbId: V3_KB_ID, identity: IDENTITY } })
    : Response.json({ data: saved([{ domain: "astro.example", brandName: "Astro", confirmed: true, aliases: ["Astro Charts"] }, ROWS[1]!, ROWS[2]!]) });
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
  expect(bodyOf(1)).toEqual({
    kbId: V3_KB_ID, intent: "confirm", baseVersion: 4, expectedGenerationInputHash: HASH,
    domain: "astro.example", brandName: "Astro", aliases: ["Astro Charts"],
  });
  expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ draftVersion: 5, changed: true }));
});

it("asks for a name before confirming a rival nobody has named, and refuses an empty one without a request", async () => {
  reply = () => Response.json({ data: saved([{ domain: "astro.example", brandName: "Astro Seek", confirmed: true }, ROWS[1]!, ROWS[2]!]) });
  await render("zh");
  await click(action(row("astro.example"), "confirm"));
  expect(calls()).toHaveLength(0);
  const input = row("astro.example").querySelector<HTMLInputElement>("input[data-competitor-name-input]")!;
  expect(input.value).toBe("");
  await click(action(row("astro.example"), "save"));
  expect(calls()).toHaveLength(0);
  expect(row("astro.example").querySelector("[data-competitor-error]")?.textContent).toBe(copy("zh").nameRequired);
  await type(input, "  Astro Seek ");
  await click(action(row("astro.example"), "save"));
  expect(bodyOf(0)).toEqual({
    kbId: V3_KB_ID, intent: "confirm", baseVersion: 4, expectedGenerationInputHash: HASH,
    domain: "astro.example", brandName: "Astro Seek", aliases: [],
  });
  expect(onSaved).toHaveBeenCalledOnce();
  expect(row("astro.example").querySelector("input[data-competitor-name-input]")).toBeNull();
});

it("renames a confirmed rival under its existing aliases, and cancel closes the field without writing", async () => {
  reply = () => Response.json({ data: saved([ROWS[0]!, { domain: "rival.example", brandName: "Rival Ltd", confirmed: true, aliases: ["Rival Inc"] }, ROWS[2]!]) });
  await render();
  await click(action(row("rival.example"), "rename"));
  const input = row("rival.example").querySelector<HTMLInputElement>("input[data-competitor-name-input]")!;
  expect(input.value).toBe("Rival");
  await click(action(row("rival.example"), "cancel"));
  expect(row("rival.example").querySelector("input[data-competitor-name-input]")).toBeNull();
  expect(calls()).toHaveLength(0);
  await click(action(row("rival.example"), "rename"));
  await type(row("rival.example").querySelector<HTMLInputElement>("input[data-competitor-name-input]")!, "Rival Ltd");
  await click(action(row("rival.example"), "save"));
  expect(bodyOf(0)).toMatchObject({ intent: "confirm", domain: "rival.example", brandName: "Rival Ltd", aliases: ["Rival Inc"] });
});

it("withdraws a confirmation", async () => {
  reply = () => Response.json({ data: saved([ROWS[0]!, { domain: "rival.example", brandName: "Rival", confirmed: false, aliases: ["Rival Inc"] }, ROWS[2]!]) });
  await render();
  await click(action(row("rival.example"), "unconfirm"));
  expect(bodyOf(0)).toEqual({ kbId: V3_KB_ID, intent: "unconfirm", baseVersion: 4, expectedGenerationInputHash: HASH, domain: "rival.example" });
  expect(onSaved).toHaveBeenCalledOnce();
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

it("reports the server's refusal in the owner's words and calls nothing saved", async () => {
  reply = () => Response.json({ error: { code: "conflict" }, draftVersion: 9 }, { status: 409 });
  await render("zh");
  await click(action(row("rival.example"), "unconfirm"));
  expect(row("rival.example").querySelector("[data-competitor-error]")?.textContent).toBe(copy("zh").failed.conflict);
  expect(row("rival.example").querySelector("[data-competitor-error]")?.getAttribute("role")).toBe("alert");
  expect(onSaved).not.toHaveBeenCalled();
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

/** The rows are drawn from the props, so the parent's redraw after a save is what moves them. */
it("redraws from the competitors it is handed rather than from what it last sent", async () => {
  await render("zh");
  expect(row("astro.example").dataset["confirmed"]).toBe("false");
  await render("zh", { competitors: [{ domain: "astro.example", brandName: "Astro", confirmed: true }, ROWS[1]!, ROWS[2]!] });
  expect(row("astro.example").dataset["confirmed"]).toBe("true");
  expect(row("astro.example").querySelector("[data-competitor-name]")?.textContent).toBe("Astro");
  expect(actions(row("astro.example"))).toEqual(["rename", "unconfirm"]);
});
