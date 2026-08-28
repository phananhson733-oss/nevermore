// @input  -- the annotation toggle state and the draft translator
// @output -- the "show claim annotations" switch and the four-state legend
// @pos    -- sits between the coverage card and the document; owns no colour of its own,
//            the legend samples come from content-draft-doc's ClaimSwatch

import { ClaimSwatch } from "./content-draft-doc";
import {
  BODY_TEXT,
  CARD,
  SECTION_TITLE,
  type DraftTranslate,
} from "./content-draft-results-shared";

export const CLAIMS_VISIBLE_STORAGE_KEY = "gengrowth.content-draft.claims.v1";

/** localStorage is a convenience, not a requirement: every read and write is guarded. */
export function readClaimsVisible(): boolean {
  try {
    return window.localStorage.getItem(CLAIMS_VISIBLE_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function storeClaimsVisible(visible: boolean): void {
  try {
    window.localStorage.setItem(
      CLAIMS_VISIBLE_STORAGE_KEY,
      visible ? "on" : "off",
    );
  } catch {
    // A private window or a full store: the toggle still works for this page.
  }
}

export function DraftToolbar({
  annotate,
  onToggle,
  t,
}: {
  readonly annotate: boolean;
  readonly onToggle: (next: boolean) => void;
  readonly t: DraftTranslate;
}) {
  return (
    <section data-draft-toolbar className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className={SECTION_TITLE}>{t("toolbar.legend")}</h3>
        <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] text-text-dark-primary">
          <input
            type="checkbox"
            data-toggle-claims
            checked={annotate}
            onChange={(event) => onToggle(event.target.checked)}
            className="h-4 w-4 accent-brand-accent"
          />
          {t("toolbar.showClaims")}
        </label>
      </div>
      <ul className={`mt-3 grid gap-2 md:grid-cols-2 ${BODY_TEXT}`}>
        <li
          data-legend="bound-third"
          className="flex flex-wrap items-baseline gap-2"
        >
          <ClaimSwatch tone="third">{t("toolbar.boundThird")}</ClaimSwatch>
          <span>{t("claimsBody.bound")}</span>
        </li>
        <li
          data-legend="bound-first"
          className="flex flex-wrap items-baseline gap-2"
        >
          <ClaimSwatch tone="first">{t("toolbar.boundFirst")}</ClaimSwatch>
          <span>{t("claimsBody.bound")}</span>
        </li>
        <li
          data-legend="stance"
          className="flex flex-wrap items-baseline gap-2"
        >
          <ClaimSwatch tone="first">{t("claims.stance")}</ClaimSwatch>
          <span>{t("claimsBody.stance")}</span>
        </li>
        <li data-legend="gap" className="flex flex-wrap items-baseline gap-2">
          <ClaimSwatch tone="gap">{t("claims.gap")}</ClaimSwatch>
          <span>{t("claimsBody.gap")}</span>
        </li>
        <li
          data-legend="no_claim"
          className="flex flex-wrap items-baseline gap-2"
        >
          <ClaimSwatch tone={null}>{t("claims.no_claim")}</ClaimSwatch>
          <span>{t("claimsBody.no_claim")}</span>
        </li>
      </ul>
    </section>
  );
}
