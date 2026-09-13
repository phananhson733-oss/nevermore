import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../../../packages/i18n/src/messages/en.json";
import zh from "../../../../../packages/i18n/src/messages/zh-CN.json";
import { ENUM_GROUPS } from "./enums.ts";

const LOCALES = { en, "zh-CN": zh } as const;
const SENTINEL = "SENTINEL-2026-09-13 08:30";
const ICU_RESIDUE = /[{}']/;

/**
 * Formats a `workbench.*` message the way the app would, but throws on every
 * next-intl error: the default handler renders the key path instead, which
 * would let a missing key or broken ICU pass. Always pass a values object —
 * `t(key)` without one returns the raw string and never compiles it.
 */
function formatStrict(
  locale: keyof typeof LOCALES,
  key: string,
  values: Record<string, string>,
): string {
  const t = createTranslator({
    locale,
    messages: LOCALES[locale],
    namespace: "workbench",
    onError: (error) => {
      throw error;
    },
  });
  return t(key as never, values as never);
}

describe("workbench.enums labels", () => {
  for (const [locale, messages] of Object.entries(LOCALES)) {
    for (const [group, ids] of Object.entries(ENUM_GROUPS)) {
      it(`${locale} ${group} has exactly one non-empty label per id`, () => {
        const labels = (
          messages.workbench as {
            enums: Record<string, Record<string, unknown>>;
          }
        ).enums[group];
        expect(labels, `${locale} workbench.enums.${group} missing`).toBeDefined();
        expect(Object.keys(labels ?? {}).sort()).toEqual([...ids].sort());
        for (const value of Object.values(labels ?? {})) {
          expect(typeof value === "string" && value.trim().length > 0).toBe(
            true,
          );
          expect(String(value)).not.toMatch(ICU_RESIDUE);
        }
      });
    }
  }

  it("has no label group that is not an enum group", () => {
    for (const messages of Object.values(LOCALES)) {
      const enums = (messages.workbench as { enums: Record<string, unknown> })
        .enums;
      expect(Object.keys(enums).sort()).toEqual(
        Object.keys(ENUM_GROUPS).sort(),
      );
    }
  });

  it("labels each module exactly as the workbench navigation does", () => {
    for (const messages of Object.values(LOCALES)) {
      const workbench = messages.workbench as {
        enums: { module: Record<string, string> };
        nav: { items: Record<string, string> };
      };
      for (const id of ENUM_GROUPS.module) {
        expect(workbench.enums.module[id], id).toBe(workbench.nav.items[id]);
      }
    }
  });
});

describe("workbench messages compile and format", () => {
  for (const locale of Object.keys(LOCALES) as (keyof typeof LOCALES)[]) {
    it(`${locale} provenance.artifact inserts the {at} argument`, () => {
      const line = formatStrict(locale, "provenance.artifact", {
        at: SENTINEL,
      });
      expect(line).toContain(SENTINEL);
      expect(line).not.toMatch(ICU_RESIDUE);
    });

    it(`${locale} provenance.artifact fails without the {at} argument`, () => {
      expect(() => formatStrict(locale, "provenance.artifact", {})).toThrow();
    });

    it(`${locale} shell.readonly formats to real copy`, () => {
      const text = formatStrict(locale, "shell.readonly", {});
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text).not.toBe("workbench.shell.readonly");
      expect(text).not.toBe("shell.readonly");
      expect(text).not.toMatch(ICU_RESIDUE);
    });
  }
});
