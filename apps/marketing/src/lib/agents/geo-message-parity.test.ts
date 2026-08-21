// @input  -- the code tables the GEO route and report contract export
// @output -- proof every code a visitor can be shown has a sentence in both locales
// @pos    -- the guardrail for a class of defect: a code with no message renders as its own key path

import { describe, expect, it } from "vitest";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { GEO_RUN_ERROR_CODES } from "./geo-run-errors.ts";
import {
  GEO_RUN_LIMITATION_CODES,
  GEO_SAMPLE_LIMITATION_CODES,
} from "./geo-report-contract.ts";

/*
 * next-intl renders a missing key as the key path itself, and does not throw.
 * So a code with no message does not fail a build, does not fail typecheck, and
 * does not fail a component test unless that test's fixture happens to trigger
 * exactly that code — it just prints `agents.geo.runLimitations.some_code` on a
 * report somebody paid eighteen provider calls for. Three codes reached that
 * state at once: `cost_ceiling_reached`, which the handler pushes whenever a
 * run hits its spending ceiling, and two run errors that instead collapsed into
 * the generic "the run could not be completed".
 *
 * Walking the exported tables is what makes this catch the next one. A test
 * that listed the codes itself would be a second hand-written list, drifting
 * the same way the first one did.
 */
const LOCALES = { en, zh } as const;

function messagesAt(
  locale: keyof typeof LOCALES,
  group: string,
): Record<string, unknown> {
  const geo = (
    LOCALES[locale] as unknown as {
      agents: { geo: Record<string, Record<string, unknown>> };
    }
  ).agents.geo;
  const messages = geo[group];
  if (messages === undefined) {
    throw new Error(`agents.geo.${group} is missing from ${locale}`);
  }
  return messages;
}

describe("every GEO code a visitor can see has a sentence in both locales", () => {
  const groups = [
    { group: "errors", codes: GEO_RUN_ERROR_CODES },
    { group: "runLimitations", codes: GEO_RUN_LIMITATION_CODES },
    { group: "sampleLimitations", codes: GEO_SAMPLE_LIMITATION_CODES },
  ] as const;

  for (const { group, codes } of groups) {
    // A table that emptied out would make every assertion below vacuous.
    it(`has codes to check in ${group}`, () => {
      expect(codes.length).toBeGreaterThan(0);
    });

    for (const locale of ["en", "zh"] as const) {
      it(`covers every ${group} code in ${locale}`, () => {
        const messages = messagesAt(locale, group);
        const missing = codes.filter(
          (code) => typeof messages[code] !== "string",
        );
        expect(missing).toEqual([]);
      });

      it(`has no orphaned ${group} message in ${locale}`, () => {
        // The other direction: a message left behind after its code was
        // removed is dead weight that reads as a supported state.
        // `unknown` is the deliberate catch-all for a code this build has never
        // heard of, so it is not in any table and is not an orphan.
        const known = new Set<string>([...codes, "unknown"]);
        const orphans = Object.keys(messagesAt(locale, group)).filter(
          (key) => !known.has(key),
        );
        expect(orphans).toEqual([]);
      });
    }
  }

  it("keeps the workbench's fallback message, which is not a code", () => {
    // `unknown` is the deliberate catch-all for a code this build has never
    // heard of. It is not in the table and must not be reported as an orphan,
    // so it lives here rather than in the loop above.
    for (const locale of ["en", "zh"] as const) {
      expect(typeof messagesAt(locale, "errors")["unknown"]).toBe("string");
    }
  });
});
