import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  resolveUiLocale,
  UI_LOCALE_COOKIE,
} from "./config.ts";

describe("UI locale defaults", () => {
  it("opens the customer workspace in Chinese when no preference exists", () => {
    expect(DEFAULT_LOCALE).toBe("zh-CN");
    expect(resolveUiLocale(null)).toBe("zh-CN");
    expect(resolveUiLocale(undefined)).toBe("zh-CN");
    expect(resolveUiLocale("unsupported")).toBe("zh-CN");
  });

  it("keeps an explicit English preference", () => {
    expect(UI_LOCALE_COOKIE).toBe("sf_ui_locale");
    expect(resolveUiLocale("en")).toBe("en");
    expect(resolveUiLocale("zh-CN")).toBe("zh-CN");
  });
});
