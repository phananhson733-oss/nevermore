// @input  -- locale and drama id params, ?ref=<promo code> from /t/<code>; the task database; R2 for the cover and trailer
// @output -- the reader's page for one drama, built from what was uploaded: cover, title, chips, episode count, a trailer clip, the synopsis, and 去看全集 when the drama has a platform link (through ./go, carrying the code; the platform's URL never appears in this HTML)
// @pos    -- /watch/<id>, where every promoter's link lands; noindex and not in the sitemap
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { notFound } from "next/navigation";
import { cache } from "react";

import { DramaChips } from "@/components/task-center/drama-info";
import { isUuid, normalizePromoCode } from "@/lib/task-center/contracts";
import { platformLabel, taskCopy } from "@/lib/task-center/copy";
import { getTaskDb } from "@/lib/task-center/db";
import { getLandingDrama } from "@/lib/task-center/dramas-store";
import { publicObjectUrl, r2ObjectUrl, readR2Config } from "@/lib/task-center/r2";
import { localePath } from "@/lib/locale-path";
import { generatePageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Params = Promise<{ locale: string; id: string }>;
type SearchParams = Promise<{ ref?: string | string[] }>;

/**
 * Null when the database is missing or failing; `found` null when there is no
 * such page. Cached per request, so the metadata and the page share one query.
 */
const load = cache(async (id: string) => {
  const db = getTaskDb();
  if (db === null || !isUuid(id)) return null;
  try {
    return { found: await getLandingDrama(db, id) };
  } catch (error) {
    console.error("[tasks] drama page failed", error);
    return null;
  }
});

function media(drama: { coverKey: string | null; trailer: { objectKey: string; posterKey: string | null } | null }) {
  const r2 = readR2Config();
  if (r2 === null) return { coverUrl: null, trailerUrl: null, posterUrl: null };
  const coverUrl = drama.coverKey === null ? null : publicObjectUrl(r2, drama.coverKey);
  return {
    coverUrl,
    // Signed from now, not the hour: a reader may open the page and press play
    // much later, and the video fetches its bytes only then.
    trailerUrl:
      drama.trailer === null
        ? null
        : r2ObjectUrl(r2, "GET", drama.trailer.objectKey, { expiresSeconds: TRAILER_URL_SECONDS }),
    posterUrl: drama.trailer?.posterKey ? publicObjectUrl(r2, drama.trailer.posterKey) : coverUrl,
  };
}

function displayTitle(locale: string, drama: { title: string; titleCn: string | null }): string {
  return locale === "zh" && drama.titleCn ? drama.titleCn : drama.title;
}

export async function generateMetadata({ params }: { params: Params }) {
  const { locale, id } = await params;
  const copy = taskCopy(locale);
  const drama = (await load(id))?.found ?? null;
  // The cover becomes the preview a TikTok or Facebook post shows for the link;
  // those fetch the image when they read the page, inside its signed hour.
  const cover = drama === null ? null : media({ coverKey: drama.coverKey, trailer: null }).coverUrl;
  return generatePageMetadata({
    title: drama === null ? copy.tasksTitle : displayTitle(locale, drama),
    description: drama === null ? "" : (drama.synopsis?.slice(0, 160) ?? displayTitle(locale, drama)),
    locale,
    path: `/watch/${id}`,
    ...(cover === null ? {} : { image: cover }),
    noIndex: true,
  });
}

export default async function WatchPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { locale, id } = await params;
  const { ref } = await searchParams;
  const copy = taskCopy(locale);
  const loaded = await load(id);
  if (loaded === null) {
    // Malformed ids are simply not pages; an outage is said plainly.
    if (!isUuid(id)) notFound();
    return (
      <section className="bg-brand-bg px-4 pt-14 pb-24 md:px-8">
        <p className="mx-auto max-w-3xl rounded-card border border-brand-border-card bg-brand-panel p-6 text-[14px] leading-[1.6] text-text-dark-secondary">
          {copy.watchUnavailable}
        </p>
      </section>
    );
  }
  const drama = loaded.found;
  if (drama === null) notFound();

  const { coverUrl, trailerUrl, posterUrl } = media(drama);
  const title = displayTitle(locale, drama);
  const subtitle = locale === "zh" ? (drama.titleCn ? drama.title : null) : drama.titleCn;
  // Only a well-formed code is passed on; ./go checks it was claimed for this drama.
  const code = normalizePromoCode(typeof ref === "string" ? ref : undefined);
  const goHref = `${localePath(locale, `/watch/${drama.id}/go`)}${code === null ? "" : `?ref=${code}`}`;
  const facts = [platformLabel(drama.platform), drama.episodes === null ? null : copy.episodes(drama.episodes)]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return (
    <section className="bg-brand-bg px-4 pt-8 pb-20 md:px-8 md:pt-12">
      <div className="mx-auto max-w-3xl">
        <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-5 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-8">
          <div className="aspect-[3/4] overflow-hidden rounded-card border border-brand-border-card bg-brand-panel-raised">
            {coverUrl !== null && <img src={coverUrl} alt="" className="h-full w-full object-cover" />}
          </div>
          <div className="space-y-2.5">
            <h1 className="text-[22px] leading-tight font-semibold text-text-dark-primary sm:text-page-title">{title}</h1>
            {subtitle && <p className="text-[14px] text-text-dark-secondary">{subtitle}</p>}
            <DramaChips locale={locale} language={drama.language} audience={null} genre={drama.genre} tags={drama.tags} max={6} />
            <p className="text-[13px] text-text-dark-secondary">{facts}</p>
          </div>
        </div>

        {drama.hasPlatformLink && (
          <a
            href={goHref}
            rel="nofollow"
            className="mt-6 flex h-12 w-full items-center justify-center rounded-[10px] bg-primary px-6 text-[15px] font-medium text-primary-foreground hover:bg-primary/90 sm:inline-flex sm:w-auto"
          >
            {copy.watchFull(platformLabel(drama.platform))}
          </a>
        )}

        {trailerUrl !== null && (
          <div className="mt-8">
            <h2 className={H2}>{copy.watchTrailer}</h2>
            <video
              controls
              playsInline
              preload="metadata"
              poster={posterUrl ?? undefined}
              src={trailerUrl}
              className="mt-3 aspect-[9/16] max-h-[70vh] w-full rounded-card bg-brand-panel-sunken sm:w-auto"
            />
          </div>
        )}

        {drama.synopsis && (
          <div className="mt-8">
            <h2 className={H2}>{copy.synopsis}</h2>
            <p className="mt-3 text-[14.5px] leading-[1.7] whitespace-pre-line text-text-dark-secondary">{drama.synopsis}</p>
          </div>
        )}
      </div>
    </section>
  );
}

const H2 = "text-[17px] font-semibold text-text-dark-primary";
const TRAILER_URL_SECONDS = 6 * 3_600;
