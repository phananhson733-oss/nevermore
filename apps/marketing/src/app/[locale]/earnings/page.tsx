// @input  -- locale param; the verified session; this person's claims and imported settlement rows
// @output -- totals per currency, earnings by platform (a total missing some days is marked partial), and every promo link they hold with its clicks
// @pos    -- /earnings, private to the signed-in promoter and kept out of search
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";

import { siteConfig } from "@/config/site";
import { getServerAuthenticatedUser } from "@/lib/auth/server-auth-user";
import { listMyClaims, type ClaimWithStats } from "@/lib/task-center/claims-store";
import {
  CHANNEL_LABELS,
  formatCount,
  formatDay,
  formatMoney,
  promoLink,
  taskCopy,
  type TaskCopy,
} from "@/lib/task-center/copy";
import { getTaskDb } from "@/lib/task-center/db";
import {
  getMyEarnings,
  type EarningsFigures,
  type MyEarnings,
  type SummedFigure,
} from "@/lib/task-center/earnings-store";
import { localePath } from "@/lib/locale-path";
import { generatePageMetadata } from "@/lib/seo";

// One person's figures: never prerendered, never shared by a cache.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const copy = taskCopy(locale);
  return generatePageMetadata({
    title: copy.earningsTitle,
    description: copy.earningsSubtitle,
    locale,
    path: "/earnings",
    noIndex: true,
  });
}

export default async function EarningsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const copy = taskCopy(locale);
  const signInHref = `/api/auth/google/start?next=${encodeURIComponent(localePath(locale, "/earnings"))}`;

  const user = await getServerAuthenticatedUser().catch(() => ({ status: "unavailable" as const }));
  const db = getTaskDb();
  let body: React.ReactNode;
  if (user.status === "unauthenticated") {
    body = (
      <p className={NOTE}>
        {copy.signInForEarnings}{" "}
        <a href={signInHref} className="font-medium text-brand-accent-text hover:underline">
          {copy.signIn}
        </a>
      </p>
    );
  } else if (user.status === "unavailable" || db === null) {
    body = <p className={NOTE}>{copy.unavailable}</p>;
  } else {
    let data: { earnings: MyEarnings; claims: readonly ClaimWithStats[] } | null = null;
    try {
      const [earnings, claims] = await Promise.all([
        getMyEarnings(db, user.userId),
        listMyClaims(db, user.userId),
      ]);
      data = { earnings, claims };
    } catch (error) {
      console.error("[earnings] load failed", error);
    }
    body = data === null ? <p className={NOTE}>{copy.unavailable}</p> : <Earnings locale={locale} {...data} />;
  }

  return (
    <section className="bg-brand-bg px-6 pt-14 pb-24 md:px-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-page-title text-text-dark-primary">{copy.earningsTitle}</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-[1.65] text-text-dark-secondary">
          {copy.earningsSubtitle}
        </p>
        <div className="mt-10">{body}</div>
      </div>
    </section>
  );
}

function Earnings({
  locale,
  earnings,
  claims,
}: {
  locale: string;
  earnings: MyEarnings;
  claims: readonly ClaimWithStats[];
}) {
  const copy = taskCopy(locale);
  const money = (figure: SummedFigure, currency: string) =>
    marked(figure, formatMoney(figure.total, currency, locale), copy);
  const count = (figure: SummedFigure) => marked(figure, formatCount(figure.total, locale), copy);
  const anyPartial = [...earnings.totals, ...earnings.byPlatform].some(hasPartial);
  return (
    <div className="space-y-10">
      <div>
        <h2 className={H2}>{copy.totals}</h2>
        {earnings.totals.length === 0 ? (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Stat label={copy.income} value="—" />
              <Stat label={copy.orders} value="—" />
              <Stat label={copy.adAmount} value="—" />
            </div>
            <p className="mt-3 text-[13.5px] text-text-dark-secondary">{copy.noSettlement}</p>
          </>
        ) : (
          earnings.totals.map((total) => (
            <div key={total.currency} className="mt-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label={`${copy.income} · ${total.currency}`} value={money(total.incomeMinor, total.currency)} />
                <Stat label={copy.orders} value={count(total.orders)} />
                <Stat label={`${copy.adAmount} · ${total.currency}`} value={money(total.adAmountMinor, total.currency)} />
              </div>
              <p className="mt-2 text-[13px] text-text-dark-secondary">
                {copy.period(formatDay(total.firstDay, locale), formatDay(total.lastDay, locale))}
              </p>
            </div>
          ))
        )}
      </div>

      {earnings.byPlatform.length > 0 && (
        <div>
          <h2 className={H2}>{copy.byPlatform}</h2>
          <div className="mt-4 overflow-x-auto rounded-card border border-brand-border-card">
            <table className="w-full text-left text-[14px]">
              <thead className="bg-brand-panel text-[12.5px] text-text-dark-secondary">
                <tr>
                  <th className={TH}>{copy.platform}</th>
                  <th className={TH}>{copy.orders}</th>
                  <th className={TH}>{copy.adAmount}</th>
                  <th className={TH}>{copy.income}</th>
                </tr>
              </thead>
              <tbody>
                {earnings.byPlatform.map((row) => (
                  <tr key={`${row.platform}-${row.currency}`} className="border-t border-brand-border-card text-text-dark-primary">
                    <td className={TD}>{row.platform}</td>
                    <td className={TD}>{count(row.orders)}</td>
                    <td className={TD}>{money(row.adAmountMinor, row.currency)}</td>
                    <td className={TD}>{money(row.incomeMinor, row.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {anyPartial && <p className="text-[13px] text-text-dark-secondary">{copy.partialNote}</p>}

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
          <div className="mt-4 overflow-x-auto rounded-card border border-brand-border-card">
            <table className="w-full text-left text-[14px]">
              <thead className="bg-brand-panel text-[12.5px] text-text-dark-secondary">
                <tr>
                  <th className={TH}>{copy.drama}</th>
                  <th className={TH}>{copy.channel}</th>
                  <th className={TH}>{copy.yourLink}</th>
                  <th className={TH}>{copy.clicks}</th>
                  <th className={TH}>{copy.claimedOn}</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((claim) => (
                  <tr key={claim.id} className="border-t border-brand-border-card text-text-dark-primary">
                    <td className={TD}>
                      <Link href={localePath(locale, `/tasks/${claim.dramaId}`)} className="hover:text-brand-accent-text">
                        {locale === "zh" && claim.dramaTitleCn ? claim.dramaTitleCn : claim.dramaTitle}
                      </Link>
                    </td>
                    <td className={TD}>{CHANNEL_LABELS[claim.channel]}</td>
                    <td className={`${TD} font-mono text-[12.5px] select-all`}>{promoLink(siteConfig.url, claim.code)}</td>
                    <td className={TD}>{formatCount(claim.clicks, locale)}</td>
                    <td className={TD}>{formatDay(claim.claimedAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const H2 = "text-[18px] font-semibold text-text-dark-primary";
const TH = "px-4 py-3 font-medium whitespace-nowrap";
const TD = "px-4 py-3 whitespace-nowrap";
const NOTE =
  "rounded-card border border-brand-border-card bg-brand-panel p-6 text-[14px] leading-[1.6] text-text-dark-secondary";

function hasPartial(figures: EarningsFigures): boolean {
  return figures.orders.partial || figures.adAmountMinor.partial || figures.incomeMinor.partial;
}

/** A total that leaves out days the platform did not report says so next to the number. */
function marked(figure: SummedFigure, formatted: string, copy: TaskCopy): string {
  return figure.partial ? copy.partialValue(formatted) : formatted;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-brand-border-card bg-brand-panel p-5">
      <p className="text-[12.5px] text-text-dark-secondary">{label}</p>
      <p className="mt-2 font-mono text-[24px] text-text-dark-primary">{value}</p>
    </div>
  );
}
