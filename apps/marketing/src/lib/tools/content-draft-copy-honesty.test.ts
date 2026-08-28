// @input  -- the draft engine constants and both message bundles
// @output -- a failing test when a threshold the draft page prints stops matching the engine
// @pos    -- handoff §2 rule 3 / §8 item 34 for the draft side: every threshold is interpolated
//            from constants, the copy is formatted with the real numbers here, and no template
//            carries a digit
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { CONTENT_BRIEF_HANDOFF_MAX_BYTES } from "@sf/public-tools/content-brief/contract";
import {
  DRAFT_REQUEST_MAX_BYTES,
  DRAFT_TOTAL_BUDGET_MS,
  SECTION_ACCOUNT_MAX_PER_HOUR,
  SECTION_ENDPOINT_BUDGET_MS,
  SECTION_MAX_ATTEMPTS,
  SECTION_REQUEST_MAX_BYTES,
  SECTION_RERUN_SOFT_MAX,
  SECTION_TIMEOUT_MS,
} from "@sf/public-tools/content-brief/constants";

import en from "../../i18n/messages/en.json" with { type: "json" };
import zh from "../../i18n/messages/zh.json" with { type: "json" };

const BUNDLES = { en, zh } as const;
type Locale = keyof typeof BUNDLES;

function copy(locale: Locale): Record<string, unknown> {
  return BUNDLES[locale].tools.contentDraft as unknown as Record<string, unknown>;
}

function translator(locale: Locale) {
  return createTranslator({
    locale,
    messages: { tools: { contentDraft: copy(locale) } },
    namespace: "tools.contentDraft",
  });
}

function leaf(locale: Locale, path: string): string {
  const value = path
    .split(".")
    .reduce<unknown>(
      (node, segment) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      copy(locale),
    );
  if (typeof value !== "string") throw new Error(`${locale}: ${path} is not a string`);
  return value;
}

/**
 * Every draft message that names a threshold, the parameter it reads it
 * through, and the constant the engine enforces (see
 * content-brief-copy-honesty.test.ts for the rule and its history).
 */
const THRESHOLD_COPY: readonly {
  readonly path: string;
  readonly values: Readonly<Record<string, number | string>>;
  readonly pinned: readonly (readonly [string, number])[];
}[] = [
  {
    path: "intake.maxBytes",
    values: { kb: CONTENT_BRIEF_HANDOFF_MAX_BYTES / 1024 },
    pinned: [["kb", CONTENT_BRIEF_HANDOFF_MAX_BYTES / 1024]],
  },
  {
    path: "settings.sections.help",
    values: {
      timeout: SECTION_TIMEOUT_MS / 1_000,
      budget: DRAFT_TOTAL_BUDGET_MS / 1_000,
      attempts: SECTION_MAX_ATTEMPTS,
    },
    pinned: [
      ["timeout", SECTION_TIMEOUT_MS / 1_000],
      ["budget", DRAFT_TOTAL_BUDGET_MS / 1_000],
      ["attempts", SECTION_MAX_ATTEMPTS],
    ],
  },
  {
    // The run endpoint's cap; the page formats whichever route refused the body.
    path: "errors.payload_too_large",
    values: { kb: Math.round(DRAFT_REQUEST_MAX_BYTES / 1024) },
    pinned: [["kb", Math.round(DRAFT_REQUEST_MAX_BYTES / 1024)]],
  },
  {
    // The section endpoint's cap: the brief plus a whole previous DraftResult.
    path: "errors.payload_too_large",
    values: { kb: Math.round(SECTION_REQUEST_MAX_BYTES / 1024) },
    pinned: [["kb", Math.round(SECTION_REQUEST_MAX_BYTES / 1024)]],
  },
  {
    path: "running.elapsed",
    values: { seconds: 3, budget: DRAFT_TOTAL_BUDGET_MS / 1_000 },
    pinned: [["budget", DRAFT_TOTAL_BUDGET_MS / 1_000]],
  },
  {
    path: "running.rerunElapsed",
    values: { seconds: 3, budget: SECTION_ENDPOINT_BUDGET_MS / 1_000 },
    pinned: [["budget", SECTION_ENDPOINT_BUDGET_MS / 1_000]],
  },
  {
    path: "run.elapsed",
    values: { elapsed: 31.2, budget: DRAFT_TOTAL_BUDGET_MS / 1_000 },
    pinned: [["budget", DRAFT_TOTAL_BUDGET_MS / 1_000]],
  },
  {
    path: "doc.rerunsUsed",
    values: { used: 1, max: SECTION_RERUN_SOFT_MAX },
    pinned: [["max", SECTION_RERUN_SOFT_MAX]],
  },
  {
    path: "doc.rerunLimit",
    values: { max: SECTION_RERUN_SOFT_MAX },
    pinned: [["max", SECTION_RERUN_SOFT_MAX]],
  },
  {
    path: "wontSay.noRewrite",
    values: { attempts: SECTION_MAX_ATTEMPTS },
    pinned: [["attempts", SECTION_MAX_ATTEMPTS]],
  },
];

describe("content draft threshold copy", () => {
  for (const locale of ["en", "zh"] as const) {
    const t = translator(locale);
    for (const { path, values, pinned } of THRESHOLD_COPY) {
      it(`${locale}: ${path} reads its threshold through a parameter`, () => {
        const template = leaf(locale, path);
        const formatted = t(path as never, values as never);
        for (const [parameter, expected] of pinned) {
          expect(template, `${path} lacks {${parameter}}`).toContain(`{${parameter}}`);
          expect(template, `${path} hard-codes ${expected}`).not.toMatch(
            new RegExp(`(?<![\\d.{])${expected}(?![\\d}])`),
          );
          expect(formatted).toContain(String(expected));
        }
        expect(formatted).not.toMatch(/\{[a-zA-Z]+\}/);
      });
    }
  }
});

describe("content draft constant arithmetic", () => {
  it("keeps the section endpoint's budget below the total draft budget", () => {
    // A rerun of one section must never be allowed more wall clock than the
    // whole first run; the page prints both budgets.
    expect(SECTION_ENDPOINT_BUDGET_MS).toBeLessThan(DRAFT_TOTAL_BUDGET_MS);
  });

  it("sizes the section request above the draft request", () => {
    // The section endpoint carries the brief AND every section body.
    expect(SECTION_REQUEST_MAX_BYTES).toBeGreaterThan(DRAFT_REQUEST_MAX_BYTES);
  });

  it("keeps the client rerun soft cap inside the hourly section quota", () => {
    // The page's cap is a courtesy; the server's quota is the real bound, so
    // the courtesy must never promise more than the server would grant.
    expect(SECTION_RERUN_SOFT_MAX).toBeLessThanOrEqual(SECTION_ACCOUNT_MAX_PER_HOUR);
  });

  it("gives every section its retry inside the endpoint budget", () => {
    expect(SECTION_TIMEOUT_MS * SECTION_MAX_ATTEMPTS).toBeLessThan(SECTION_ENDPOINT_BUDGET_MS);
  });
});
