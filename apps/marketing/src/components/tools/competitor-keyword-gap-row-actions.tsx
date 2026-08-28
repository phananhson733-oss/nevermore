// @input  -- one v3 gap row, the run's market and language, the selected GSC property, the viewer locale, and the table's error sink
// @output -- at most one recommended action per row, plus the private tab-scoped handoff it writes before leaving
// @pos    -- the recommended-action cell of the Marketing competitor gap results table

"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import type {
  CompetitorKeywordGapResultV3,
  CompetitorKeywordGapRow,
} from "@sf/public-tools/competitor-keyword-gap";
// Imported, never restated as a literal here. The floor is frozen by the spec
// the destination owns, and a copy of it on this side would go on offering the
// button for months after the Opportunity Finder moved its own.
import { MIN_QUERY_IMPRESSIONS } from "@sf/public-tools/quick-wins/evidence";

import { localePath } from "../../lib/locale-path";
import {
  TOOL_HANDOFF_LINK_PROPS,
  writeToolHandoff,
  type ToolHandoffPayload,
} from "../../lib/tools/tool-handoff";
import {
  bestCompetitorPageHost,
  bestCompetitorPageUrl,
} from "./competitor-keyword-gap-competitor-pages";
import {
  ACTION_BUTTON,
  ownPagePath,
  PRIMARY_ACTION_BUTTON,
  safePageUrl,
  type Translate,
} from "./competitor-keyword-gap-results-shared";

/**
 * What this row's cell offers, and what it is about to open.
 *
 * The lane decides the verb -- that is GSC's call alone. The label names the
 * OBJECT: the tool it hands off to, the page Search Console attributed to this
 * query, or the competitor host whose page the link opens. Each object is
 * derived from the same value the control acts on, never from a second lookup
 * that could disagree with it.
 *
 * A lane with nothing to open yields null. A button that goes nowhere is worse
 * than no button, and the row is carried by the CSV export either way.
 */
export type RowAction =
  | { readonly kind: "opportunity-finder"; readonly label: string }
  | { readonly kind: "checker"; readonly label: string; readonly page: string }
  | { readonly kind: "page"; readonly label: string; readonly page: string }
  | {
      readonly kind: "competitor";
      readonly label: string;
      readonly href: string;
    }
  | { readonly kind: "focus"; readonly label: string };

/** Stable and bounded; the full keyword remains only in the validated payload. */
export function evidenceIdFor(row: CompetitorKeywordGapRow): string {
  let fingerprint = 0x811c9dc5;
  for (let index = 0; index < row.keyword.length; index += 1) {
    fingerprint ^= row.keyword.charCodeAt(index);
    fingerprint = Math.imul(fingerprint, 0x01000193);
  }
  return `competitor-gap:${(fingerprint >>> 0).toString(16).padStart(8, "0")}:${row.gsc.pageStatus}`;
}

/**
 * A row already near the top of page one is not missing rankings, it is missing
 * clicks -- the one thing the Opportunity Finder measures. It needs a granted
 * property to do anything at all, and the handoff contract rejects an empty
 * one, so with no property selected the row falls through to the page actions
 * rather than offering a control that cannot work.
 *
 * It also needs enough impressions to survive the destination. `observed_strong`
 * asks for ten; the Opportunity Finder drops every query under
 * `MIN_QUERY_IMPRESSIONS` before it builds its evidence table, so a keyword
 * observed at twelve impressions and position 3.2 would arrive at a report that
 * provably cannot show it. Offered on the row's own GSC query impressions --
 * a positive assertion, so a row carrying none fails the floor rather than
 * passing it.
 *
 * Today's report builder never puts an `observed_strong` row in the
 * `optimize_existing` lane -- that lane requires `observed_weak` -- so this is
 * reachable only from `review_existing_query`. It is asked before the lane
 * split anyway: if a later rule routes a strong row into the optimize lane, it
 * must not silently become an On-Page audit of a page that already ranks.
 */
function opportunityFinderOffered(
  row: CompetitorKeywordGapRow,
  selectedProperty: string,
): boolean {
  const impressions = row.gsc.queryImpressions;
  return (
    row.gsc.queryStatus === "observed_strong" &&
    selectedProperty !== "" &&
    impressions !== null &&
    impressions >= MIN_QUERY_IMPRESSIONS
  );
}

export function rowAction(
  row: CompetitorKeywordGapRow,
  selectedProperty: string,
  t: Translate,
): RowAction | null {
  const lane = row.gsc.nextStep;
  if (lane === "verify_own_coverage") {
    return { kind: "focus", label: t("actions.focusProperty") };
  }
  if (lane === "review_content_gap") {
    const href = bestCompetitorPageUrl(row);
    const host = bestCompetitorPageHost(row);
    return href === null || host === null
      ? null
      : {
          kind: "competitor",
          href,
          label: t("actions.openCompetitorPageNamed", { domain: host }),
        };
  }
  if (opportunityFinderOffered(row, selectedProperty)) {
    return {
      kind: "opportunity-finder",
      label: t("actions.openOpportunityFinder"),
    };
  }

  // Both remaining lanes have query-level GSC evidence. What separates them
  // here is whether the page attribution is complete enough, and the property
  // present, to hand the On-Page Checker a page to audit. When it is not, the
  // label says "review": the link only opens the page, it optimizes nothing.
  const page = safePageUrl(row.gsc.pageUrl);
  const path = ownPagePath(row.gsc.pageUrl);
  if (page === null || path === null) return null;
  return lane === "optimize_existing" &&
    selectedProperty !== "" &&
    row.gsc.pageStatus === "observed_sufficient"
    ? {
        kind: "checker",
        page,
        label: t("actions.optimizeObservedPage", { page: path }),
      }
    : {
        kind: "page",
        page,
        label: t("actions.reviewObservedPage", { page: path }),
      };
}

/** Storage itself can be unavailable, which is a browser state, not a defect. */
function stored(payload: ToolHandoffPayload): boolean {
  try {
    return writeToolHandoff(window.sessionStorage, Date.now(), payload);
  } catch {
    return false;
  }
}

interface HandoffLinkProps {
  /** The `data-row-action` this control answers to, and the only id tests use. */
  readonly action: string;
  readonly label: string;
  readonly href: string;
  readonly title?: string;
  readonly payload: ToolHandoffPayload;
  /** Names the destination that failed; one shared message would name the wrong tool. */
  readonly failureMessage: string;
  readonly onActionError: (message: string | null) => void;
}

/**
 * The handoff is written before navigation, and navigation is cancelled when it
 * could not be written: arriving at a destination that reads a property which
 * was never stored looks like the destination lost it.
 *
 * It opens in a new tab because this run is not recoverable. The report is a
 * manual snapshot with `persistence: "none"` -- nothing on the server, nothing
 * in a URL -- so navigating this tab away discards a paid run, and Back returns
 * to an empty form rather than to the table. The competitor and own-page links
 * beside it have opened new tabs all along; these two, which go to our OWN
 * tools, were the ones taking the results with them.
 *
 * `rel="opener"` is deliberate and must not be "corrected" to `noopener`.
 * Session storage is copied into a new tab only when that tab keeps an opener,
 * and every modern browser now applies noopener to `target="_blank"` by
 * default. Measured in Chromium and WebKit: with no rel, and with
 * `noopener noreferrer`, the destination reads `null` from session storage --
 * the handoff arrives empty and the destination looks like it lost the
 * property. Only `rel="opener"` carries it. The destinations are our own
 * same-origin routes, which can already reach this page's document, so the
 * opener reference is not free, and the earlier wording here claimed it was.
 *
 * What the opener costs, stated accurately. Same-origin is a permission, not
 * a reference: without an opener, another tab of ours cannot reach this
 * document at all, so keeping one does hand the destination a Window it would
 * not otherwise have -- it can read and rewrite this page, navigate it, and
 * read its storage. The bound on that is the destination set, which is fixed
 * literals under `/tools/` on our own origin (`locale` is whitelisted against
 * `routing.locales` in the locale layout before any of this renders, so the
 * href cannot become protocol-relative or cross-origin). The exposure is
 * therefore "an XSS on one of our own tool pages also reaches the tab that
 * opened it", which is a real widening and the price of the handoff arriving
 * at all.
 *
 * The external links below keep `noopener noreferrer`: those ARE cross-origin,
 * and they carry no handoff.
 */
function HandoffLink({
  action,
  label,
  href,
  title,
  payload,
  failureMessage,
  onActionError,
}: HandoffLinkProps) {
  function prepare(event: ReactMouseEvent<HTMLAnchorElement>): void {
    if (!stored(payload)) {
      event.preventDefault();
      onActionError(failureMessage);
      return;
    }
    onActionError(null);
  }

  return (
    <a
      data-row-action={action}
      href={href}
      {...TOOL_HANDOFF_LINK_PROPS}
      title={title}
      className={PRIMARY_ACTION_BUTTON}
      onClick={prepare}
    >
      {label}
    </a>
  );
}

function ExternalPageLink({
  action,
  label,
  href,
  title,
  onActionError,
}: {
  readonly action: string;
  readonly label: string;
  readonly href: string;
  readonly title?: string;
  readonly onActionError: (message: string | null) => void;
}) {
  return (
    <a
      data-row-action={action}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className={ACTION_BUTTON}
      onClick={() => onActionError(null)}
    >
      {label}
    </a>
  );
}

export interface RowActionCellProps {
  readonly row: CompetitorKeywordGapRow;
  readonly result: CompetitorKeywordGapResultV3;
  readonly locale: string;
  readonly selectedProperty: string;
  readonly onFocusProperty: () => void;
  readonly onActionError: (message: string | null) => void;
  readonly t: Translate;
}

/**
 * Where a handoff control goes, what it stores, and what it says when storage
 * refuses. The failure message names its own destination: one shared string
 * would tell a visitor the wrong tool had failed.
 */
function handoffPlan(
  props: RowActionCellProps,
  action: Extract<RowAction, { kind: "opportunity-finder" | "checker" }>,
): Omit<HandoffLinkProps, "label" | "onActionError"> {
  const { locale, t } = props;
  return action.kind === "opportunity-finder"
    ? {
        action: "open-opportunity-finder",
        href: localePath(locale, "/tools/seo-quick-wins"),
        payload: quickWinsPayload(props),
        failureMessage: t("actions.handoffFailedOpportunityFinder"),
      }
    : {
        action: "open-checker",
        href: localePath(locale, "/tools/on-page-seo-check"),
        payload: checkerPayload(props, action.page),
        failureMessage: t("actions.handoffFailedOnPage"),
      };
}

export function RowActionCell(props: RowActionCellProps) {
  const { row, selectedProperty, onActionError, t } = props;
  const action = rowAction(row, selectedProperty, t);
  if (action === null) return null;

  // Every title below is `action.page` -- the same string the control audits
  // or opens -- rather than a second derivation from `row.gsc.pageUrl`. Two
  // derivations are how the truncated label came to name a page the link did
  // not open, and a title is the one place the whole URL still fits.
  if (action.kind === "opportunity-finder" || action.kind === "checker") {
    return (
      <HandoffLink
        {...handoffPlan(props, action)}
        label={action.label}
        {...(action.kind === "checker" ? { title: action.page } : {})}
        onActionError={onActionError}
      />
    );
  }

  if (action.kind === "focus") {
    return (
      <button
        type="button"
        data-row-action="focus-property"
        className={ACTION_BUTTON}
        onClick={() => {
          props.onFocusProperty();
          onActionError(null);
        }}
      >
        {action.label}
      </button>
    );
  }

  return (
    <ExternalPageLink
      action={
        action.kind === "page" ? "open-observed-page" : "open-competitor-page"
      }
      label={action.label}
      href={action.kind === "page" ? action.page : action.href}
      // No title on a competitor link: the only URL this row holds is the
      // visitor's own page, and that is not what this control opens.
      {...(action.kind === "page" ? { title: action.page } : {})}
      onActionError={onActionError}
    />
  );
}

/**
 * No query and no page on purpose: the Opportunity Finder consumer selects a
 * granted property and reads nothing else. Carrying the keyword would put a
 * value on the wire that no surface reads, and would suggest the destination
 * had been narrowed to it.
 */
function quickWinsPayload({
  row,
  result,
  selectedProperty,
}: RowActionCellProps): ToolHandoffPayload {
  return {
    source: "competitor-keyword-gap",
    destination: "seo-quick-wins",
    scope: "property",
    property: selectedProperty,
    query: null,
    page: null,
    evidenceId: evidenceIdFor(row),
    marketCode: result.marketCode,
    languageCode: result.languageCode,
  };
}

function checkerPayload(
  { row, result, selectedProperty }: RowActionCellProps,
  page: string,
): ToolHandoffPayload {
  return {
    source: "competitor-keyword-gap",
    destination: "on-page-seo-check",
    scope: "query_page",
    property: selectedProperty,
    query: row.keyword,
    page,
    evidenceId: evidenceIdFor(row),
    marketCode: result.marketCode,
    languageCode: result.languageCode,
  };
}
