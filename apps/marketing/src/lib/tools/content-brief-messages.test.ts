// @input  -- the brief contract's closed code unions (as runtime arrays) and both message bundles
// @output -- a failing test when any code the result surface can render has no copy in either locale
// @pos    -- handoff §2 rule 4 / §8 item 35: the server sends codes, the copy lives here, and
//            this is the guard between "type-checks" and "renders a key path in front of a visitor"
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import {
  CONTENT_BRIEF_ERROR_CODES,
  CRAWL_FAILURE_REASONS,
  CRAWL_SKIPPED_REASONS,
  GAP_KINDS,
  INTENT_VALUES,
  ORIGINS,
  PRIMARY_COVERAGE_REASONS,
  RUN_MODES,
  SERP_FORMATS,
  UNAVAILABLE_REASONS,
  VERDICT_KEYS,
} from "../../components/tools/content-brief-codes.ts";
import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";

type Bundle = Record<string, unknown>;

function contentBrief(bundle: unknown): Bundle {
  const tools = (bundle as { tools?: Record<string, unknown> }).tools;
  const node = tools?.["contentBrief"];
  if (typeof node !== "object" || node === null) {
    throw new Error("tools.contentBrief missing from bundle");
  }
  return node as Bundle;
}

function group(bundle: unknown, path: string): Bundle {
  let node: unknown = contentBrief(bundle);
  for (const segment of path.split(".")) {
    node = (node as Bundle)[segment];
    if (typeof node !== "object" || node === null) {
      throw new Error(`tools.contentBrief.${path} missing from bundle`);
    }
  }
  return node as Bundle;
}

const LOCALES: readonly (readonly [string, unknown])[] = [
  ["en", en],
  ["zh", zh],
];

/** Each group of closed codes and the message table that renders it. */
const CODE_TABLES: readonly (readonly [string, readonly string[]])[] = [
  ["unavailable", UNAVAILABLE_REASONS],
  ["modes", RUN_MODES],
  ["modeBody", RUN_MODES],
  ["formats", SERP_FORMATS],
  ["intents", INTENT_VALUES],
  ["readiness.gaps", GAP_KINDS],
  ["crawlSkipped", CRAWL_SKIPPED_REASONS],
  ["crawlFailed", CRAWL_FAILURE_REASONS],
  ["primaryCoverage", PRIMARY_COVERAGE_REASONS],
  ["sources.origins", ORIGINS],
  ["errors", [...CONTENT_BRIEF_ERROR_CODES, "unknown"]],
];

describe("content-brief message coverage", () => {
  for (const [locale, bundle] of LOCALES) {
    for (const [path, codes] of CODE_TABLES) {
      it(`has copy for every ${path} code (${locale})`, () => {
        const node = group(bundle, path);
        for (const code of codes) {
          expect(typeof node[code], `${path}.${code}`).toBe("string");
        }
      });
    }

    it(`has copy for every legal verdict action × reason (${locale})`, () => {
      for (const key of VERDICT_KEYS) {
        const [action, reason] = key.split(".");
        const node = group(bundle, `verdict.${action}`);
        expect(typeof node[reason ?? ""], `verdict.${key}`).toBe("string");
        expect(typeof node["title"], `verdict.${action}.title`).toBe("string");
      }
      // The rewrite verdict prints the v1 boundary sentence next to it.
      expect(typeof group(bundle, "verdict.update")["v1NoRewrite"]).toBe("string");
    });

    it(`has the field-specific unsupported-language and evidence lines (${locale})`, () => {
      // These three fields are unsupported for non-whitespace languages by
      // construction (handoff §1), and each says so in its own words.
      for (const field of ["length", "mustAnswer", "outline"]) {
        expect(typeof group(bundle, field)["unsupported_language"], field).toBe(
          "string",
        );
      }
      expect(typeof group(bundle, "length")["insufficient"]).toBe("string");
      expect(typeof group(bundle, "mustAnswer")["insufficient"]).toBe("string");
      expect(typeof group(bundle, "mustAnswer")["empty"]).toBe("string");
      expect(typeof group(bundle, "outline")["insufficient_evidence"]).toBe(
        "string",
      );
    });

    it(`explains every profile-read failure the gap angle can inherit (${locale})`, () => {
      const node = group(bundle, "gapAngle.profileReason");
      for (const reason of ["insufficient_evidence", "timeout", "provider_error"]) {
        expect(typeof node[reason], `gapAngle.profileReason.${reason}`).toBe("string");
      }
    });

    it(`keeps the not-observed verdict honest about anonymization (${locale})`, () => {
      // Handoff §2 rule 7: this one reason must carry the anonymization
      // sentence; the other two create reasons must not borrow it.
      const create = group(bundle, "verdict.create");
      const anonymized = locale === "en" ? /anonymiz/i : /匿名化/;
      expect(String(create["not_observed"])).toMatch(anonymized);
      expect(String(create["below_impression_floor"])).not.toMatch(anonymized);
      expect(String(create["beyond_position_cap"])).not.toMatch(anonymized);
    });

    it(`never lets an undecidable verdict read as "create" (${locale})`, () => {
      const undecidable = group(bundle, "verdict.undecidable");
      const create = locale === "en" ? /\bcreate\b/i : /新建/;
      const cannotDecide =
        locale === "en" ? /cannot decide whether you would compete/ : /无法判定是否自我竞争/;
      for (const [key, value] of Object.entries(undecidable)) {
        if (key === "title") continue;
        expect(String(value), key).not.toMatch(create);
        expect(String(value), key).toMatch(cannotDecide);
      }
    });
  }

  it("keeps the two locales structurally identical", () => {
    const keysOf = (node: unknown, prefix = ""): string[] => {
      if (typeof node !== "object" || node === null) return [];
      return Object.entries(node as Record<string, unknown>).flatMap(
        ([k, v]) => [prefix + k, ...keysOf(v, `${prefix}${k}.`)],
      );
    };
    expect(keysOf(contentBrief(en)).sort()).toEqual(
      keysOf(contentBrief(zh)).sort(),
    );
  });
});
