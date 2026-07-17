/**
 * Tiny className combiner. CSS-module lookups are typed `string | undefined`
 * (the project enables `noUncheckedIndexedAccess`), so every consumer needs to
 * drop falsy values before joining. No runtime deps — hand-rolled on purpose.
 */
export type ClassValue = string | false | null | undefined;

export function cx(...values: readonly ClassValue[]): string {
  const parts: string[] = [];
  for (const value of values) {
    if (value) parts.push(value);
  }
  return parts.join(" ");
}
