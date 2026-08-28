// @input  -- one contract Provenance and the tool translator
// @output -- the chip that names where a value came from, coloured by source layer
// @pos    -- the ONE component outside evidence-coverage / outline-list allowed to
//            reference the --sc-source-* tokens (app/source-tokens.test.ts)

import type {
  Origin,
  Provenance,
} from "@sf/public-tools/content-brief/contract";

import { joinList, translated, type Translate } from "./content-brief-results-shared";

export type SourceTone = "first" | "third" | "model";

/**
 * Colour looks at exactly one layer.
 *
 * `method: "model"` is the model colour whatever it was derived from; anything
 * else is coloured by its origin -- first-party for Search Console, the
 * product profile and the visitor's own input, third-party for the SERP
 * provider and the competitor pages. A heuristic carries no colour of its own:
 * a rule applied to third-party data is still third-party data.
 */
export function sourceTone(provenance: Provenance): SourceTone {
  if (provenance.method === "model") return "model";
  return originTone(provenance.origin);
}

export function originTone(origin: Origin): Exclude<SourceTone, "model"> {
  switch (origin) {
    case "gsc":
    case "product_profile":
    case "user_input":
      return "first";
    case "dataforseo_serp":
    case "crawl":
      return "third";
  }
}

const TONE_CLASS: Readonly<Record<SourceTone, string>> = {
  first: "border-source-first/40 bg-source-first/[0.10] text-source-first",
  third: "border-source-third/40 bg-source-third/[0.10] text-source-third",
  model: "border-source-model/40 bg-source-model/[0.10] text-source-model",
};

/**
 * Wraps instead of truncating. The chip's whole job is to say where a value
 * came from; a derived-from list cut to "model-generated · derived from…"
 * with the rest in a tooltip says it only to a mouse.
 */
const CHIP =
  "inline-flex max-w-full items-start gap-1 rounded-full border px-2 py-[3px] font-mono text-[10.5px] leading-[1.4] tracking-[0.03em] whitespace-normal break-words";

export function sourceLabel(
  provenance: Provenance,
  t: Translate,
  locale: string,
): string {
  if (provenance.method === "model") {
    const origins = provenance.derived_from.map((origin) =>
      translated(t, `sources.origins.${origin}`),
    );
    return origins.length === 0
      ? t("sources.model")
      : `${t("sources.model")} · ${t("sources.derivedFrom", {
          origins: joinList(origins, locale),
        })}`;
  }
  return `${translated(t, `sources.methods.${provenance.method}`)} · ${translated(
    t,
    `sources.origins.${provenance.origin}`,
  )}`;
}

export function SourceChip({
  provenance,
  t,
  locale,
}: {
  readonly provenance: Provenance;
  readonly t: Translate;
  readonly locale: string;
}) {
  const tone = sourceTone(provenance);
  const label = sourceLabel(provenance, t, locale);
  return (
    <span
      data-source-chip
      data-source-tone={tone}
      data-source-method={provenance.method}
      className={`${CHIP} ${TONE_CLASS[tone]}`}
    >
      <span className="min-w-0">{label}</span>
    </span>
  );
}

/** The bare layer badge ("first-party" / "third-party" / "model-generated") for legends. */
export function SourceLayerBadge({
  tone,
  t,
}: {
  readonly tone: SourceTone;
  readonly t: Translate;
}) {
  return (
    <span
      data-source-layer={tone}
      className={`${CHIP} ${TONE_CLASS[tone]}`}
    >
      {t(`sources.${tone}`)}
    </span>
  );
}
