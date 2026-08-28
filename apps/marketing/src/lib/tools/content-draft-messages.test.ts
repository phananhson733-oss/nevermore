// @input  -- the draft contract's closed code unions (as runtime arrays) and both message bundles
// @output -- a failing test when any code the draft surface can render has no copy in either locale
// @pos    -- handoff §2 rule 4 / §8 item 35 for tools.contentDraft: the server sends codes, the
//            copy lives here, and this is the guard between "type-checks" and "renders a key path"
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import {
  CLAIM_STATES,
  CONTENT_DRAFT_ERROR_CODES,
  COVERAGE_CAUSES,
  COVERAGE_STATUSES,
  PERSONS,
  PRODUCT_MENTIONS,
  RUN_MODES,
  SECTION_FAIL_REASONS,
  TONES,
  UNAVAILABLE_REASONS,
  VERIFY_KINDS,
} from "../../components/tools/content-draft-codes.ts";
import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";

type Bundle = Record<string, unknown>;

function contentDraft(bundle: unknown): Bundle {
  const tools = (bundle as { tools?: Record<string, unknown> }).tools;
  const node = tools?.["contentDraft"];
  if (typeof node !== "object" || node === null) {
    throw new Error("tools.contentDraft missing from bundle");
  }
  return node as Bundle;
}

function group(bundle: unknown, path: string): Bundle {
  let node: unknown = contentDraft(bundle);
  for (const segment of path.split(".")) {
    node = (node as Bundle)[segment];
    if (typeof node !== "object" || node === null) {
      throw new Error(`tools.contentDraft.${path} missing from bundle`);
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
  ["errors", [...CONTENT_DRAFT_ERROR_CODES, "unknown"]],
  ["sectionFail", SECTION_FAIL_REASONS],
  ["coverageCause", COVERAGE_CAUSES],
  ["coverageStatus", COVERAGE_STATUSES],
  ["verifyKind", VERIFY_KINDS],
  ["verifyKindBody", VERIFY_KINDS],
  ["claims", CLAIM_STATES],
  ["claimsBody", CLAIM_STATES],
  ["modes", RUN_MODES],
  ["modeBody", RUN_MODES],
  ["unavailable", UNAVAILABLE_REASONS],
  ["settings.tone", TONES],
  ["settings.person", PERSONS],
  ["settings.productMention", PRODUCT_MENTIONS],
];

describe("content-draft message coverage", () => {
  for (const [locale, bundle] of LOCALES) {
    for (const [path, codes] of CODE_TABLES) {
      it(`has copy for every ${path} code (${locale})`, () => {
        const node = group(bundle, path);
        for (const code of codes) {
          expect(typeof node[code], `${path}.${code}`).toBe("string");
        }
      });
    }

    it(`keeps the single-source line honest about its one witness (${locale})`, () => {
      // Handoff §8 item 26: the copy says how many competitor pages carry the
      // excerpt, through the parameter, and never hard-codes the count.
      const body = String(group(bundle, "verifyKindBody")["single_source"]);
      expect(body).toContain("{count}");
      expect(body).toMatch(locale === "en" ? /competitor page/ : /竞品页面/);
    });

    it(`explains the two local intake rejections the parser never emits (${locale})`, () => {
      const intake = group(bundle, "intake");
      expect(typeof intake["invalidJson"]).toBe("string");
      expect(typeof intake["handoffExpired"]).toBe("string");
    });

    it(`keeps the bare-keyword refusal in the empty state (${locale})`, () => {
      // Handoff §5.1 / §8 item 20, pinned as a phrase rather than a number.
      expect(String(group(bundle, "empty")["body"])).toMatch(
        locale === "en" ? /does not accept a bare keyword/ : /不接受裸关键词/,
      );
    });

    it(`says the product-mention consequence out loud (${locale})`, () => {
      expect(String(group(bundle, "settings.productMention")["helpThroughout"])).toMatch(
        locale === "en" ? /verify by hand/ : /人工核实/,
      );
    });

    it(`never blames the brief for a server-side draft failure (${locale})`, () => {
      const copy = String(group(bundle, "errors")["draft_unavailable"]);
      expect(copy).toMatch(locale === "en" ? /not about your brief/ : /不是你的 brief 的问题/);
    });
  }

  it("keeps the two locales structurally identical", () => {
    const keysOf = (node: unknown, prefix = ""): string[] => {
      if (typeof node !== "object" || node === null) return [];
      return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => [
        prefix + k,
        ...keysOf(v, `${prefix}${k}.`),
      ]);
    };
    expect(keysOf(contentDraft(en)).sort()).toEqual(keysOf(contentDraft(zh)).sort());
  });
});
