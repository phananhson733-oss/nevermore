// @input  -- locale param; q, platform, language, audience, genre, type, sort and page query; the task database; the session; R2 for stills and covers
// @output -- the promoter tabs, then every ready clip of a published drama as a filterable, paged 素材广场 grid, with what each listed drama's dialog shows (details, clips, the visitor's link and the drama page it opens)
// @pos    -- /tasks, the task center's entry page
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";

import type { LinkView } from "@/components/task-center/claim-panel";
import { ClipPlaza, type ClipCard, type PlazaDrama } from "@/components/task-center/clip-plaza";
import { TaskTabs } from "@/components/task-center/task-tabs";
import { siteConfig } from "@/config/site";
import { getServerAuthenticatedUser } from "@/lib/auth/server-auth-user";
import { listMyClaims } from "@/lib/task-center/claims-store";
import {
  CLIP_TYPES,
  DRAMA_AUDIENCES,
  PAGE_SIZE,
  SLUG_PATTERN,
  type ClipType,
  type DramaAudience,
} from "@/lib/task-center/contracts";
import { formatBytes, genreLabel, languageName, promoLink, taskCopy } from "@/lib/task-center/copy";
import { getTaskDb } from "@/lib/task-center/db";
import {
  listPlazaDramaDetails,
  listPublishedAssets,
  listPublishedFacets,
  type DramaSort,
  type PlazaDramaDetail,
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

function member<T extends string>(list: readonly T[], value: string | null): T | null {
  return value !== null && (list as readonly string[]).includes(value) ? (value as T) : null;
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
  const audience = member<DramaAudience>(DRAMA_AUDIENCES, one(query.audience));
  const genreParam = one(query.genre);
  const genre = genreParam !== null && SLUG_PATTERN.test(genreParam) ? genreParam : null;
  const clipType = member<ClipType>(CLIP_TYPES, one(query.type));
  const search = one(query.q);
  const sort: DramaSort = one(query.sort) === "promoters" ? "promoters" : "newest";
  const page = Math.max(1, Math.min(1000, Number.parseInt(one(query.page) ?? "1", 10) || 1));

  const db = getTaskDb();
  let result: Awaited<ReturnType<typeof listPublishedAssets>> | null = null;
  let facets: Awaited<ReturnType<typeof listPublishedFacets>> = { platforms: [], languages: [], genres: [] };
  if (db !== null) {
    try {
      [result, facets] = await Promise.all([
        listPublishedAssets(db, {
          platform,
          language,
          audience,
          genre,
          clipType,
          search,
          sort,
          page,
          pageSize: PAGE_SIZE,
        }),
        listPublishedFacets(db),
      ]);
    } catch (error) {
      console.error("[tasks] list failed", error);
      result = null;
    }
  }
  // The dialogs' extra details, for the dramas on this page only. Without
  // them a dialog still plays, downloads and claims; it just says less.
  let details: Readonly<Record<string, PlazaDramaDetail>> = {};
  if (db !== null && result !== null && result.items.length > 0) {
    details = await listPlazaDramaDetails(
      db,
      result.items.map((item) => item.drama.id),
    ).catch((error: unknown) => {
      console.error("[tasks] drama details failed", error);
      return {};
    });
  }

  const user = await getServerAuthenticatedUser().catch(() => ({ status: "unavailable" as const }));
  const signedIn = user.status === "authenticated";
  // The one "all" link per drama this person already holds, so a card's
  // dialog shows it instead of the button.
  const links: Record<string, LinkView> = {};
  if (db !== null && user.status === "authenticated") {
    const claims = await listMyClaims(db, user.userId).catch(() => []);
    for (const claim of claims) {
      if (claim.channel === "all") {
        links[claim.dramaId] = { link: promoLink(siteConfig.url, claim.code) };
      }
    }
  }

  const r2 = readR2Config();
  const cards: ClipCard[] = (result?.items ?? []).map((item) => {
    const still = item.posterKey ?? (item.kind === "image" ? item.objectKey : null);
    const { drama } = item;
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      clipType: item.clipType,
      posterUrl: r2 !== null && still !== null ? coverImageUrl(r2, still) : null,
      coverUrl: r2 !== null && drama.coverKey !== null ? coverImageUrl(r2, drama.coverKey) : null,
      size: formatBytes(item.byteSize),
      hot: item.hot,
      dramaId: drama.id,
      dramaTitle: locale === "zh" && drama.titleCn ? drama.titleCn : drama.title,
      dramaHref: localePath(locale, `/tasks/${drama.id}`),
      watchHref: localePath(locale, `/watch/${drama.id}`),
      audience: drama.audience,
      genre: drama.genre,
      tags: drama.tags,
      language: drama.language,
    };
  });

  const dramas: Record<string, PlazaDrama> = {};
  for (const { drama } of result?.items ?? []) {
    const detail = details[drama.id];
    dramas[drama.id] = {
      synopsis: detail?.synopsis ?? null,
      listedAt: drama.listedAt,
      episodes: drama.episodes,
      payStart: drama.payStart,
      // Downloads need sign-in, and the dialog lists them only then.
      clips: signedIn ? (detail?.clips ?? []) : [],
    };
  }

  const filtered = Boolean(platform || language || audience || genre || clipType || search);
  const pages = result === null ? 1 : Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const queryString = (target: number) => {
    const next = new URLSearchParams();
    if (search) next.set("q", search);
    if (platform) next.set("platform", platform);
    if (language) next.set("language", language);
    if (audience) next.set("audience", audience);
    if (genre) next.set("genre", genre);
    if (clipType) next.set("type", clipType);
    if (sort !== "newest") next.set("sort", sort);
    if (target > 1) next.set("page", String(target));
    const qs = next.toString();
    return qs ? `?${qs}` : "";
  };
  const here = localePath(locale, "/tasks");
  const signInHref = `/api/auth/google/start?next=${encodeURIComponent(here + queryString(page))}`;

  return (
    <section className="bg-brand-bg px-6 pt-14 pb-24 md:px-8">
      <div className="mx-auto max-w-6xl">
        <TaskTabs locale={locale} current="tasks" />
        <h1 className="text-page-title text-text-dark-primary">{copy.tasksTitle}</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-[1.65] text-text-dark-secondary">
          {copy.tasksSubtitle}
        </p>

        <form method="get" action={here} className="mt-8 flex flex-wrap items-center gap-3">
          <input
            type="search"
            name="q"
            defaultValue={search ?? ""}
            placeholder={copy.searchClips}
            className={`${FIELD} min-w-50 flex-1`}
            maxLength={100}
          />
          <select name="language" defaultValue={language ?? ""} className={FIELD} aria-label={copy.language}>
            <option value="">{copy.allLanguages}</option>
            {facets.languages.map((value) => (
              <option key={value} value={value}>
                {languageName(value, locale)}
              </option>
            ))}
          </select>
          <select name="audience" defaultValue={audience ?? ""} className={FIELD} aria-label={copy.allAudiences}>
            <option value="">{copy.allAudiences}</option>
            {DRAMA_AUDIENCES.map((value) => (
              <option key={value} value={value}>
                {copy.audience[value]}
              </option>
            ))}
          </select>
          <select name="genre" defaultValue={genre ?? ""} className={FIELD} aria-label={copy.allGenres}>
            <option value="">{copy.allGenres}</option>
            {facets.genres.map((value) => (
              <option key={value} value={value}>
                {genreLabel(value)}
              </option>
            ))}
          </select>
          <select name="type" defaultValue={clipType ?? ""} className={FIELD} aria-label={copy.allClipTypes}>
            <option value="">{copy.allClipTypes}</option>
            {CLIP_TYPES.map((value) => (
              <option key={value} value={value}>
                {copy.clipType[value]}
              </option>
            ))}
          </select>
          {facets.platforms.length > 1 && (
            <select name="platform" defaultValue={platform ?? ""} className={FIELD} aria-label={copy.platform}>
              <option value="">{copy.allPlatforms}</option>
              {facets.platforms.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          )}
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
        ) : cards.length === 0 ? (
          <p className={`mt-10 ${NOTE}`}>{filtered ? copy.noClipResults : copy.noClipsListed}</p>
        ) : (
          <>
            <ClipPlaza
              locale={locale}
              cards={cards}
              dramas={dramas}
              signedIn={signedIn}
              signInHref={signInHref}
              promotionsHref={`${localePath(locale, "/promotions")}#accounts`}
              links={links}
            />
            {pages > 1 && (
              <nav className="mt-10 flex items-center justify-center gap-4 text-[14px] text-text-dark-secondary">
                {page > 1 && (
                  <Link className="text-brand-accent-text hover:underline" href={here + queryString(page - 1)}>
                    {copy.previous}
                  </Link>
                )}
                <span>{copy.pageOf(page, pages)}</span>
                {page < pages && (
                  <Link className="text-brand-accent-text hover:underline" href={here + queryString(page + 1)}>
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
