import { describe, expect, it } from "vitest";
import en from "../../../../../packages/i18n/src/messages/en.json";
import zh from "../../../../../packages/i18n/src/messages/zh-CN.json";
import { ENUM_GROUPS } from "./enums.ts";

const LOCALES = { en, "zh-CN": zh } as const;

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
          expect(String(value)).not.toMatch(/[{}']/);
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

  it("has the provenance line with an {at} argument in both locales", () => {
    for (const messages of Object.values(LOCALES)) {
      const line = (messages.workbench as { provenance: { artifact: string } })
        .provenance.artifact;
      expect(line).toContain("{at}");
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
