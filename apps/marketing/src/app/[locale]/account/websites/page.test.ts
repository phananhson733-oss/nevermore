// @input  -- the websites page source and both account website catalogs
// @output -- a failing test if the default account page stops mounting the websites client privately
// @pos    -- contract guard for /account/websites

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import en from "../../../../i18n/messages/en.json" with { type: "json" };
import zh from "../../../../i18n/messages/zh.json" with { type: "json" };

function read(file: string): string {
  return readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
}

const PAGE = read("./page.tsx");

describe("/account/websites page contract", () => {
  it("stays request-rendered and out of search results", () => {
    expect(PAGE).toContain('export const dynamic = "force-dynamic"');
    expect(PAGE).toContain("noIndex: true");
  });

  it("mounts the client with the account namespace only", () => {
    expect(PAGE).toContain("<WebsitesAccountClient />");
    expect(PAGE).toContain("messages={{ account: messages.account }}");
    expect(PAGE).not.toContain("messages={messages}");
  });

  it("keeps the localized page heading outside the client state machine", () => {
    expect(PAGE).toContain("<h2");
    expect(PAGE).toContain('{t("title")}');
    expect(PAGE).toContain('{t("subtitle")}');
  });

  it("takes its copy from both catalogs", () => {
    for (const websites of [en.account.websites, zh.account.websites]) {
      expect(websites.title).toEqual(expect.any(String));
      expect(websites.subtitle).toEqual(expect.any(String));
      expect(websites.add).toEqual(expect.any(String));
    }
  });
});
