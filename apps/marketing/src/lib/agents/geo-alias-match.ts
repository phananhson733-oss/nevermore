// @input  -- a provider answer or a rendered question, plus confirmed brand aliases
// @output -- whether a name appears as a word, and exactly where in the original text
// @pos    -- the one alias matcher the prompt check, the mention check and the snippet share

import { codePointLength } from "./geo-canonical.ts";

/**
 * Shortest alias worth matching, in scripts that separate words with spaces.
 *
 * Below three characters a brand name collides with ordinary words and with
 * every acronym in the answer, and a mention count built on that is noise
 * presented as evidence.
 */
export const GEO_MIN_ALIAS_TOKEN_LENGTH = 3;

/**
 * The same floor for scripts that write without spaces.
 *
 * Two, because a character there carries a whole morpheme rather than a letter:
 * the two code points of a Chinese brand name are as specific as five or six
 * Latin ones, and the three-character floor silently dropped every such name
 * before it was ever compared. A dropped alias is not a near miss - the run is
 * paid for, the answer names the brand, and the report says it was never
 * mentioned.
 */
export const GEO_MIN_DENSE_ALIAS_TOKEN_LENGTH = 2;

/**
 * Scripts whose readers do not put spaces between words.
 *
 * The whole-word rule below asks for a separator on both sides of a match.
 * That rule is what stops "Acme" from matching inside "AcmeCorp", and it is
 * meaningless in a script that never writes the separator: in the same
 * sentence it stops the alias from matching at all. Both properties are real,
 * so the rule applies per edge rather than globally, and an edge that touches
 * one of these scripts does not demand a space that the language does not use.
 *
 * Listed by the property that matters (no inter-word spaces) rather than by
 * region, which is why Hangul is absent - Korean is written with spaces and
 * keeps the stricter rule.
 */
const DENSE_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/** Whether a name is written in a script that needs no separators. */
function isDenseAlias(normalized: string): boolean {
  return DENSE_SCRIPT.test(normalized);
}

/**
 * The same question about a name as the user wrote it.
 *
 * Exported so a report can say what its mention count cannot separate: in a
 * script with no inter-word spaces there is no whole-word rule, so a longer
 * word containing the name is counted as a mention. That is a disclosure, not
 * a refusal - a matcher that declines to look is not more accurate, it just
 * returns nothing.
 */
export function isDenseGeoName(value: string): boolean {
  return isDenseAlias(normalizeAliasForMatch(value));
}

/**
 * Longest mention excerpt the report will carry, in Unicode code points.
 *
 * Bounded because the answer belongs to a third party and the report is not a
 * place to reprint it. Counted in code points rather than UTF-16 units so a
 * window that ends beside an emoji or a CJK extension character does not cut it
 * in half and produce a lone surrogate the fingerprint then refuses.
 */
export const GEO_MAX_MENTION_SNIPPET_CODE_POINTS = 240;

/** Marker written where the excerpt was cut, so a reader can see it was cut. */
export const GEO_SNIPPET_ELLIPSIS = "…";

interface MatchIndex {
  /** Lowercased, letters and digits only, single spaces between runs. */
  readonly normalized: string;
  /**
   * Start offset in the NFC form of the source text, per normalized code unit.
   *
   * One entry per UTF-16 code unit, not per code point. `String.indexOf` and
   * `length` count code units, so an index built per code point desynchronizes
   * the moment an astral character appears: the search would find a match at
   * unit 3 and read the map entry for character 3, which is a different place.
   */
  readonly starts: readonly number[];
  /** End offset (exclusive) in the same NFC form. */
  readonly ends: readonly number[];
}

/**
 * Combining marks count as part of their letter, not as separators.
 *
 * After NFC most of them are gone, but scripts with no precomposed form keep
 * theirs. Treating a mark as a separator would split one visible letter into
 * two "words" and make the whole-word rule meaningless for those names.
 */
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}]/u;

/**
 * Build the comparison form while remembering where every character came from.
 *
 * Punctuation becomes a separator rather than being deleted, so "Acme's" still
 * matches the alias "Acme" while "AcmeCorp" does not: deleting punctuation
 * instead would collapse both into one word and make every brand a substring
 * match of every longer name containing it.
 *
 * The index is the part that is easy to leave out and expensive to add later.
 * Without it the matcher can answer "yes, the name is in there" but cannot say
 * where, and the report's mention excerpt would have to be cut from the
 * normalized text — which is lowercased, stripped of punctuation and no longer
 * the sentence the model actually wrote.
 */
function buildMatchIndex(value: string): MatchIndex {
  // Composition first, and everything downstream refers to this form. Without
  // it the alias "Cafe" matches the answer's decomposed "Cafe\u0301" — which a
  // reader sees as "Café" — and the precomposed alias "Café" fails to match the
  // same visible word. One direction invents a mention, the other loses one.
  const source = value.normalize("NFC");
  let normalized = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;

  for (const character of source) {
    const start = offset;
    const end = offset + character.length;
    offset = end;

    if (WORD_CHARACTER.test(character)) {
      const lowered = character.toLowerCase();
      for (let unit = 0; unit < lowered.length; unit += 1) {
        normalized += lowered[unit];
        starts.push(start);
        ends.push(end);
      }
      continue;
    }
    // One space per run of separators, and only between words: a leading run
    // would shift every offset, and a trailing one would extend the last match.
    if (normalized.length > 0 && !normalized.endsWith(" ")) {
      normalized += " ";
      starts.push(start);
      ends.push(end);
    }
  }

  if (normalized.endsWith(" ")) {
    normalized = normalized.slice(0, -1);
    starts.pop();
    ends.pop();
  }
  return { normalized, starts, ends };
}

/** The comparison form of an alias, with no index needed. */
export function normalizeAliasForMatch(value: string): string {
  return buildMatchIndex(value).normalized;
}

/**
 * Whether the matcher would ever look for this name.
 *
 * Exported so the knowledge base can refuse a name at freeze time instead of
 * discovering it after a paid run. Both sides read the same floors from here;
 * a copy of the rule beside the form is a copy that drifts, and the way it
 * drifts is silent - the form keeps accepting a name the matcher stopped
 * looking for.
 */
export function isMatchableGeoName(value: string): boolean {
  const normalized = normalizeAliasForMatch(value);
  const floor = isDenseAlias(normalized)
    ? GEO_MIN_DENSE_ALIAS_TOKEN_LENGTH
    : GEO_MIN_ALIAS_TOKEN_LENGTH;
  return codePointLength(normalized) >= floor;
}

export interface GeoAliasMatch {
  /** The alias as the user confirmed it, not the normalized form. */
  readonly alias: string;
  /**
   * UTF-16 offsets into `text.normalize("NFC")`, end-exclusive.
   *
   * Into the NFC form rather than the raw string, because matching happens
   * there. {@link geoMentionSnippet} normalizes the same way, so the excerpt it
   * cuts is the passage that actually matched.
   */
  readonly startIndex: number;
  readonly endIndex: number;
}

/**
 * Whether the edge of a match is a place a reader would see one word end.
 *
 * `inside` is the match's own outermost character. A separator always ends a
 * word; so does running off either end of the text. Beyond that the question is
 * script-dependent, and the answer is "yes" as soon as either side of the seam
 * belongs to a script that does not write separators - there is no space to
 * find, and demanding one is how a correct match gets thrown away.
 */
function isWordBoundary(
  haystack: string,
  index: number,
  inside: string | undefined,
): boolean {
  if (index < 0 || index >= haystack.length) return true;
  const outside = haystack[index]!;
  if (outside === " ") return true;
  return DENSE_SCRIPT.test(outside) || (inside !== undefined && DENSE_SCRIPT.test(inside));
}

/**
 * Whether an occurrence is written in a case the alias could have produced.
 *
 * Matching is case-insensitive so that a model writing "ACME" in a heading
 * still counts, and that same folding is what lets the ordinary noun "notion"
 * be reported as the brand Notion, or the question word "Who" as the confirmed
 * competitor WHO. Both of those are the tool's headline number claiming a
 * mention that did not happen.
 *
 * The rule uses the shape the user confirmed, which is the only evidence
 * available about how the name is written:
 *
 * - No cased letters at all (Han, Kana, digits) - nothing to check.
 * - Every cased letter uppercase (an acronym) - the occurrence must be
 *   uppercase too. "WHO" is a brand; "Who" is a question.
 * - Otherwise the alias has some uppercase - the occurrence must keep at least
 *   one. "Notion" and "NOTION" are the company, "notion" is a noun.
 * - Alias written entirely lowercase - the user gave no capital to check
 *   against, so any case matches.
 *
 * What this costs, stated plainly: a model that writes an established brand in
 * all lowercase is no longer counted. That is a real loss of recall, taken
 * because the opposite error is worse here - an inflated mention rate tells a
 * customer they are already visible and that no work is needed, and nothing
 * downstream can detect it. A brand that really is written lowercase can be
 * confirmed that way in the knowledge base, and then matches everything again.
 */
function isCasedLetter(character: string): boolean {
  return character.toLowerCase() !== character.toUpperCase();
}

function caseCompatible(alias: string, occurrence: string): boolean {
  const aliasCased = [...alias.normalize("NFC")].filter(isCasedLetter);
  if (aliasCased.length === 0) return true;

  const occurrenceCased = [...occurrence].filter(isCasedLetter);
  if (occurrenceCased.length === 0) return true;

  const aliasAllUpper = aliasCased.every(
    (character) => character === character.toUpperCase(),
  );
  if (aliasAllUpper) {
    return occurrenceCased.every(
      (character) => character === character.toUpperCase(),
    );
  }

  const aliasHasUpper = aliasCased.some(
    (character) => character === character.toUpperCase(),
  );
  if (!aliasHasUpper) return true;

  return occurrenceCased.some(
    (character) => character === character.toUpperCase(),
  );
}

/**
 * The earliest whole-word alias match, longest alias winning a position tie.
 *
 * Deterministic on both counts. "Earliest" so the excerpt shows the first place
 * a reader would have seen the name; "longest on a tie" so a product called
 * "Acme Analytics" is reported by its full name rather than by the "Acme" that
 * starts at the same offset.
 */
export function findGeoAliasMatch(
  text: string,
  aliases: readonly string[],
): GeoAliasMatch | null {
  const index = buildMatchIndex(text);
  if (index.normalized.length === 0) return null;

  let best: GeoAliasMatch | null = null;
  let bestLength = -1;

  const source = text.normalize("NFC");

  for (const alias of aliases) {
    const needle = normalizeAliasForMatch(alias);
    const floor = isDenseAlias(needle)
      ? GEO_MIN_DENSE_ALIAS_TOKEN_LENGTH
      : GEO_MIN_ALIAS_TOKEN_LENGTH;
    // Code points, not UTF-16 units: a two-character name written in a Han
    // extension block is four units long, and a floor counted in units would
    // let it through while rejecting the two-unit name beside it.
    if (codePointLength(needle) < floor) continue;

    let from = 0;
    for (;;) {
      const at = index.normalized.indexOf(needle, from);
      if (at === -1) break;
      const after = at + needle.length;
      const startIndex = index.starts[at]!;
      const endIndex = index.ends[after - 1]!;
      if (
        isWordBoundary(index.normalized, at - 1, index.normalized[at]) &&
        isWordBoundary(
          index.normalized,
          after,
          index.normalized[after - 1],
        ) &&
        caseCompatible(alias, source.slice(startIndex, endIndex))
      ) {
        if (
          best === null ||
          startIndex < best.startIndex ||
          (startIndex === best.startIndex && needle.length > bestLength)
        ) {
          best = { alias, startIndex, endIndex };
          bestLength = needle.length;
        }
        break;
      }
      from = at + 1;
    }
  }

  return best;
}

/** Whether any confirmed alias appears as a word in the text. */
export function containsGeoAlias(
  text: string,
  aliases: readonly string[],
): boolean {
  return findGeoAliasMatch(text, aliases) !== null;
}

/**
 * A bounded excerpt of the answer centred on the match.
 *
 * Returns `null` when the window would reproduce essentially the whole of a
 * short answer. That case is not an edge case to tidy up: the product's promise
 * is that it keeps bounded evidence rather than a third party's prose, and a
 * "snippet" that is the entire answer breaks that promise while looking like it
 * keeps it. The alias that matched is reported either way, so the observation
 * survives without the text.
 */
export function geoMentionSnippet(
  text: string,
  match: GeoAliasMatch,
  limit: number = GEO_MAX_MENTION_SNIPPET_CODE_POINTS,
): string | null {
  // The same normalization the offsets were computed in.
  const source = text.normalize("NFC");
  const total = codePointLength(source);
  if (total <= limit) return null;

  const prefixPoints = codePointLength(source.slice(0, match.startIndex));
  const matchPoints = codePointLength(
    source.slice(match.startIndex, match.endIndex),
  );
  if (matchPoints >= limit - 2) {
    // An alias longer than the whole budget cannot be centred in it; report the
    // observation without an excerpt rather than showing a truncated name.
    return null;
  }

  // The ellipsis markers are inside the budget, not added to it. A snippet of
  // limit + 2 code points would exceed the bound the contract publishes, and
  // this is the field whose whole promise is that it stays small.
  const body = Math.max(1, limit - 2);
  const context = body - matchPoints;
  const wantedBefore = Math.floor(context / 2);
  const startPoint = Math.max(
    0,
    Math.min(prefixPoints - wantedBefore, total - body),
  );
  const endPoint = Math.min(total, startPoint + body);

  const characters = [...source];
  const excerpt = characters.slice(startPoint, endPoint).join("");
  const head = startPoint > 0 ? GEO_SNIPPET_ELLIPSIS : "";
  const tail = endPoint < total ? GEO_SNIPPET_ELLIPSIS : "";
  return `${head}${excerpt}${tail}`;
}
