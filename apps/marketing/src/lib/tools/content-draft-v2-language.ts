// @input -- a frozen language tag from a confirmed Brief v2
// @output -- a supported base language and a canonical locale label for model instructions
// @pos -- v2 boundary only; never rewrites the confirmed document or v1 language policy
import { LANGUAGE_NAMES } from "./content-draft-prompts.ts";

export function resolveDraftV2Language(value: string): { readonly code: string; readonly locale: string; readonly name: string } | null {
  try {
    const locale = Intl.getCanonicalLocales(value)[0];
    const code = value.toLowerCase().split("-")[0] ?? "";
    const name = Object.entries(LANGUAGE_NAMES).find(([key]) => key === code)?.[1];
    if (locale === undefined || name === undefined) return null;
    return { code, locale, name };
  } catch { return null; }
}
