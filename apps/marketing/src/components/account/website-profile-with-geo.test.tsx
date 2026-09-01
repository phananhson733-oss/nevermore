// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../i18n/messages/en.json";
import { WebsiteProfileWithGeo } from "./website-profile-with-geo.tsx";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("Profile/GEO initial availability", () => {
  it.each([401, 404, 503, "invalid", "network"] as const)("does not leave GEO loading after a terminal Profile failure: %s", async (outcome) => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      if (outcome === "network") throw new Error("offline");
      return Response.json({}, { status: typeof outcome === "number" ? outcome : 200 });
    });
    await act(async () => root.render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={en}>
      <WebsiteProfileWithGeo websiteId="c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6" autoGenerate={false} />
    </NextIntlClientProvider>));
    const geo = host.querySelector("#geo");
    expect(geo?.textContent).not.toContain(en.tools.geoKnowledgeBase.asset.loading);
    expect(geo?.querySelector('[role="alert"]')).not.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
