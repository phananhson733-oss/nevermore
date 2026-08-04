// @input  -- the shipped en/zh message bundles and the engine's action and track vocabularies
// @output -- a failing test when the advice layer promises an outcome, or has a gap in it
// @pos    -- the guard on the one thing adding recommendations could have cost this tool
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import { QUICK_WIN_ACTION_IDS, QUICK_WIN_TRACKS } from "@sf/public-tools";

import en from "../../i18n/messages/en.json" with { type: "json" };
import zh from "../../i18n/messages/zh.json" with { type: "json" };

const BUNDLES = { en, zh } as const;

function quickWins(locale: "en" | "zh"): Record<string, unknown> {
  return (
    BUNDLES[locale] as unknown as {
      tools: { quickWins: Record<string, unknown> };
    }
  ).tools.quickWins;
}

function actionText(locale: "en" | "zh"): string {
  const q = quickWins(locale);
  return JSON.stringify([q["actions"], q["actionsIntro"], q["tracks"]]);
}

/**
 * The claim this tool exists not to make.
 *
 * Layer 1 reports what each query earned, what the site's own curve earned at
 * the same position, and the difference. Adding a "what to do next" section is
 * the moment that discipline is most likely to be spent: advice wants to
 * justify itself, and the nearest justification to hand is a number of clicks
 * the reader would get back. Nothing measures that. The 2026-07-31 evaluation
 * found the leading cause of these gaps was Search answering the query in the
 * results page — where no rewrite recovers anything at all.
 *
 * The softened forms are enumerated deliberately: "could recover" and "up to"
 * are what a promise turns into when someone is asked to remove the promise.
 */
const OUTCOME_PROMISES = {
  en: [
    "you will recover",
    "you would recover",
    "could recover",
    "clicks you can win",
    "clicks you would gain",
    "will improve your",
    "guarantee",
    "up to {totalgapclicks} clicks back",
    "worth {totalgapclicks}",
    "recover {totalgapclicks}",
  ],
  zh: [
    "可以拿回",
    "能拿回",
    "最多可挽回",
    "预计能带来",
    "保证",
    "一定会提升",
    "将提升",
  ],
} as const;

describe("quick-wins action copy", () => {
  it.each(["en", "zh"] as const)(
    "never promises %s readers clicks a rewrite would recover",
    (locale) => {
      const text = actionText(locale).toLowerCase();
      for (const phrase of OUTCOME_PROMISES[locale]) {
        expect(text, `${locale} action copy contains: ${phrase}`).not.toContain(
          phrase.toLowerCase(),
        );
      }
    },
  );

  it.each(["en", "zh"] as const)(
    "carries a title and a body for every action the engine can emit, in %s",
    (locale) => {
      // An id with no message throws at render, and only for the visitors
      // whose data happens to fire that rule. This test fires for everyone.
      const actions = quickWins(locale)["actions"] as Record<
        string,
        { title?: string; body?: string } | undefined
      >;

      for (const id of QUICK_WIN_ACTION_IDS) {
        expect(actions[id]?.title, `${locale} missing title: ${id}`).toBeTruthy();
        expect(actions[id]?.body, `${locale} missing body: ${id}`).toBeTruthy();
      }
    },
  );

  it.each(["en", "zh"] as const)(
    "carries a label and a hint for every checking path, in %s",
    (locale) => {
      const tracks = quickWins(locale)["tracks"] as Record<
        string,
        { label?: string; hint?: string } | undefined
      >;

      for (const track of QUICK_WIN_TRACKS) {
        expect(
          tracks[track]?.label,
          `${locale} missing label: ${track}`,
        ).toBeTruthy();
        expect(tracks[track]?.hint, `${locale} missing hint: ${track}`).toBeTruthy();
      }
    },
  );

  it.each(["en", "zh"] as const)(
    "keeps the gap-is-not-a-forecast warning saying so, in %s",
    (locale) => {
      // The action whose entire purpose is to deny a reading the table invites.
      // If someone rewrites it into an encouragement, the total shortfall it
      // publishes becomes a target — which is the failure mode this whole
      // section was built around avoiding.
      const actions = quickWins(locale)["actions"] as Record<
        string,
        { title: string; body: string }
      >;
      const copy = JSON.stringify(
        actions["avoid_gap_as_forecast"],
      ).toLowerCase();

      const denial =
        locale === "en" ? ["not a forecast", "will not"] : ["不是预测", "不会"];
      for (const phrase of denial) {
        expect(copy, `${locale} lost the denial: ${phrase}`).toContain(phrase);
      }
    },
  );

  it.each(["en", "zh"] as const)(
    "tells %s readers to look before rewriting, not the other way round",
    (locale) => {
      // `open_serps_for_top_gaps` is the action that stands in for the thing
      // the tool cannot see. Its whole value is the ordering it prescribes:
      // read the results page first, and reach for the title only if the page
      // turns out to be plain.
      const body = (
        quickWins(locale)["actions"] as Record<string, { body: string }>
      )["open_serps_for_top_gaps"]?.body;

      const marker =
        locale === "en" ? "ai overview" : "ai 概览";
      expect(body?.toLowerCase()).toContain(marker);
    },
  );
});
