// @input  -- locale param; q, platform, language, genre, tag and page query (no others: a filter the bar does not show is not applied); the task database; the session; R2 for stills and covers
// @output -- the promoter tabs, the filters (search, 剧场 from the platforms of published dramas, then MoboReels' 语言, 题材 and 标签, a text box that matches any part of a tag in any case with a list of the published tags that contain what is typed), each named by a label above it, then every ready clip of a published drama, newest first, as a paged 素材广场 grid, with what each listed drama's dialog shows (上架时间, episodes, synopsis, its clips for a signed-in visitor, and the visitor's two links when they already hold them)
// @pos    -- /tasks, the task center's entry page
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";
import type { ReactNode } from "react";

import type { LinkView } from "@/components/task-center/claim-panel";
import { ClipPlaza, type ClipCard, type PlazaDrama } from "@/components/task-center/clip-plaza";
import { TagCombobox } from "@/components/task-center/tag-combobox";
import { TaskTabs } from "@/components/task-center/task-tabs";
import { siteConfig } from "@/config/site";
import { getServerAuthenticatedUser } from "@/lib/auth/server-auth-user";
import { listMyClaims } from "@/lib/task-center/claims-store";
import { PAGE_SIZE, SLUG_PATTERN } from "@/lib/task-center/contracts";
import {
  formatBytes,
  genreLabel,
  languageName,
  platformLabel,
  promoLink,
  resourceLink,
  taskCopy,
} from "@/lib/task-center/copy";
import { getTaskDb } from "@/lib/task-center/db";
import {
  listPlazaDramaDetails,
  listPublishedAssets,
  listPublishedFacets,
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
  // Only what the bar shows. An old link's audience, type or sort is dropped
  // rather than applied where nobody could see or clear it.
  // 剧场 is a drama's platform slug, matched exactly, so any value is safe.
  const platform = one(query.platform);
  const language = one(query.language);
  const genreParam = one(query.genre);
  const genre = genreParam !== null && SLUG_PATTERN.test(genreParam) ? genreParam : null;
  // Free text matched against any part of a drama's tags, in any case, so any
  // value is safe; one no tag contains just finds nothing.
  const tag = one(query.tag);
  const search = one(query.q);
  const page = Math.max(1, Math.min(1000, Number.parseInt(one(query.page) ?? "1", 10) || 1));

  const db = getTaskDb();
  let result: Awaited<ReturnType<typeof listPublishedAssets>> | null = null;
  let facets: Awaited<ReturnType<typeof listPublishedFacets>> = { platforms: [], languages: [], genres: [], tags: [] };
  if (db !== null) {
    try {
      [result, facets] = await Promise.all([
        listPublishedAssets(db, {
          platform,
          language,
          genre,
          tag,
          search,
          sort: "newest",
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
  // The "all" links per drama this person already holds, so a card's dialog
  // shows them at once instead of making them.
  const links: Record<string, LinkView> = {};
  if (db !== null && user.status === "authenticated") {
    const claims = await listMyClaims(db, user.userId).catch(() => []);
    for (const claim of claims) {
      if (claim.channel === "all") {
        links[claim.dramaId] = {
          link: promoLink(siteConfig.url, claim.code),
          resourceLink: resourceLink(siteConfig.url, claim.code),
        };
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

  const filtered = Boolean(platform || language || genre || tag || search);
  // A theater in the link that no published drama has any more stays a
  // choice, so the select shows the filter that is on instead of 全部.
  const platformOptions =
    platform !== null && !facets.platforms.includes(platform) ? [platform, ...facets.platforms] : facets.platforms;
  const pages = result === null ? 1 : Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const queryString = (target: number) => {
    const next = new URLSearchParams();
    if (search) next.set("q", search);
    if (platform) next.set("platform", platform);
    if (language) next.set("language", language);
    if (genre) next.set("genre", genre);
    if (tag) next.set("tag", tag);
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

        {/* 搜索, 剧场 and MoboReels' 语言, 题材, 标签, each under its own label
            so a select can say just 全部: one row of equal fields from md up;
            on a phone the search on its own row, then two to a row, and the
            button alone across the last one. */}
        <form
          method="get"
          action={here}
          className="mt-8 grid grid-cols-2 items-end gap-x-3 gap-y-4 md:flex"
        >
          <Field label={copy.searchLabel} className="col-span-2">
            <input
              type="search"
              name="q"
              defaultValue={search ?? ""}
              placeholder={copy.searchClips}
              className={FIELD}
              maxLength={100}
            />
          </Field>
          {/* Shown even with one theater, like 语言 and 题材: the bar keeps one shape. */}
          <Field label={copy.theaterField}>
            <select name="platform" defaultValue={platform ?? ""} className={FIELD}>
              <option value="">{copy.allOption}</option>
              {platformOptions.map((value) => (
                <option key={value} value={value}>
                  {platformLabel(value)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={copy.language}>
            <select name="language" defaultValue={language ?? ""} className={FIELD}>
              <option value="">{copy.allOption}</option>
              {facets.languages.map((value) => (
                <option key={value} value={value}>
                  {languageName(value, locale)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={copy.genreField}>
            <select name="genre" defaultValue={genre ?? ""} className={FIELD}>
              <option value="">{copy.allOption}</option>
              {facets.genres.map((value) => (
                <option key={value} value={value}>
                  {genreLabel(value)}
                </option>
              ))}
            </select>
          </Field>
          {/* Typed, not only picked: any part of a tag finds the dramas whose
              tags contain it, and the list under the box shows the published
              tags that do. Shown even with no tags yet: the bar keeps one shape. */}
          <Field label={copy.tagField}>
            <TagCombobox locale={locale} tags={facets.tags} defaultValue={tag ?? ""} className={FIELD} />
          </Field>
          <button
            type="submit"
            className="col-span-2 h-10 w-full rounded-[10px] bg-primary px-6 text-[14px] font-medium text-primary-foreground hover:bg-primary/90 md:w-auto md:shrink-0"
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

/** One filter: its name above the control, the label wrapping it so the name is the control's name too. */
function Field({ label, className = "", children }: { label: string; className?: string | undefined; children: ReactNode }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1.5 md:flex-1 ${className}`}>
      <span className="text-[13px] font-medium text-text-dark-secondary">{label}</span>
      {children}
    </label>
  );
}

const FIELD =
  "h-10 w-full min-w-0 rounded-[10px] border border-brand-border-strong bg-brand-panel px-3 text-[14px] text-text-dark-primary";
const NOTE =
  "rounded-card border border-brand-border-card bg-brand-panel p-6 text-[14px] leading-[1.6] text-text-dark-secondary";
