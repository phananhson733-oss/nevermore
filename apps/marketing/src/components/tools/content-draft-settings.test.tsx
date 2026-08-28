// @vitest-environment jsdom
// @input  -- the real EN/ZH catalogs, the package's brief fixture, and ContentDraftSettings
// @output -- proof the settings card formats every threshold it prints (attempts, timeout, budget)
//            through the real ICU catalog, so a missing argument cannot hide behind a mocked t()
// @pos    -- the render-level companion of content-draft-copy-honesty.test.ts for the settings card

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DRAFT_TOTAL_BUDGET_MS,
  SECTION_MAX_ATTEMPTS,
  SECTION_TIMEOUT_MS,
} from "@sf/public-tools/content-brief/constants";
import { draftBrief } from "@sf/public-tools/content-brief/draft-fixtures";

import enMessages from "../../i18n/messages/en.json";
import zhMessages from "../../i18n/messages/zh.json";
import { ContentDraftSettings, DEFAULT_DRAFT_SETTINGS } from "./content-draft-settings.tsx";

let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
});

function Harness({ brief, locale }: { readonly brief: Awaited<ReturnType<typeof draftBrief>>; readonly locale: string }) {
  const t = useTranslations("tools.contentDraft");
  return (
    <ContentDraftSettings
      brief={brief}
      settings={DEFAULT_DRAFT_SETTINGS}
      onSettings={() => undefined}
      selected={new Set(brief.draft_readiness.writable)}
      onToggleSection={() => undefined}
      disabled={false}
      locale={locale}
      t={t}
    />
  );
}

async function render(locale: "en" | "zh"): Promise<HTMLElement> {
  const brief = await draftBrief();
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : zhMessages} timeZone="UTC">
        <Harness brief={brief} locale={locale} />
      </NextIntlClientProvider>,
    );
  });
  return host;
}

describe.each(["en", "zh"] as const)("ContentDraftSettings (%s)", (locale) => {
  it("prints attempts, timeout and budget as numbers, never as a leftover placeholder", async () => {
    const host = await render(locale);
    const text = host.textContent ?? "";
    expect(text).not.toMatch(/\{[a-zA-Z]+\}/);
    expect(text).toContain(String(SECTION_MAX_ATTEMPTS));
    expect(text).toContain(String(SECTION_TIMEOUT_MS / 1_000));
    expect(text).toContain(String(DRAFT_TOTAL_BUDGET_MS / 1_000));
    expect(text).not.toMatch(/tools\.contentDraft|settings\./);
    expect(host.querySelectorAll("[data-section-checkbox]").length).toBeGreaterThan(0);
  });
});
