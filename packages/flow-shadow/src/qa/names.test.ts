import { describe, expect, it } from "vitest";
import {
  citationEntry,
  hasCitationCorroboration,
  nameProfile,
  parentheticalCitations,
  stripEmphasis,
} from "./names.ts";

/**
 * The predicate that replaced the list of bibliographic forms.
 *
 * These assertions are written as PAIRS wherever a pair exists, because the
 * failure this file exists to end was never "the detector missed a case" — it
 * was "the detector caught one spelling and missed the neighbouring one". A
 * test that only shows the catches would have passed in every previous rework
 * too.
 */

describe("name phrases", () => {
  it("needs two capitalized tokens: one is the sentence-initial case", () => {
    expect(nameProfile("It tracks activation milestones.").phrases).toEqual([]);
    expect(
      nameProfile("Teams start by naming the milestone that matters.").phrases,
    ).toEqual([]);
    expect(nameProfile("RevOps leads own this work.").phrases).toEqual([]);
    expect(
      nameProfile("Forrester Digital Experience Report").phrases[0],
    ).toStrictEqual({
      value: "Forrester Digital Experience Report",
      tokens: 4,
    });
  });

  it("does not let a capitalized function word open a name", () => {
    // `The RevOps lead who owns activation.` is a sentence, and reading `The
    // RevOps` as a two-token identity would make every sentence-initial `The`
    // the start of an outside authority.
    expect(nameProfile("The RevOps lead who owns activation.").phrases).toEqual(
      [],
    );
  });

  it("ends a name at punctuation and bridges it over a connector", () => {
    expect(
      nameProfile("Forrester, Digital Experience Report").phrases.map(
        (phrase) => phrase.tokens,
      ),
    ).toStrictEqual([3]);
    expect(
      nameProfile("Bureau of Labor Statistics").phrases[0]?.tokens,
    ).toBe(3);
  });

  it("strips emphasis before reading a token", () => {
    expect(stripEmphasis("Forrester's **2024** data")).toBe(
      "Forrester's 2024 data",
    );
    expect(stripEmphasis("snake_case stays")).toBe("snake_case stays");
    expect(stripEmphasis("__bold__ goes")).toBe("bold goes");
  });
});

describe("citation entries", () => {
  /**
   * The escape table, at the predicate level. Every row is the same reference
   * written differently, and the form list caught row ten only.
   */
  it("recognises one reference through every spelling of it", () => {
    for (const entry of [
      "Forrester Digital Experience Report",
      "Forrester, Digital Experience Report",
      "Forrester Digital Experience Report — 2024",
      "Forrester Digital Experience Report, '24",
      "Forrester Digital Experience Report, MMXXIV",
      "2024. Forrester Digital Experience Report",
      'Forrester. "Digital Experience Report." 2024.',
      "Forrester Digital Experience Report, 2024",
    ]) {
      expect(citationEntry(entry), entry).not.toBeNull();
    }
  });

  it("separates a name that is corroborated from one that is only a name", () => {
    expect(citationEntry("Forrester Digital Experience Report, 2024")).toEqual({
      name: "Forrester Digital Experience Report",
      corroborated: true,
    });
    expect(citationEntry("Forrester Digital Experience Report")).toEqual({
      name: "Forrester Digital Experience Report",
      corroborated: false,
    });
  });

  /**
   * The other half. A sentence is not an entry, however many capitals it has,
   * and a two-word title is ordinary B2B section vocabulary.
   */
  it("leaves sentences and short titles alone", () => {
    for (const entry of [
      "It tracks activation milestones.",
      "It separates trial accounts from paid accounts.",
      "Teams that instrument activation once tend to keep the weekly review going.",
      "RevOps leads evaluating onboarding tooling own this work.",
      "Read the onboarding analytics guide.",
      "Activation Rate",
      "Onboarding Guide",
      "Book an onboarding walkthrough",
      "Source | Year",
    ]) {
      expect(citationEntry(entry), entry).toBeNull();
    }
  });

  it("counts a year, an `et al.` and a quoted title as corroboration", () => {
    expect(hasCitationCorroboration("Forrester Report, 2024")).toBe(true);
    expect(hasCitationCorroboration("Smith et al. measured a lift")).toBe(true);
    expect(hasCitationCorroboration('Forrester, "Digital Experience"')).toBe(
      true,
    );
    expect(hasCitationCorroboration("Forrester Digital Report")).toBe(false);
  });
});

describe("parenthetical citations", () => {
  it("reads the bracket as the citation slot", () => {
    for (const sentence of [
      "73% churn (Forrester, 2024).",
      "73% churn (Forrester 2024).",
      "73% churn [Forrester 2024].",
      "42% lift (Smith et al., 2023).",
    ]) {
      expect(parentheticalCitations(sentence), sentence).toHaveLength(1);
    }
  });

  /**
   * The calendar is a CLOSED vocabulary, which is why excluding it is safe in a
   * way that excluding bibliographic forms is not: there is no thirteenth month
   * for a fabricated citation to escape through. `(March 2024)` and
   * `(Forrester, 2024)` are otherwise the same shape, and blocking the first
   * would be the false-accusation failure again.
   */
  it("does not read a date or a prose aside as a citation", () => {
    for (const sentence of [
      "This guide was updated (March 2024).",
      "Revenue grew 12% (Q3 2024).",
      "Revenue grew 12% (FY 2024).",
      "We shipped it (the 2024 rebuild we published).",
      "See the appendix (below).",
    ]) {
      expect(parentheticalCitations(sentence), sentence).toEqual([]);
    }
  });
});
