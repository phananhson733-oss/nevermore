// @input  -- a provider answer or a rendered question, plus confirmed brand aliases
// @output -- whether a name appears as a word, and exactly where in the original text
// @pos    -- the one alias matcher the prompt check, the mention check and the snippet share

import { codePointLength } from "./geo-canonical.ts";

/**
 * Shortest alias worth matching.
 *
 * Below three characters a brand name collides with ordinary words and with
 * every acronym in the answer, and a mention count built on that is noise
 * presented as evidence.
 */
export const GEO_MIN_ALIAS_TOKEN_LENGTH = 3;

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

function isWordBoundary(haystack: string, index: number): boolean {
  return index < 0 || index >= haystack.length || haystack[index] === " ";
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

  for (const alias of aliases) {
    const needle = normalizeAliasForMatch(alias);
    if (needle.length < GEO_MIN_ALIAS_TOKEN_LENGTH) continue;

    let from = 0;
    for (;;) {
      const at = index.normalized.indexOf(needle, from);
      if (at === -1) break;
      const after = at + needle.length;
      if (
        isWordBoundary(index.normalized, at - 1) &&
        isWordBoundary(index.normalized, after)
      ) {
        const startIndex = index.starts[at]!;
        const endIndex = index.ends[after - 1]!;
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
