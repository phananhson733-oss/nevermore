"use client";

// @input  -- the target page's own title, description and URL
// @output -- an approximate search result and social card, side by side
// @pos    -- what the collected fields would look like where they get read
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { useTranslations } from "next-intl";
import type { SeoAuditTargetPageExtract } from "@sf/public-tools/seo-audit/types";
import {
  clipToWidth,
  SNIPPET_DESCRIPTION_WIDTH,
  SNIPPET_TITLE_WIDTH,
} from "@sf/public-tools/seo-audit/text-width";

/**
 * Where a search result stops showing the rest.
 *
 * Approximate on purpose. Google truncates by rendered pixel width, not by
 * character count, and the cut moves with the device and the query. These are
 * the same widths the title and description checks judge by — the preview used
 * its own numbers and cut on `.length`, so a Chinese title was flagged as
 * "width 90, outside 15–60, likely truncated" directly above a preview that
 * showed it whole and called itself a truncation sketch.
 */
const TITLE_PREVIEW_WIDTH = SNIPPET_TITLE_WIDTH.max;
const DESCRIPTION_PREVIEW_WIDTH = SNIPPET_DESCRIPTION_WIDTH.max;

const clip = clipToWidth;

function breadcrumb(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path.replace(/\//g, " › ")}`;
  } catch {
    return url;
  }
}

export function OnPageSerpPreview({
  extract,
}: {
  readonly extract: SeoAuditTargetPageExtract;
}) {
  const t = useTranslations("tools.onPageChecker.preview");
  const og = extract.declared?.openGraph ?? null;
  const socialTitle = og?.title ?? extract.title;
  const socialDescription = og?.description ?? extract.metaDescription;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="grid gap-2 rounded-xl border border-brand-border-card p-4">
        <p className="font-mono text-[10.5px] tracking-[0.14em] text-text-dark-faint uppercase">
          {t("serpEyebrow")}
        </p>
        <p className="font-mono text-[12px] break-all text-text-dark-secondary">
          {breadcrumb(extract.url)}
        </p>
        <p className="text-[16px] leading-snug text-brand-accent-text">
          {extract.title === null
            ? t("titleMissing")
            : clip(extract.title, TITLE_PREVIEW_WIDTH)}
        </p>
        <p className="text-[13px] leading-[1.6] text-text-dark-secondary">
          {extract.metaDescription === null
            ? t("descriptionMissing")
            : clip(extract.metaDescription, DESCRIPTION_PREVIEW_WIDTH)}
        </p>
        <p className="text-[11.5px] text-text-dark-faint">{t("serpNote")}</p>
      </div>

      <div className="grid gap-2 rounded-xl border border-brand-border-card p-4">
        <p className="font-mono text-[10.5px] tracking-[0.14em] text-text-dark-faint uppercase">
          {t("socialEyebrow")}
        </p>
        {og === null ? (
          <p className="text-[13px] leading-[1.6] text-text-dark-secondary">
            {t("socialUnavailable")}
          </p>
        ) : (
          <>
            {/*
              The image is described, not fetched. Rendering a remote asset
              here would make this page issue a request to the audited site on
              the visitor's behalf, which is not what they asked for.
            */}
            <p className="font-mono text-[12px] break-all text-text-dark-secondary">
              {og.image === null ? t("socialNoImage") : og.image}
            </p>
            <p className="text-[15px] leading-snug text-text-dark-primary">
              {socialTitle === null ? t("titleMissing") : socialTitle}
            </p>
            <p className="text-[13px] leading-[1.6] text-text-dark-secondary">
              {socialDescription === null
                ? t("descriptionMissing")
                : clip(socialDescription, DESCRIPTION_PREVIEW_WIDTH)}
            </p>
            <p className="text-[11.5px] text-text-dark-faint">
              {t("socialNote", {
                card: extract.declared?.twitterCard ?? t("socialNoCard"),
              })}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
