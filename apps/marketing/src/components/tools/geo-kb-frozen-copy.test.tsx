// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import en from "../../i18n/messages/en.json";
import { emptyGeoKbPayload } from "../../lib/geo-tools/kb-contract.ts";
import { GeoKbFrozenCopy } from "./geo-kb-frozen-copy.tsx";
let host: HTMLDivElement;
let root: Root;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(sourceUrl: string) {
  const payload = { ...emptyGeoKbPayload("https://example.com"), facts: [{ key: "Historical fact", value: "Value", reason: "" as const, sourceUrl, observedAt: "" }] };
  await act(async () => root.render(<NextIntlClientProvider locale="en" messages={en}><GeoKbFrozenCopy payload={payload} locale="en" revision={1} /></NextIntlClientProvider>));
}
describe("historical fact source display", () => {
  it.each(["javascript:alert(1)", "data:text/html,hello", "file:///private/example", "/pricing", "http://127.0.0.1/private"])("keeps an unvalidated legacy source as plain text, not a link: %s", async source => {
    await render(source);
    expect(host.textContent).toContain(source);
    expect(host.querySelector("a")).toBeNull();
  });
  it("retains the full page identity of a valid public HTTP source", async () => {
    await render("https://example.com/pricing?plan=pro#limits");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("https://example.com/pricing?plan=pro#limits");
  });
});
