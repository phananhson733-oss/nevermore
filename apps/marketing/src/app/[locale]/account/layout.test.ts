// @input  -- the shared account layout source and both account catalogs
// @output -- a failing test if the settings shell stops being private or truthful
// @pos    -- contract guard for the shared /account layout

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import en from "../../../i18n/messages/en.json" with { type: "json" };
import zh from "../../../i18n/messages/zh.json" with { type: "json" };

function read(file: string): string {
  return readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
}

const LAYOUT = read("./layout.tsx");

describe("/account layout contract", () => {
  it("keeps the whole subtree request-rendered and noindex", () => {
    expect(LAYOUT).toContain('export const dynamic = "force-dynamic"');
    expect(LAYOUT).toContain("index: false");
    expect(LAYOUT).toContain("follow: false");
  });

  it("mounts the shared settings shell around every child route", () => {
    expect(LAYOUT).toContain("<AccountSettingsShell locale={locale}>");
  });

  it("keeps only websites, credits, and agents in both catalogs", () => {
    for (const settings of [en.account.settings, zh.account.settings]) {
      expect(settings.websites).toEqual(expect.any(String));
      expect(settings.credits).toEqual(expect.any(String));
      expect(settings.agents).toEqual(expect.any(String));
    }
    expect(JSON.stringify(en.account.settings)).not.toMatch(
      /Integrations|Docs|Team|Devices|Upgrade/u,
    );
    expect(JSON.stringify(zh.account.settings)).not.toMatch(
      /集成|文档|团队|设备|升级/u,
    );
  });
});
