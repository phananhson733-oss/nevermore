// @vitest-environment jsdom
// @input  -- CookieBanner under the real en and zh next-intl catalogs
// @output -- proof that the persistent preferences trigger follows the active locale
// @pos    -- regression guard for the global cookie preferences entry point

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { saveConsent } from "./cookie-consent-state.ts";
import { CookieBanner } from "./cookie-banner.tsx";

describe("CookieBanner", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    saveConsent({
      consent_version: "1.0",
      necessary: true,
      analytics: false,
      marketing: false,
      updated_at: "2026-08-20T00:00:00.000Z",
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    localStorage.clear();
  });

  it.each([
    ["en", en, en.footer.cookiePreferences],
    ["zh", zh, zh.footer.cookiePreferences],
  ] as const)(
    "names the floating preferences trigger from the %s catalog",
    async (locale, messages, expectedLabel) => {
      await act(async () => {
        root.render(
          <NextIntlClientProvider locale={locale} messages={messages}>
            <CookieBanner />
          </NextIntlClientProvider>,
        );
      });

      const trigger = host.querySelector("button");
      expect(trigger?.getAttribute("aria-label")).toBe(expectedLabel);
    },
  );
});
