// @input  -- every closed-code array content-draft-codes.ts exports, and both message bundles
// @output -- a failing test when any code the draft surface can render has no copy of its own
//            in either locale, when a code array has no copy table at all, or when the two
//            locales disagree on a message's ICU placeholders
// @pos    -- handoff §2 rule 4 / §8 item 35 for tools.contentDraft: the server sends codes, the
//            copy lives here, and this is the guard between "type-checks" and "renders a key path"
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import * as codes from "../../components/tools/content-draft-codes.ts";
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

/**
 * Each closed-code array and the message table(s) that render it. Every
 * array the codebook exports must appear here at least once; the guard below
 * walks the module's exports so a new array cannot be added without a table.
 */
const CODE_TABLES: readonly (readonly [string, readonly string[]])[] = [
  ["errors", [...codes.CONTENT_DRAFT_ERROR_CODES, "unknown"]],
  ["errorsWithRetry", codes.RETRY_AFTER_ERROR_CODES],
  ["sectionFail", codes.SECTION_FAIL_REASONS],
  ["coverageCause", codes.COVERAGE_CAUSES],
  ["coverageStatus", codes.COVERAGE_STATUSES],
  ["verifyKind", codes.VERIFY_KINDS],
  ["verifyKindBody", codes.VERIFY_KINDS],
  ["claims", codes.CLAIM_STATES],
  ["claimsBody", codes.CLAIM_STATES],
  ["modes", codes.RUN_MODES],
  ["modeBody", codes.RUN_MODES],
  ["unavailable", codes.UNAVAILABLE_REASONS],
  ["settings.tone", codes.TONES],
  ["settings.person", codes.PERSONS],
  ["settings.productMention", codes.PRODUCT_MENTIONS],
];

/**
 * Every ICU argument a message names: `{name}` and `{name, plural, ...}`.
 * A plural branch's literal text (`{no gaps}`) is not an argument and is
 * skipped because its first word is followed by neither `,` nor `}`.
 */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,}]/g)].map((match) => match[1] ?? "").sort();
}

function leaves(node: unknown, prefix = ""): [string, string][] {
  if (typeof node === "string") return [[prefix, node]];
  if (typeof node !== "object" || node === null) return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leaves(value, prefix === "" ? key : `${prefix}.${key}`),
  );
}

describe("content-draft message coverage", () => {
  it("has a copy table for every closed-code array the codebook exports", () => {
    const tabled = new Set<unknown>(CODE_TABLES.map(([, array]) => array));
    const exportedArrays = Object.entries(codes).filter(([, value]) => Array.isArray(value));
    expect(exportedArrays.length).toBeGreaterThanOrEqual(12);
    for (const [name, array] of exportedArrays) {
      // CONTENT_DRAFT_ERROR_CODES is tabled through its spread copy.
      const covered = tabled.has(array) || name === "CONTENT_DRAFT_ERROR_CODES";
      expect(covered, `${name} has no copy table`).toBe(true);
    }
  });

  for (const [locale, bundle] of LOCALES) {
    for (const [path, codeList] of CODE_TABLES) {
      it(`has its own copy for every ${path} code (${locale})`, () => {
        const node = group(bundle, path);
        for (const code of codeList) {
          expect(Object.hasOwn(node, code), `${path}.${code}`).toBe(true);
          expect(typeof node[code], `${path}.${code}`).toBe("string");
          expect(String(node[code]).trim(), `${path}.${code} is blank`).not.toBe("");
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

    it(`prints Retry-After through {seconds} and never invents a root cause for a large body (${locale})`, () => {
      const retry = group(bundle, "errorsWithRetry");
      for (const code of codes.RETRY_AFTER_ERROR_CODES) {
        expect(String(retry[code])).toContain("{seconds}");
      }
      const tooLarge = String(group(bundle, "errors")["payload_too_large"]);
      expect(tooLarge).toContain("{kb}");
      expect(tooLarge).not.toMatch(locale === "en" ? /brief and settings/ : /brief 与设置/);
      // validation_failed covers shape and size failures too, not only references.
      expect(String(group(bundle, "sectionFail")["validation_failed"])).toMatch(
        locale === "en" ? /structural or evidence-reference/ : /结构或证据引用/,
      );
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

  it("names the same ICU placeholders in both locales for every message", () => {
    const enLeaves = new Map(leaves(contentDraft(en)));
    const zhLeaves = new Map(leaves(contentDraft(zh)));
    expect([...zhLeaves.keys()].sort()).toEqual([...enLeaves.keys()].sort());
    const mismatched = [...enLeaves]
      .filter(([key, message]) => {
        const other = zhLeaves.get(key) ?? "";
        return placeholders(message).join(",") !== placeholders(other).join(",");
      })
      .map(([key, message]) => `${key}: en {${placeholders(message).join(",")}} zh {${placeholders(zhLeaves.get(key) ?? "").join(",")}}`);
    expect(mismatched).toEqual([]);
  });
});
