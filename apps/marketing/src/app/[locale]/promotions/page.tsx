// @input  -- locale param; the verified session; this person's claims with click counts and their submitted accounts
// @output -- every drama they have links for, with its 推广链接 (which opens the drama's page on our site) and 资源推广链接 (straight to the drama on its platform), each with a copy button, the clicks on both and the date; and the account whitelisting panel at #accounts
// @pos    -- /promotions (我的推广), private to the signed-in promoter and kept out of search
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";

import { AccountsPanel } from "@/components/task-center/accounts-panel";
import { LinkBlock } from "@/components/task-center/link-block";
import { TaskTabs } from "@/components/task-center/task-tabs";
import { siteConfig } from "@/config/site";
import { getServerAuthenticatedUser } from "@/lib/auth/server-auth-user";
import { listMyAccounts, type PromoterAccount } from "@/lib/task-center/accounts-store";
import { listMyClaims, type ClaimWithStats } from "@/lib/task-center/claims-store";
import { channelLabel, formatCount, formatDay, promoLink, resourceLink, taskCopy } from "@/lib/task-center/copy";
import { getTaskDb } from "@/lib/task-center/db";
import { localePath } from "@/lib/locale-path";
import { generatePageMetadata } from "@/lib/seo";

// One person's links and accounts: never prerendered, never shared by a cache.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const copy = taskCopy(locale);
  return generatePageMetadata({
    title: copy.promotionsTitle,
    description: copy.promotionsSubtitle,
    locale,
    path: "/promotions",
    noIndex: true,
  });
}

export default async function PromotionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const copy = taskCopy(locale);
  const signInHref = `/api/auth/google/start?next=${encodeURIComponent(localePath(locale, "/promotions"))}`;

  const user = await getServerAuthenticatedUser().catch(() => ({ status: "unavailable" as const }));
  const db = getTaskDb();
  let body: React.ReactNode;
  if (user.status === "unauthenticated") {
    body = (
      <p className={NOTE}>
        {copy.signInForPromotions}{" "}
        <a href={signInHref} className="font-medium text-brand-accent-text hover:underline">
          {copy.signIn}
        </a>
      </p>
    );
  } else if (user.status === "unavailable" || db === null) {
    body = <p className={NOTE}>{copy.unavailable}</p>;
  } else {
    let data: { claims: readonly ClaimWithStats[]; accounts: readonly PromoterAccount[] } | null = null;
    try {
      const [claims, accounts] = await Promise.all([
        listMyClaims(db, user.userId),
        listMyAccounts(db, user.userId),
      ]);
      data = { claims, accounts };
    } catch (error) {
      console.error("[promotions] load failed", error);
    }
    body =
      data === null ? (
        <p className={NOTE}>{copy.unavailable}</p>
      ) : (
        <div className="space-y-12">
          <Links locale={locale} claims={data.claims} />
          <div id="accounts" className="scroll-mt-24">
            <h2 className={H2}>{copy.accountsTitle}</h2>
            <p className="mt-2 max-w-2xl text-[14px] leading-[1.6] text-text-dark-secondary">{copy.accountsBody}</p>
            <div className="mt-5">
              <AccountsPanel locale={locale} initialAccounts={data.accounts} />
            </div>
          </div>
        </div>
      );
  }

  return (
    <section className="bg-brand-bg px-6 pt-14 pb-24 md:px-8">
      <div className="mx-auto max-w-5xl">
        <TaskTabs locale={locale} current="promotions" />
        <h1 className="text-page-title text-text-dark-primary">{copy.promotionsTitle}</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-[1.65] text-text-dark-secondary">
          {copy.promotionsSubtitle}
        </p>
        <div className="mt-10">{body}</div>
      </div>
    </section>
  );
}

function Links({ locale, claims }: { locale: string; claims: readonly ClaimWithStats[] }) {
  const copy = taskCopy(locale);
  return (
    <div>
      <h2 className={H2}>{copy.myLinks}</h2>
      {claims.length === 0 ? (
        <p className={`mt-4 ${NOTE}`}>
          {copy.noLinks}{" "}
          <Link href={localePath(locale, "/tasks")} className="text-brand-accent-text hover:underline">
            {copy.browseTasks}
          </Link>
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {claims.map((claim) => (
            <li key={claim.id} className="rounded-card border border-brand-border-card bg-brand-panel p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <Link
                  href={localePath(locale, `/tasks/${claim.dramaId}`)}
                  className="text-[15px] font-medium text-text-dark-primary hover:text-brand-accent-text"
                >
                  {locale === "zh" && claim.dramaTitleCn ? claim.dramaTitleCn : claim.dramaTitle}
                </Link>
                <p className="text-[13px] text-text-dark-secondary">
                  {channelLabel(claim.channel, copy)} · {copy.clicks} {formatCount(claim.clicks, locale)} ·{" "}
                  {copy.claimedOn} {formatDay(claim.claimedAt, locale)}
                </p>
              </div>
              <div className="mt-3 max-w-2xl space-y-3">
                <LinkBlock
                  title={copy.dramaLink}
                  body={copy.dramaLinkBody}
                  value={promoLink(siteConfig.url, claim.code)}
                  locale={locale}
                  level={3}
                />
                <LinkBlock
                  title={copy.resourceLink}
                  body={copy.resourceLinkBody}
                  value={resourceLink(siteConfig.url, claim.code)}
                  locale={locale}
                  level={3}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const H2 = "text-[18px] font-semibold text-text-dark-primary";
const NOTE =
  "rounded-card border border-brand-border-card bg-brand-panel p-6 text-[14px] leading-[1.6] text-text-dark-secondary";
