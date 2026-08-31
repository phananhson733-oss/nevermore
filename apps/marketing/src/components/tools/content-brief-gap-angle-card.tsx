// @input  -- one ContentBrief's gap_angle field, its product-profile read, and the ledger
// @output -- the angle with closed cited-fact/source details, or the visible failure
//            reason; nothing at all when it was not requested
// @pos    -- the one section of the brief that reads the visitor's own product profile

import type { ContentBrief } from "@sf/public-tools/content-brief/contract";

import {
  BODY_TEXT,
  CARD,
  DATA_CHIP,
  ID_CHIP,
  SECTION_TITLE,
  chipTone,
  crawlCounts,
  profileFact,
  reasonCopy,
  translated,
  type Translate,
} from "./content-brief-results-shared";
import { SourceChip, SourceLayerBadge, sourceTone } from "./content-brief-source-chip";

/**
 * Why the section disappears for `not_requested` and for nothing else.
 *
 * Not choosing a profile is a decision the form explained before the run: no
 * profile, no gap angle, rather than a model inventing a selling point. Every
 * other reason is something the visitor asked for and did not get, and a
 * section that vanishes silently is the "unavailable rendered as nothing"
 * this contract forbids.
 */
export function GapAngleCard({
  brief,
  locale,
  t,
}: {
  readonly brief: ContentBrief;
  readonly locale: string;
  readonly t: Translate;
}) {
  const field = brief.gap_angle;
  const profile = brief.run.reads.product_profile;
  // The total comes from run.reads, not from the field's own list: the parser
  // pins the two equal, and the page prints the run's count so a copy that
  // drifted would show up as a mismatch rather than pass as the denominator.
  const observed = crawlCounts(brief)?.observed ?? null;
  if (field.status === "unavailable" && field.reason === "not_requested") {
    return null;
  }
  if (field.status === "unavailable") {
    // The profile read failing is the cause the visitor can act on ("confirm
    // the profile"), so its reason wins over the field's own when both apply.
    const fromProfile =
      profile.status === "unavailable" && profile.reason !== "not_requested";
    const reason = fromProfile ? profile.reason : field.reason;
    return (
      <section data-gap-angle data-field-status="unavailable" className={CARD}>
        <h3 className={SECTION_TITLE}>{t("gapAngle.title")}</h3>
        <p
          data-unavailable-reason={reason}
          data-unavailable-source={fromProfile ? "product_profile" : "gap_angle"}
          className={`mt-3 ${BODY_TEXT}`}
        >
          {reasonCopy(
            t,
            fromProfile ? "gapAngle.profileReason" : "gapAngle.reason",
            reason,
          )}
        </p>
      </section>
    );
  }
  return (
    <section data-gap-angle data-field-status="available" className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={SECTION_TITLE}>{t("gapAngle.title")}</h3>
        <SourceLayerBadge tone={sourceTone(field.provenance)} t={t} />
      </div>
      <p data-gap-angle-value className="mt-3 text-[15px] font-semibold leading-[1.45] text-text-dark-primary">
        {field.value}
      </p>
      <div className="mt-2">
        <span className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
          {t("gapAngle.rationale")}
        </span>
        <p className={`mt-1 ${BODY_TEXT}`}>{field.rationale}</p>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-[12px] text-text-dark-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent">
          {t("gapAngle.refs")}
        </summary>
        <div className="mt-2">
          <SourceChip provenance={field.provenance} t={t} locale={locale} />
        </div>
        <ul className="mt-2 space-y-1.5">
          {field.profile_fact_refs.map((ref) => {
            const fact = profileFact(brief, ref);
            return (
              <li key={ref} data-profile-fact={ref} className="rounded-[8px] bg-brand-bg px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={ID_CHIP}>{ref}</span>
                  {fact !== null ? (
                    <>
                      <span className="font-mono text-[10.5px] text-text-dark-secondary">
                        {fact.field}
                      </span>
                      <span
                        data-derivation={fact.derivation}
                        className={`${DATA_CHIP} ${chipTone(fact.derivation === "inferred" ? "caution" : "muted")}`}
                      >
                        {translated(t, `derivation.${fact.derivation}`)}
                      </span>
                      <SourceChip provenance={fact.provenance} t={t} locale={locale} />
                    </>
                  ) : null}
                </div>
                {fact !== null ? (
                  <p className={`mt-1 ${BODY_TEXT}`}>{fact.text}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </details>
      <p data-checked-against className={`mt-3 ${BODY_TEXT} font-mono text-[11.5px]`}>
        {observed === null || observed === field.checked_against.length
          ? t("gapAngle.checkedAgainst", { count: observed ?? field.checked_against.length })
          : t("gapAngle.checkedAgainstMismatch", {
              reported: field.checked_against.length,
              count: observed,
            })}
      </p>
    </section>
  );
}
