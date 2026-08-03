import { describe, expect, it } from "vitest";

import en from "../../i18n/messages/en.json" with { type: "json" };
import zh from "../../i18n/messages/zh.json" with { type: "json" };

/**
 * Checks the tool can never run must say so as a capability, not as an accident.
 *
 * These three read `TrafficCheckInputs`, and nothing in the codebase supplies
 * it: the type exists, the default is all-false/null, and the branches consume
 * it — but `buildTrafficDropReport` is never called with `checkInputs`, and
 * `packages/sources/src/gsc/` contains only the `[date]`-dimension reader. So
 * the answer is the same on every run, for every property, forever.
 *
 * The original wording was "was not read in this run", which tells the reader
 * that running again, or running on a different site, might read it. It will
 * not. On a tool whose entire pitch is that it distinguishes "we checked and
 * found nothing" from "we could not check", describing a permanent boundary as
 * a temporary state is the same class of error as reporting `clear` for a
 * check that never ran.
 *
 * If query- or page-level analysis is ever implemented, this test fails — and
 * it should, because the copy has to change with it.
 */
const PERMANENTLY_UNAVAILABLE = [
  "query_data_not_supplied",
  "page_data_not_supplied",
  "probe_data_not_supplied",
] as const;

/** Words that frame a permanent limit as a one-off. */
const TEMPORAL_FRAMING = [
  "this run",
  "本次",
  "这次",
  "暂时",
  "for now",
  "not yet",
  "currently",
];

const BUNDLES = { en, zh } as const;

describe("capability-boundary copy", () => {
  it.each(["en", "zh"] as const)(
    "states what the tool does not do, not what %s skipped this time",
    (locale) => {
      const reasons = (
        BUNDLES[locale] as unknown as {
          tools: {
            trafficDrop: { unavailableReasons: Record<string, string> };
          };
        }
      ).tools.trafficDrop.unavailableReasons;

      for (const code of PERMANENTLY_UNAVAILABLE) {
        const copy = reasons[code];
        expect(copy, `${locale}.${code} is missing`).toBeTruthy();

        for (const phrase of TEMPORAL_FRAMING) {
          expect(
            copy?.toLowerCase(),
            `${locale}.${code} frames a permanent limit as temporary ("${phrase}"): ${copy}`,
          ).not.toContain(phrase.toLowerCase());
        }
      }
    },
  );

  it.each(["en", "zh"] as const)(
    "points %s at somewhere the reader can actually get the answer",
    (locale) => {
      const reasons = (
        BUNDLES[locale] as unknown as {
          tools: {
            trafficDrop: { unavailableReasons: Record<string, string> };
          };
        }
      ).tools.trafficDrop.unavailableReasons;

      // Naming the boundary without naming the alternative leaves the reader
      // with a dead end. Every one of these has a place to go.
      for (const code of PERMANENTLY_UNAVAILABLE) {
        expect(
          reasons[code],
          `${locale}.${code} should name where to look instead`,
        ).toContain("Search Console");
      }
    },
  );
});
