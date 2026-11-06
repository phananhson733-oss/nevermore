// @input  -- locale param; platform, language, q, sort and page query; the task database; R2 for covers
// @output -- the published dramas as a filterable, paged grid of task cards
// @pos    -- /tasks, the task center's entry page
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";

import { PAGE_SIZE } from "@/lib/task-center/contracts";
import { taskCopy, languageName } from "@/lib/task-center/copy";
import { getTaskDb } from "@/lib/task-center/db";
import {
  listPublishedDramas,
  listPublishedFacets,
  type DramaSort,
  type DramaSummary,
} from "@/lib/task-center/dramas-store";
import { coverImageUrl, readR2Config } from "@/lib/task-center/r2";
import { localePath } from "@/lib/locale-path";
import { generatePageMetadata } from "@/lib/seo";

// Filters live in the query string and listings change whenever an admin
// publishes, so every request renders fresh.
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const copy = taskCopy(locale);
  return generatePageMetadata({
    title: copy.tasksTitle,
    description: copy.tasksSubtitle,
    locale,
    path: "/tasks",
    // Kept out of search until the catalog is filled; not in sitemap.ts.
    noIndex: true,
  });
}

function one(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed.slice(0, 100) : null;
}

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: SearchParams;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const copy = taskCopy(locale);
  const platform = one(query.platform);
  const language = one(query.language);
  const search = one(query.q);
  const sort: DramaSort = one(query.sort) === "promoters" ? "promoters" : "newest";
  const page = Math.max(1, Math.min(1000, Number.parseInt(one(query.page) ?? "1", 10) || 1));

  const db = getTaskDb();
  let result: Awaited<ReturnType<typeof listPublishedDramas>> | null = null;
  let facets: Awaited<ReturnType<typeof listPublishedFacets>> = { platforms: [], languages: [] };
  if (db !== null) {
    try {
      [result, facets] = await Promise.all([
        listPublishedDramas(db, { platform, language, search, sort, page, pageSize: PAGE_SIZE }),
        listPublishedFacets(db),
      ]);
    } catch (error) {
      console.error("[tasks] list failed", error);
      result = null;
    }
  }
  const r2 = readR2Config();
  const filtered = Boolean(platform || language || search);
  const pages = result === null ? 1 : Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  const pageHref = (target: number) => {
    const next = new URLSearchParams();
    if (platform) next.set("platform", platform);
    if (language) next.set("language", language);
    if (search) next.set("q", search);
    if (sort !== "newest") next.set("sort", sort);
    if (target > 1) next.set("page", String(target));
    const qs = next.toString();
    return `${localePath(locale, "/tasks")}${qs ? `?${qs}` : ""}`;
  };

  return (
    <section className="bg-brand-bg px-6 pt-14 pb-24 md:px-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-page-title text-text-dark-primary">{copy.tasksTitle}</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-[1.65] text-text-dark-secondary">
          {copy.tasksSubtitle}
        </p>

        <form
          method="get"
          action={localePath(locale, "/tasks")}
          className="mt-8 flex flex-wrap items-center gap-3"
        >
          <select name="platform" defaultValue={platform ?? ""} className={FIELD} aria-label={copy.platform}>
            <option value="">{copy.allPlatforms}</option>
            {facets.platforms.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select name="language" defaultValue={language ?? ""} className={FIELD} aria-label={copy.language}>
            <option value="">{copy.allLanguages}</option>
            {facets.languages.map((value) => (
              <option key={value} value={value}>
                {languageName(value, locale)}
              </option>
            ))}
          </select>
          <input
            type="search"
            name="q"
            defaultValue={search ?? ""}
            placeholder={copy.searchPlaceholder}
            className={`${FIELD} min-w-50 flex-1`}
            maxLength={100}
          />
          <select name="sort" defaultValue={sort} className={FIELD} aria-label={copy.sortNewest}>
            <option value="newest">{copy.sortNewest}</option>
            <option value="promoters">{copy.sortPromoters}</option>
          </select>
          <button
            type="submit"
            className="h-10 rounded-[10px] bg-primary px-5 text-[14px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            {copy.apply}
          </button>
        </form>

        {result === null ? (
          <p className={`mt-10 ${NOTE}`}>{copy.unavailable}</p>
        ) : result.items.length === 0 ? (
          <p className={`mt-10 ${NOTE}`}>{filtered ? copy.noResults : copy.noneYet}</p>
        ) : (
          <>
            <ul className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
              {result.items.map((drama) => (
                <li key={drama.id}>
                  <TaskCard
                    drama={drama}
                    locale={locale}
                    href={localePath(locale, `/tasks/${drama.id}`)}
                    coverUrl={r2 !== null && drama.coverKey !== null ? coverImageUrl(r2, drama.coverKey) : null}
                  />
                </li>
              ))}
            </ul>
            {pages > 1 && (
              <nav className="mt-10 flex items-center justify-center gap-4 text-[14px] text-text-dark-secondary">
                {page > 1 && (
                  <Link className="text-brand-accent-text hover:underline" href={pageHref(page - 1)}>
                    {copy.previous}
                  </Link>
                )}
                <span>{copy.pageOf(page, pages)}</span>
                {page < pages && (
                  <Link className="text-brand-accent-text hover:underline" href={pageHref(page + 1)}>
                    {copy.next}
                  </Link>
                )}
              </nav>
            )}
          </>
        )}
      </div>
    </section>
  );
}

const FIELD =
  "h-10 rounded-[10px] border border-brand-border-strong bg-brand-panel px-3 text-[14px] text-text-dark-primary";
const NOTE =
  "rounded-card border border-brand-border-card bg-brand-panel p-6 text-[14px] leading-[1.6] text-text-dark-secondary";

function TaskCard({
  drama,
  locale,
  href,
  coverUrl,
}: {
  drama: DramaSummary;
  locale: string;
  href: string;
  coverUrl: string | null;
}) {
  const copy = taskCopy(locale);
  const title = locale === "zh" && drama.titleCn ? drama.titleCn : drama.title;
  return (
    <Link
      href={href}
      className="group block overflow-hidden rounded-card border border-brand-border-card bg-brand-panel transition-colors hover:border-brand-accent/50"
    >
      <div className="aspect-[3/4] bg-brand-panel-raised">
        {coverUrl !== null && (
          // Signed R2 URLs change every hour; next/image would cache them as new images.
          <img src={coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="p-4">
        <p className="line-clamp-2 text-[15px] font-semibold text-text-dark-primary group-hover:text-brand-accent-text">
          {title}
        </p>
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-text-dark-secondary">
          <span>{drama.platform}</span>
          <span>{languageName(drama.language, locale)}</span>
          <span>{drama.episodes === null ? copy.episodesUnknown : copy.episodes(drama.episodes)}</span>
        </p>
        <p className="mt-2 font-mono text-[11.5px] text-brand-accent-text">{copy.promoters(drama.promoterCount)}</p>
      </div>
    </Link>
  );
}
