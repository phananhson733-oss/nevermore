"use client";

import { Fragment, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type {
  AiDoc,
  CrawlSignals,
  GscRow,
  GscRowsSource,
  GscSignals,
  IcpSegment,
  ProfileDoc,
} from "@/lib/workbench/types";
import { cn } from "../../ui/cn.ts";
import { DemoChip } from "../../ui/DemoChip.tsx";
import { PANEL_TITLE, SECTION_RULE } from "../../ui/panel.ts";
import { UNKNOWN_TEXT, statValue } from "../../ui/stat-format.ts";

/**
 * The "profile" tab: a snapshot read out as sections (plan Task 9 Step 5;
 * outward form `ref:opengengrowth/views/SiteProfileView.tsx:192-305`, behaviour
 * jsx:1244-1306).
 *
 * - A section whose signals are `null` is left out whole, its metrics with it:
 *   an absent estimate is not a row of zeros.
 * - Counts go through `statValue`: unknown is an em dash (titled "unknown"),
 *   0 stays 0. Brand and non-brand clicks are two rows, so no "63 / " half
 *   sentence can appear when one of them is unknown (jsx P7).
 * - Page count and indexable are labelled "sample pages" / "indexable" (jsx
 *   P5 / P6): the crawl never happened, and "indexed" is a claim about a search
 *   engine nobody asked.
 * - Crawl and third-party numbers are always generated, so both carry the
 *   sample chip. The GSC section's label comes from the snapshot's frozen
 *   `gscSource`, in three renderings (Q6): the sample chip, nothing for the
 *   operator's own rows, and "source unknown" — never a guess at either.
 * - No conclusion sentence (the prototype's "a high brand share means…", jsx
 *   P8 / Q16) and no "AI summary failed" box (Q15): there is no model, only
 *   placeholders, and the product section says so.
 *
 * Headings and labels are framework copy (`data-wb-frame`, Q30); every value is
 * the snapshot's and sits outside it.
 */

type MetricKey = "pages" | "indexable" | "traffic" | "dr" | "refdomains";
type FactRow = readonly [label: string, value: ReactNode];

const SOURCE_CHIP =
  "inline-flex h-[26px] items-center rounded border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-600";

function Count({ value }: { readonly value: number | null }) {
  const t = useTranslations("workbench.profile");
  const shown = statValue(value);
  return shown === null ? <span title={t("unknown")}>{UNKNOWN_TEXT}</span> : <>{shown}</>;
}

function Section({
  id,
  title,
  aside,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section
      data-wb-profile-section={id}
      className={cn(SECTION_RULE, "flex flex-col gap-4 pt-6 first:border-t-0 first:pt-0")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 data-wb-frame="" className={PANEL_TITLE}>
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Metrics({ items }: { readonly items: readonly (readonly [MetricKey, number])[] }) {
  const t = useTranslations("workbench.profile.metrics");
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-4">
      {items.map(([key, value]) => (
        <div key={key} data-wb-metric={key} className="flex flex-col-reverse gap-1">
          <dt data-wb-frame="" className="text-[13px] text-slate-500">
            {t(key)}
          </dt>
          <dd className="text-3xl font-bold tabular-nums text-slate-900">
            <Count value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Facts({ rows }: { readonly rows: readonly FactRow[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt data-wb-frame="" className="text-slate-500">
            {label}
          </dt>
          <dd className="min-w-0 break-words text-slate-800">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function Lines({ items }: { readonly items: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item, index) => (
        // Placeholder lists can repeat a line; position is the identity here.
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

function CrawlSection({ crawl }: { readonly crawl: CrawlSignals }) {
  const t = useTranslations("workbench.profile.doc");
  const yesNo = (value: boolean): string => (value ? t("yes") : t("no"));
  return (
    <Section id="crawl" title={t("crawl")} aside={<DemoChip />}>
      <Metrics items={[["pages", crawl.pages], ["indexable", crawl.indexable]]} />
      <Facts
        rows={[
          [t("lang"), crawl.lang],
          [t("stack"), crawl.stack],
          [t("h1"), crawl.h1],
          [t("hasPricing"), yesNo(crawl.hasPricing)],
          [t("hasDocs"), yesNo(crawl.hasDocs)],
          [t("hasBlog"), yesNo(crawl.hasBlog)],
        ]}
      />
    </Section>
  );
}

function ThirdSection({ third }: { readonly third: CrawlSignals }) {
  const t = useTranslations("workbench.profile.doc");
  return (
    <Section id="third" title={t("third")} aside={<DemoChip />}>
      <Metrics items={[["traffic", third.traffic], ["dr", third.dr], ["refdomains", third.refdomains]]} />
    </Section>
  );
}

function GscSourceLabel({ source }: { readonly source: GscRowsSource | null }) {
  const t = useTranslations("workbench.profile.doc");
  switch (source) {
    case "sample":
      return <DemoChip />;
    case "user":
      return null;
    case null:
      return (
        <span data-wb-frame="" className={SOURCE_CHIP}>
          {t("gscSourceUnknown")}
        </span>
      );
  }
}

function TopQueries({ rows }: { readonly rows: readonly GscRow[] }) {
  return (
    <ol className="flex flex-col gap-1">
      {rows.map((row, index) => (
        // Imported rows are not de-duplicated, so a query may repeat.
        <li key={index} data-wb-top-query="" className="flex flex-wrap items-baseline gap-2">
          <span className="break-words">{row.query}</span>
          <span className="tabular-nums text-slate-500">
            <Count value={row.clicks} />
          </span>
        </li>
      ))}
    </ol>
  );
}

function GscSection({ gsc, source }: { readonly gsc: GscSignals; readonly source: GscRowsSource | null }) {
  const t = useTranslations("workbench.profile.doc");
  const counts: readonly FactRow[] = [
    [t("gscTotal"), <Count key="total" value={gsc.total} />],
    [t("gscBrand"), <Count key="brand" value={gsc.brandQueries} />],
    [t("gscBrandClicks"), <Count key="brandClicks" value={gsc.brandClicks} />],
    [t("gscNonBrandClicks"), <Count key="nonBrandClicks" value={gsc.nonBrandClicks} />],
    [t("gscNear"), <Count key="near" value={gsc.near} />],
  ];
  const top: readonly FactRow[] =
    gsc.top.length === 0 ? [] : [[t("gscTop"), <TopQueries key="top" rows={gsc.top} />]];
  return (
    <Section id="gsc" title={t("gsc")} aside={<GscSourceLabel source={source} />}>
      <Facts rows={[...counts, ...top]} />
      <p data-wb-frame="" className="text-xs text-slate-500">
        {t("gscNote")}
      </p>
    </Section>
  );
}

function ProductSection({ ai }: { readonly ai: AiDoc }) {
  const t = useTranslations("workbench.profile.doc");
  return (
    <Section id="product" title={t("product")}>
      <p data-wb-frame="" className="text-xs text-slate-500">
        {t("placeholderNote")}
      </p>
      <Facts
        rows={[
          [t("summary"), ai.summary],
          [t("valueProps"), <Lines key="valueProps" items={ai.value_props} />],
          [t("diff"), <Lines key="diff" items={ai.diff} />],
          [t("pillars"), <Lines key="pillars" items={ai.pillars} />],
          [t("tone"), ai.tone],
          [t("facts"), <Lines key="facts" items={ai.facts} />],
        ]}
      />
    </Section>
  );
}

function IcpSection({ index, segment }: { readonly index: number; readonly segment: IcpSegment }) {
  const t = useTranslations("workbench.profile.doc");
  return (
    <Section id="icp" title={t("icp", { index })}>
      <Facts
        rows={[
          [t("icpSeg"), segment.seg],
          [t("icpRole"), segment.role],
          [t("icpPain"), segment.pain],
          [t("icpTrigger"), segment.trigger],
          [t("icpObjection"), segment.objection],
        ]}
      />
    </Section>
  );
}

export function ProfileDocTab({ doc }: { readonly doc: ProfileDoc }) {
  return (
    <div className="flex flex-col gap-6">
      {doc.crawl === null ? null : <CrawlSection crawl={doc.crawl} />}
      {doc.third === null ? null : <ThirdSection third={doc.third} />}
      {doc.gsc === null ? null : <GscSection gsc={doc.gsc} source={doc.gscSource} />}
      <ProductSection ai={doc.ai} />
      {doc.ai.icp.map((segment, index) => (
        // The ICP list is the snapshot's, fixed once written; its order is its identity.
        <IcpSection key={index} index={index + 1} segment={segment} />
      ))}
    </div>
  );
}
