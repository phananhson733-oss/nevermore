// @input  -- locale and drama id params; the task database; the verified session; R2 for the cover
// @output -- one published drama: details, episode list with paid locks, clips, and the claim panel
// @pos    -- /tasks/<id>, where a promoter claims a link and fetches clips
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { Lock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ClaimPanel } from "@/components/task-center/claim-panel";
import { siteConfig } from "@/config/site";
import { getServerAuthenticatedUser } from "@/lib/auth/server-auth-user";
import { listClaimsForDrama, type Claim } from "@/lib/task-center/claims-store";
import { isUuid } from "@/lib/task-center/contracts";
import { formatDay, languageName, promoLink, taskCopy } from "@/lib/task-center/copy";
import { getTaskDb } from "@/lib/task-center/db";
import { getPublishedDrama } from "@/lib/task-center/dramas-store";
import { coverImageUrl, readR2Config } from "@/lib/task-center/r2";
import { localePath } from "@/lib/locale-path";
import { generatePageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Params = Promise<{ locale: string; id: string }>;

async function load(id: string) {
  const db = getTaskDb();
  if (db === null || !isUuid(id)) return null;
  try {
    return { db, found: await getPublishedDrama(db, id) };
  } catch (error) {
    console.error("[tasks] detail failed", error);
    return null;
  }
}

export async function generateMetadata({ params }: { params: Params }) {
  const { locale, id } = await params;
  const copy = taskCopy(locale);
  const loaded = await load(id);
  const drama = loaded?.found?.drama;
  return generatePageMetadata({
    title: drama ? (locale === "zh" && drama.titleCn ? drama.titleCn : drama.title) : copy.tasksTitle,
    description: drama?.synopsis?.slice(0, 160) ?? copy.tasksSubtitle,
    locale,
    path: `/tasks/${id}`,
    noIndex: true,
  });
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default async function TaskDetailPage({ params }: { params: Params }) {
  const { locale, id } = await params;
  const copy = taskCopy(locale);
  const loaded = await load(id);
  if (loaded === null) {
    // Malformed ids are simply not pages; an outage is said plainly.
    if (!isUuid(id)) notFound();
    return (
      <section className="bg-brand-bg px-6 pt-14 pb-24 md:px-8">
        <p className={`mx-auto max-w-4xl ${NOTE}`}>{copy.unavailable}</p>
      </section>
    );
  }
  if (loaded.found === null) notFound();
  const { drama, assets } = loaded.found;

  const user = await getServerAuthenticatedUser().catch(() => ({ status: "unavailable" as const }));
  const signedIn = user.status === "authenticated";
  let claims: readonly Claim[] = [];
  if (user.status === "authenticated") {
    claims = await listClaimsForDrama(loaded.db, user.userId, drama.id).catch(() => []);
  }
  const here = localePath(locale, `/tasks/${drama.id}`);
  const signInHref = `/api/auth/google/start?next=${encodeURIComponent(here)}`;
  const r2 = readR2Config();
  const coverUrl = r2 !== null && drama.coverKey !== null ? coverImageUrl(r2, drama.coverKey) : null;
  const title = locale === "zh" && drama.titleCn ? drama.titleCn : drama.title;
  const subtitle = locale === "zh" ? (drama.titleCn ? drama.title : null) : drama.titleCn;

  return (
    <section className="bg-brand-bg px-6 pt-10 pb-24 md:px-8">
      <div className="mx-auto max-w-5xl">
        <Link href={localePath(locale, "/tasks")} className="text-[13.5px] text-brand-accent-text hover:underline">
          ← {copy.back}
        </Link>

        <div className="mt-6 grid gap-8 md:grid-cols-[240px_1fr]">
          <div className="aspect-[3/4] overflow-hidden rounded-card border border-brand-border-card bg-brand-panel-raised">
            {coverUrl !== null && (
              <img src={coverUrl} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <div>
            <h1 className="text-page-title text-text-dark-primary">{title}</h1>
            {subtitle && <p className="mt-2 text-[15px] text-text-dark-secondary">{subtitle}</p>}
            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 text-[14px] sm:grid-cols-3">
              <Fact label={copy.platform} value={drama.platform} />
              <Fact label={copy.language} value={languageName(drama.language, locale)} />
              <Fact
                label={copy.contents}
                value={drama.episodes === null ? "—" : copy.episodes(drama.episodes)}
              />
              <Fact
                label={copy.payStart}
                value={drama.payStart === null ? "—" : copy.payStartValue(drama.payStart)}
              />
              <Fact label={copy.listedOn} value={formatDay(drama.listedAt, locale)} />
              <Fact label={copy.promotersLabel} value={String(drama.promoterCount)} />
            </dl>
            {drama.synopsis && (
              <div className="mt-6">
                <h2 className={H2}>{copy.synopsis}</h2>
                <p className="mt-2 text-[14.5px] leading-[1.7] whitespace-pre-line text-text-dark-secondary">
                  {drama.synopsis}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-10 rounded-card border border-brand-border-card bg-brand-panel p-6">
          <h2 className={H2}>{copy.promote}</h2>
          <p className="mt-2 text-[14px] leading-[1.6] text-text-dark-secondary">{copy.promoteBody}</p>
          <div className="mt-5">
            <ClaimPanel
              dramaId={drama.id}
              locale={locale}
              signedIn={signedIn}
              signInHref={signInHref}
              initialClaims={claims.map((claim) => ({
                channel: claim.channel,
                code: claim.code,
                link: promoLink(siteConfig.url, claim.code),
              }))}
            />
          </div>
        </div>

        <div className="mt-10">
          <h2 className={H2}>{copy.clips}</h2>
          {assets.length === 0 ? (
            <p className={`mt-3 ${NOTE}`}>{copy.noClips}</p>
          ) : !signedIn ? (
            <p className={`mt-3 ${NOTE}`}>
              {copy.signInForClips}{" "}
              <a href={signInHref} className="text-brand-accent-text hover:underline">
                {copy.signIn}
              </a>
            </p>
          ) : (
            <ul className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {assets.map((asset) => (
                <li key={asset.id} className="overflow-hidden rounded-card border border-brand-border-card bg-brand-panel">
                  {asset.kind === "video" ? (
                    <video
                      controls
                      preload="none"
                      className="aspect-[9/16] max-h-90 w-full bg-brand-panel-sunken"
                      src={`/api/tasks/assets/${asset.id}`}
                    />
                  ) : (
                    <img src={`/api/tasks/assets/${asset.id}`} alt="" loading="lazy" className="w-full" />
                  )}
                  <div className="flex items-center justify-between gap-3 p-4 text-[13.5px]">
                    <span className="min-w-0 truncate text-text-dark-primary">{asset.title}</span>
                    <a
                      href={`/api/tasks/assets/${asset.id}?download=1`}
                      className="shrink-0 text-brand-accent-text hover:underline"
                    >
                      {copy.download} · {formatBytes(asset.byteSize)}
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-10">
          <h2 className={H2}>{copy.contents}</h2>
          {drama.episodes === null ? (
            <p className={`mt-3 ${NOTE}`}>{copy.contentsUnknown}</p>
          ) : (
            <>
              <ol className="mt-4 grid grid-cols-5 gap-2 sm:grid-cols-8 md:grid-cols-10">
                {Array.from({ length: drama.episodes }, (_, index) => index + 1).map((episode) => {
                  const locked = drama.payStart !== null && episode >= drama.payStart;
                  return (
                    <li
                      key={episode}
                      className="flex h-10 items-center justify-center gap-1 rounded-[8px] border border-brand-border-card bg-brand-panel font-mono text-[13px] text-text-dark-secondary"
                    >
                      {episode}
                      {locked && <Lock aria-label="locked" className="size-3 text-text-dark-secondary" />}
                    </li>
                  );
                })}
              </ol>
              {drama.payStart !== null && (
                <p className="mt-3 text-[13px] text-text-dark-secondary">{copy.lockedNote}</p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

const H2 = "text-[18px] font-semibold text-text-dark-primary";
const NOTE =
  "rounded-card border border-brand-border-card bg-brand-panel p-6 text-[14px] leading-[1.6] text-text-dark-secondary";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] text-text-dark-secondary">{label}</dt>
      <dd className="mt-0.5 text-text-dark-primary">{value}</dd>
    </div>
  );
}
