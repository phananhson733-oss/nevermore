import { describe, expect, it } from "vitest";

import { parseCompetitorInput } from "./competitor-keyword-gap-competitor-input";

const NONE: readonly string[] = [];

describe("parseCompetitorInput", () => {
  it("splits a pasted list on the comma people actually type", () => {
    const parsed = parseCompetitorInput(
      "one.example, two.example,three.example",
      NONE,
      "acme.example",
    );

    expect(parsed).toEqual({
      ok: true,
      domains: ["one.example", "two.example", "three.example"],
    });
  });

  it("splits on the full-width comma, which is what a Chinese keyboard makes", () => {
    // Not a nicety: this form is used in Chinese, and treating U+FF0C as part
    // of a hostname rejects the whole line with "not a domain".
    const parsed = parseCompetitorInput(
      "one.example，two.example、three.example",
      NONE,
      "acme.example",
    );

    expect(parsed).toEqual({
      ok: true,
      domains: ["one.example", "two.example", "three.example"],
    });
  });

  it("splits on the separators a spreadsheet paste brings with it", () => {
    const parsed = parseCompetitorInput(
      "one.example\n two.example;\tthree.example",
      NONE,
      "acme.example",
    );

    expect(parsed).toEqual({
      ok: true,
      domains: ["one.example", "two.example", "three.example"],
    });
  });

  it("normalizes each piece the way a single entry was normalized", () => {
    const parsed = parseCompetitorInput(
      " HTTPS://WWW.Rival.Example/ , http://Second.Example ",
      NONE,
      "acme.example",
    );

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
      parseCompetitorInput(
        "https://rival.example/blog/",
        NONE,
        "acme.example",
      ),
    ).toEqual({ ok: false, validationKey: "validation.competitorInvalid" });
  });

  it("adds to what is already accepted rather than replacing it", () => {
    const parsed = parseCompetitorInput(
      "two.example",
      ["one.example"],
      "acme.example",
    );

    expect(parsed).toEqual({ ok: true, domains: ["one.example", "two.example"] });
  });

  it("treats blank input as nothing to do, not as an error", () => {
    // The ordinary state of this field once the chips exist. Blur, enter and
    // submit all reach here with nothing pending and none of them is a mistake.
    expect(parseCompetitorInput("   ", ["one.example"], "acme.example")).toEqual(
      { ok: true, domains: ["one.example"] },
    );
    expect(parseCompetitorInput(" , ,, ", NONE, "acme.example")).toEqual({
      ok: true,
      domains: [],
    });
  });

  it("stops at the first bad piece and adds none of the batch", () => {
    // One validation line means one reason. Accepting three of five and
    // dropping two leaves the visitor to work out which two.
    const parsed = parseCompetitorInput(
      "one.example, not a domain, three.example",
      NONE,
      "acme.example",
    );

    expect(parsed).toEqual({
      ok: false,
      validationKey: "validation.competitorInvalid",
    });
  });

  it("names the site, the duplicate and the limit separately", () => {
    expect(
      parseCompetitorInput("acme.example", NONE, "https://www.acme.example/"),
    ).toEqual({ ok: false, validationKey: "validation.competitorSelf" });

    expect(
      parseCompetitorInput("one.example", ["one.example"], "acme.example"),
    ).toEqual({ ok: false, validationKey: "validation.competitorDuplicate" });

    // A duplicate INSIDE one paste, not just against the existing chips.
    expect(
      parseCompetitorInput("one.example, ONE.example", NONE, "acme.example"),
    ).toEqual({ ok: false, validationKey: "validation.competitorDuplicate" });

    expect(
      parseCompetitorInput(
        "a.example, b.example, c.example, d.example, e.example, f.example",
        NONE,
        "acme.example",
      ),
    ).toEqual({ ok: false, validationKey: "validation.competitorLimit" });
  });

  it("accepts exactly the limit", () => {
    const parsed = parseCompetitorInput(
      "a.example, b.example, c.example, d.example, e.example",
      NONE,
      "acme.example",
    );

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
