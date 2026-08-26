import { describe, expect, it } from "vitest";

import {
  countCompetitorInput,
  parseCompetitorInput,
} from "./competitor-keyword-gap-competitor-input";

describe("parseCompetitorInput", () => {
  it("splits a pasted list on the comma people actually type", () => {
    const parsed = parseCompetitorInput("one.example, two.example,three.example", "acme.example");

    expect(parsed).toEqual({
      ok: true,
      domains: ["one.example", "two.example", "three.example"],
    });
  });

  it("splits on the full-width comma, which is what a Chinese keyboard makes", () => {
    // Not a nicety: this form is used in Chinese, and treating U+FF0C as part
    // of a hostname rejects the whole line with "not a domain".
    const parsed = parseCompetitorInput("one.example，two.example、three.example", "acme.example");

    expect(parsed).toEqual({
      ok: true,
      domains: ["one.example", "two.example", "three.example"],
    });
  });

  it("splits on the separators a spreadsheet paste brings with it", () => {
    const parsed = parseCompetitorInput("one.example\n two.example;\tthree.example", "acme.example");

    expect(parsed).toEqual({
      ok: true,
      domains: ["one.example", "two.example", "three.example"],
    });
  });

  it("normalizes each piece the way a single entry was normalized", () => {
    const parsed = parseCompetitorInput(" HTTPS://WWW.Rival.Example/ , http://Second.Example ", "acme.example");

    expect(parsed).toEqual({
      ok: true,
      domains: ["rival.example", "second.example"],
    });
  });

  it("still refuses a page URL, which pasting a list makes likelier", () => {
    // The shared normalizer takes a DOMAIN and rejects anything carrying a
    // path, and this field now invites pasting whatever was on the clipboard.
    // Pinned so the refusal is a known behaviour rather than a surprise blamed
    // on the new splitting.
    expect(
      parseCompetitorInput("https://rival.example/blog/", "acme.example"),
    ).toEqual({ ok: false, validationKey: "validation.competitorInvalid" });
  });

  it("treats blank input as nothing named, not as an error", () => {
    // An empty field is the ordinary starting state, and "nothing typed yet"
    // is a different message from "that is not a domain". Whether empty is
    // allowed is the caller's question, asked where it can say so.
    expect(parseCompetitorInput("   ", "acme.example")).toEqual({
      ok: true,
      domains: [],
    });
    expect(parseCompetitorInput(" , ，, ", "acme.example")).toEqual({
      ok: true,
      domains: [],
    });
  });

  it("never rewrites what was typed -- it only reads it", () => {
    // The field is the list. A parse that returned a cleaned-up string would
    // invite a caller to write it back into the box under the cursor, which is
    // exactly the shape this replaced.
    const input = "one.example,, two.example ,";
    const before = input;

    parseCompetitorInput(input, "acme.example");

    expect(input).toBe(before);
  });

  it("stops at the first bad piece and adds none of the batch", () => {
    // One validation line means one reason. Accepting three of five and
    // dropping two leaves the visitor to work out which two.
    const parsed = parseCompetitorInput("one.example, not a domain, three.example", "acme.example");

    expect(parsed).toEqual({
      ok: false,
      validationKey: "validation.competitorInvalid",
    });
  });

  it("names the site, the duplicate and the limit separately", () => {
    expect(
      parseCompetitorInput("acme.example", "https://www.acme.example/"),
    ).toEqual({ ok: false, validationKey: "validation.competitorSelf" });

    // A duplicate INSIDE one paste, not just against the existing chips.
    expect(
      parseCompetitorInput("one.example, ONE.example", "acme.example"),
    ).toEqual({ ok: false, validationKey: "validation.competitorDuplicate" });

    expect(
      parseCompetitorInput("a.example, b.example, c.example, d.example, e.example, f.example", "acme.example"),
    ).toEqual({ ok: false, validationKey: "validation.competitorLimit" });
  });

  it("accepts exactly the limit", () => {
    const parsed = parseCompetitorInput("a.example, b.example, c.example, d.example, e.example", "acme.example");

    expect(parsed).toEqual({
      ok: true,
      domains: [
        "a.example",
        "b.example",
        "c.example",
        "d.example",
        "e.example",
      ],
    });
  });
});

describe("countCompetitorInput", () => {
  it("counts the pieces someone typed, not the ones that are valid yet", () => {
    // This feeds the "n / 5" line under a box being typed in. Half a hostname
    // is a competitor mid-sentence, not a competitor that does not count, and
    // a counter that drops back to 2 while you are writing the third reads as
    // the field losing your work.
    expect(countCompetitorInput("one.example, two.example, thi")).toBe(3);
    expect(countCompetitorInput("")).toBe(0);
    expect(countCompetitorInput("   ,  ， ")).toBe(0);
    // A trailing separator is someone about to type the next one.
    expect(countCompetitorInput("one.example,")).toBe(1);
  });
});
