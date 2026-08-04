import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { RANKING_UPDATE_TABLE } from "@sf/public-tools";

/**
 * The product decision this file guards.
 *
 * P0-3 does not tell anyone their site was demoted, and does not tell them it
 * was not. Google publishes no signal for it, so there is no ground truth to
 * calibrate a threshold against and no way for a claim to be falsified. Every
 * shape the observations can take has several ordinary explanations, and at
 * least one of them is usually cheaper to check and cheaper to fix.
 *
 * That decision lives in prose, which is where decisions like it go to die.
 * "Consistent with the pattern of a site-level demotion" reads to a frightened
 * visitor as "you were demoted" — it was in an earlier draft of the
 * requirement as the SAFE phrasing, which is exactly why the test enumerates
 * the softened forms too.
 */
function bundle(locale: "en" | "zh"): string {
  const path = fileURLToPath(
    new URL(`../../i18n/messages/${locale}.json`, import.meta.url),
  );
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    tools: { trafficDrop: unknown };
  };
  return JSON.stringify(parsed.tools.trafficDrop);
}

const BUNDLES = { en: bundle("en"), zh: bundle("zh") } as const;

describe("traffic drop copy never claims a demotion", () => {
  it.each(["en", "zh"] as const)("in %s, in any of its forms", (locale) => {
    const text = BUNDLES[locale].toLowerCase();
    const forbidden =
      locale === "en"
        ? [
            "you were penalised",
            "you were penalized",
            "your site was demoted",
            "site-wide demotion",
            "site-level demotion",
            "consistent with the pattern of a site-level",
            "algorithmic penalty",
          ]
        : [
            "你被降权",
            "你的网站被降权",
            "受到了惩罚",
            "与站点级排名下调的模式一致",
            "与站点级下调的模式一致",
            "算法惩罚",
          ];

    for (const phrase of forbidden) {
      expect(text, `${locale} copy contains: ${phrase}`).not.toContain(
        phrase.toLowerCase(),
      );
    }
  });

  it.each(["en", "zh"] as const)(
    "in %s, never reports the visitor's answer as our own lookup",
    (locale) => {
      const text = BUNDLES[locale].toLowerCase();
      // "Ruled out" claims we checked. We did not — they did, and they may
      // have been on the Security Issues page or on another property.
      const forbidden =
        locale === "en"
          ? ["we ruled out a manual action", "manual action ruled out"]
          : ["已排除人工处罚", "已排除人工处置"];

      for (const phrase of forbidden) {
        expect(text, `${locale} copy contains: ${phrase}`).not.toContain(
          phrase.toLowerCase(),
        );
      }
    },
  );

  it.each(["en", "zh"] as const)(
    "in %s, promises no recovery timetable",
    (locale) => {
      const text = BUNDLES[locale].toLowerCase();
      // An earlier draft offered "a few days to a few weeks" for a manual
      // action and "usually the next core update" for everything else. The
      // second sounds like a mechanism and is a schedule; a visitor still flat
      // after the next update concludes the tool was wrong.
      const forbidden =
        locale === "en"
          ? [
              "a few days to a few weeks",
              "usually the next core update",
              "1-3 update cycles",
            ]
          : ["几天到几周", "等下一次核心更新", "1-3 个更新周期"];

      for (const phrase of forbidden) {
        expect(text, `${locale} copy contains: ${phrase}`).not.toContain(
          phrase.toLowerCase(),
        );
      }
    },
  );

  it("keeps the ranking-update table honest about when it was last checked", () => {
    // The staleness guard is only as good as this field. A table whose
    // verifiedThrough silently tracked its newest entry would always claim to
    // be current, and detection A would start manufacturing false negatives.
    const newest = RANKING_UPDATE_TABLE.updates
      .map((update) => update.endDate ?? update.startDate)
      .sort()
      .at(-1);
    expect(newest).toBeDefined();
    expect(RANKING_UPDATE_TABLE.verifiedThrough >= (newest ?? "")).toBe(true);
  });
});
