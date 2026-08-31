import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { geoBriefFixture } from "@sf/public-tools/content-brief/geo-fixtures";
import { SharedGeoBriefResults } from "./geo-brief-shared-tool.tsx";
import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";

describe("GEO shared result real catalogs", () => {
  it.each(["en", "zh"] as const)("renders every displayed source/action/section in %s without a missing key", async locale => {
    const brief = await geoBriefFixture(); const errors: Error[] = [];
    const html = renderToStaticMarkup(<NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh} timeZone="UTC" onError={error => errors.push(error)}><SharedGeoBriefResults brief={brief} /></NextIntlClientProvider>);
    expect(errors).toEqual([]);
    expect(html).toContain("data-shared-geo-result");
    expect(html).not.toContain("tools.geoBrief.");
  });
});
