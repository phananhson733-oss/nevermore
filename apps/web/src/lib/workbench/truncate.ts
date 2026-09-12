/**
 * Cut a string to at most `max` UTF-16 code units without splitting a
 * surrogate pair. `String.prototype.slice` counts code units, so a cut at
 * `max` can land between the two halves of a character outside the BMP
 * (`𠮷`, most emoji) and leave a lone high surrogate behind: JSON keeps it,
 * so it survives persistence, but a `Blob` turns it into U+FFFD in every
 * download. When the cut would split a pair, back off by one unit.
 */
export function truncateUtf16(value: string, max: number): string {
  if (value.length <= max) return value;
  const high = value.charCodeAt(max - 1);
  const low = value.charCodeAt(max);
  const splitsPair = high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
  return value.slice(0, splitsPair ? max - 1 : max);
}
