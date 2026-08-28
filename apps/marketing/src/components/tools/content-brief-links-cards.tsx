// @input  -- one ContentBrief's internal_links / do_not_cover fields and its GSC page ledger
// @output -- two cards whose every URL is resolved from evidence.gsc_pages by page_ref
// @pos    -- the model may only cite pages the ledger holds; a reference it invents
//            renders as "not in the ledger", never as a URL

import type {
  ContentBrief,
  Provenance,
  UnavailableReason,
} from "@sf/public-tools/content-brief/contract";
import {
  DO_NOT_COVER_CAP,
  INTERNAL_LINKS_CAP,
} from "@sf/public-tools/content-brief/constants";

import {
  BODY_TEXT,
  CARD,
  DATA_CHIP,
  ID_CHIP,
  SECTION_TITLE,
  chipTone,
  gscPage,
  number,
  pagePath,
  reasonCopy,
  safePageUrl,
  type Translate,
} from "./content-brief-results-shared";
import { SourceChip } from "./content-brief-source-chip";

interface LinkRow {
  readonly ref: string;
  readonly text: string;
  readonly provenance: Provenance;
}

type LinksView =
  | { readonly status: "unavailable"; readonly reason: UnavailableReason }
  | { readonly status: "available"; readonly rows: readonly LinkRow[] };

function PageRef({
  brief,
  pageRef,
  locale,
  t,
}: {
  readonly brief: ContentBrief;
  readonly pageRef: string;
  readonly locale: string;
  readonly t: Translate;
}) {
  const page = gscPage(brief, pageRef);
  if (page === null) {
    return (
      <span
        data-page-ref-missing={pageRef}
        className="text-[12px] text-brand-warning"
      >
        {t("links.pageMissing", { ref: pageRef })}
      </span>
    );
  }
  const href = safePageUrl(page.page);
  const label = pagePath(page.page) ?? page.page;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className={ID_CHIP}>{page.id}</span>
      {href === null ? (
        <span className="break-all font-mono text-[12px] text-text-dark-primary">
          {label}
        </span>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all font-mono text-[12px] text-text-dark-primary underline-offset-2 hover:underline"
        >
          {label}
        </a>
      )}
      <span className={`${DATA_CHIP} ${chipTone("neutral")}`}>
        {t("links.pageMetrics", {
          impressions: number(page.impressions, locale),
          clicks: number(page.clicks, locale),
        })}
      </span>
    </span>
  );
}

function LinksCard({
  name,
  title,
  view,
  cap,
  brief,
  locale,
  t,
}: {
  readonly name: "internal-links" | "do-not-cover";
  readonly title: string;
  readonly view: LinksView;
  readonly cap: number;
  readonly brief: ContentBrief;
  readonly locale: string;
  readonly t: Translate;
}) {
  if (view.status === "unavailable") {
    return (
      <section
        data-links-card={name}
        data-field-status="unavailable"
        className={CARD}
      >
        <h3 className={SECTION_TITLE}>{title}</h3>
        <p
          data-unavailable-reason={view.reason}
          className={`mt-3 ${BODY_TEXT}`}
        >
          {reasonCopy(t, "links.reason", view.reason, { cap })}
        </p>
      </section>
    );
  }
  const gsc = brief.run.reads.gsc;
  return (
    <section
      data-links-card={name}
      data-field-status="available"
      className={CARD}
    >
      <h3 className={SECTION_TITLE}>{title}</h3>
      {/* The ledger the model may cite is the top GSC_PAGE_ROWS_MAX pages by
          impressions out of every page row the read returned; both numbers
          print, the denominator from run.reads.gsc.rows.page. */}
      {gsc.status !== "unavailable" ? (
        <p data-links-ledger className={`mt-1 ${BODY_TEXT} font-mono text-[11.5px]`}>
          {t("links.ledger", {
            ledger: number(brief.evidence.gsc_pages.length, locale),
            available: number(gsc.rows.page, locale),
          })}
        </p>
      ) : null}
      {view.rows.length === 0 ? (
        <p data-links-empty className={`mt-3 ${BODY_TEXT}`}>
          {t("links.empty")}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {view.rows.map((row) => (
            <li
              key={`${row.ref}:${row.text}`}
              data-links-item={row.ref}
              className="rounded-[10px] border border-brand-border-card bg-brand-bg p-3"
            >
              <PageRef brief={brief} pageRef={row.ref} locale={locale} t={t} />
              <p className={`mt-2 ${BODY_TEXT}`}>{row.text}</p>
              <div className="mt-2">
                <SourceChip provenance={row.provenance} t={t} locale={locale} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function internalLinksView(brief: ContentBrief): LinksView {
  const field = brief.internal_links;
  if (field.status === "unavailable") {
    return { status: "unavailable", reason: field.reason };
  }
  return {
    status: "available",
    rows: field.items.map((item) => ({
      ref: item.page_ref,
      text: item.why,
      provenance: item.why_provenance,
    })),
  };
}

function doNotCoverView(brief: ContentBrief): LinksView {
  const field = brief.do_not_cover;
  if (field.status === "unavailable") {
    return { status: "unavailable", reason: field.reason };
  }
  return {
    status: "available",
    rows: field.items.map((item) => ({
      ref: item.page_ref,
      text: item.topic,
      provenance: item.topic_provenance,
    })),
  };
}

export function LinksCards({
  brief,
  locale,
  t,
}: {
  readonly brief: ContentBrief;
  readonly locale: string;
  readonly t: Translate;
}) {
  return (
    <div data-links-cards className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <LinksCard
        name="internal-links"
        title={t("links.internalTitle")}
        view={internalLinksView(brief)}
        cap={INTERNAL_LINKS_CAP}
        brief={brief}
        locale={locale}
        t={t}
      />
      <LinksCard
        name="do-not-cover"
        title={t("links.doNotCoverTitle")}
        view={doNotCoverView(brief)}
        cap={DO_NOT_COVER_CAP}
        brief={brief}
        locale={locale}
        t={t}
      />
    </div>
  );
}
