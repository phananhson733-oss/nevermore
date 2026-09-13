import { describe, expect, it } from "vitest";
import type { KeywordRow, Profile, PromptKind } from "../types.ts";
import { AI_PATTERNS, PATTERNS, buildRows } from "./keywords.ts";
import { localPromptSet } from "./visibility.ts";

/** Kinds of the geo rows localPromptSet takes from the keyword matrix: found by re-making each template, never by sniffing the text. */

type PromptProfile = Pick<
  Profile,
  "brand" | "positioning" | "features" | "competitors"
>;

const profileOf = (fields: Partial<PromptProfile>): PromptProfile =>
  Object.freeze({
    brand: "",
    positioning: "",
    features: "",
    competitors: "",
    ...fields,
  });

const questions = (seeds: readonly { readonly q: string }[]) =>
  seeds.map((s) => s.q);

function geoRowOf(rows: readonly KeywordRow[], q: string): KeywordRow {
  const row = rows.find((r) => r.engine === "geo" && r.q === q);
  if (row === undefined) throw new Error(`no geo row "${q}"`);
  return row;
}

/** The kind localPromptSet gives one row, asked last after the profile's own templates. */
const kindOfRow = (row: KeywordRow, brand = "Acme") =>
  localPromptSet(profileOf({ brand }), [row]).at(-1);

const ROWS = Object.freeze(
  buildRows(["seo"], { brand: "Acme", competitors: "" }, []),
);
const BY_TEMPLATE: ReadonlyMap<string, PromptKind> = new Map([
  ["which seo tool works best for a small team?", "compare"],
  ["what should I look for in a seo tool?", "discover"],
  ["is Acme good for seo?", "verify"],
]);
/** `what is ${seed}` is PATTERNS[5], the only geo-only keyword template: a definition question, so discover. */
const EVERY_GEO_ROW: ReadonlyMap<string, PromptKind> = new Map([
  ...BY_TEMPLATE,
  ["what is seo", "discover"],
]);

describe("localPromptSet: geo rows", () => {
  it("has one kind per AI template (a new template needs a kind)", () => {
    expect(AI_PATTERNS).toHaveLength(BY_TEMPLATE.size);
  });

  it("has exactly one geo-only keyword template, the definition question at PATTERNS[5] (a new one needs a kind)", () => {
    const geoOnly = PATTERNS.flatMap((pattern, index) =>
      pattern.engine === "geo" ? [[index, pattern.make("x")]] : [],
    );
    expect(geoOnly).toEqual([[5, "what is x"]]);
  });

  it("knows every geo row buildRows makes for one seed", () => {
    const geo = ROWS.filter((r) => r.engine === "geo").map((r) => r.q);
    expect(new Set(geo)).toEqual(new Set(EVERY_GEO_ROW.keys()));
  });

  it.each([...EVERY_GEO_ROW])("maps %s to %s", (q, kind) => {
    expect(kindOfRow(geoRowOf(ROWS, q))).toEqual({ q, kind });
  });

  it("maps by template, not by the row's position in score order, and takes the first two geo rows", () => {
    const firstTwo = ROWS.filter((r) => r.engine === "geo")
      .slice(0, 2)
      .map((r) => r.q);
    const seeds = localPromptSet(profileOf({ brand: "Acme" }), ROWS);
    expect(seeds.slice(-2)).toEqual(
      firstTwo.map((q) => ({ q, kind: EVERY_GEO_ROW.get(q) })),
    );
  });

  it("maps every geo row buildRows keeps for a blank brand", () => {
    const rows = buildRows(["seo"], { brand: "", competitors: "" }, []);
    const geo = rows.filter((r) => r.engine === "geo");
    expect(geo).toHaveLength(3);
    const seeds = [0, 2].flatMap((start) =>
      localPromptSet(profileOf({}), geo.slice(start, start + 2)),
    );
    expect(new Map(seeds.map((s) => [s.q, s.kind]))).toEqual(
      new Map([
        ["which seo tool works best for a small team?", "compare"],
        ["what should I look for in a seo tool?", "discover"],
        ["what is seo", "discover"],
      ]),
    );
  });

  it("dedupes by normQ, keeping the first spelling", () => {
    const upper = buildRows(["SEO"], { brand: "Acme", competitors: "" }, []);
    const seeds = localPromptSet(profileOf({ brand: "Acme" }), [
      geoRowOf(upper, "which SEO tool works best for a small team?"),
      geoRowOf(ROWS, "which seo tool works best for a small team?"),
    ]);
    const matching = questions(seeds).filter((q) => /which seo tool/i.test(q));
    expect(matching).toEqual(["which SEO tool works best for a small team?"]);
  });
});

describe("localPromptSet: geo rows no template reproduces", () => {
  it("falls back to scenario for a row built for a different brand", () => {
    const stale = buildRows(["seo"], { brand: "Old", competitors: "" }, []);
    expect(kindOfRow(geoRowOf(stale, "is Old good for seo?"))).toEqual({
      q: "is Old good for seo?",
      kind: "scenario",
    });
  });

  it("still labels a different brand's definition row discover: that template names no brand", () => {
    const stale = buildRows(["seo"], { brand: "Old", competitors: "" }, []);
    expect(kindOfRow(geoRowOf(stale, "what is seo"))).toEqual({
      q: "what is seo",
      kind: "discover",
    });
  });

  it.each(["what is Acme", "What is SEO pricing", "what is a seo tool"])(
    "does not sniff the text: %s is not its seed's definition question",
    (q) => {
      const row = { ...geoRowOf(ROWS, "what is seo"), q };
      expect(kindOfRow(row)).toEqual({ q, kind: "scenario" });
    },
  );

  it("compares templates by normQ, so a brand with a double space keeps its verify row", () => {
    const rows = buildRows(["seo"], { brand: "Ac  me", competitors: "" }, []);
    expect(kindOfRow(geoRowOf(rows, "is Ac  me good for seo?"), "Ac  me")).toEqual(
      { q: "is Ac me good for seo?", kind: "verify" },
    );
  });
});
