// @input  -- locale, message namespace, tool path, and the Google grant state
// @output -- the connect prompt for a tool that has no Search Console grant yet
// @pos    -- shared pre-connection surface for every GSC-backed public tool
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import type { ReactNode } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { GoogleConsentNotice } from "@/lib/tools/traffic-drop-session";
import { localePath } from "@/lib/locale-path";

interface GscConnectPanelProps {
  readonly locale: string;
  /** Message namespace, e.g. `tools.quickWins`. Key names are shared. */
  readonly namespace: string;
  /** Where Google should send the visitor back to. */
  readonly toolPath: string;
  readonly sectionId: string;
  readonly icon: ReactNode;
  readonly connectEnabled: boolean;
  readonly consentNotice: GoogleConsentNotice;
  /** Rendered when the panel needs an extra line, e.g. an invite request link. */
  readonly inviteRequestLabel?: string;
}

/**
 * The pre-connection panel, shared by every tool that reads Search Console.
 *
 * Extracted when the second such tool arrived. The three consent states are
 * not cosmetic variants: what Google is about to put in front of the visitor
 * differs, and a visitor who was told what to expect has learned something
 * while a visitor stopped by Google unprepared has learned to distrust us.
 * Keeping one implementation is what keeps the two tools telling the same
 * story about the same OAuth flow.
 *
 * `traffic-drop-tool.tsx` still carries its own copy of this markup and
 * should be migrated onto this component; that is a separate change from
 * adding the second consumer.
 */
export function GscConnectPanel({
  locale,
  namespace,
  toolPath,
  sectionId,
  icon,
  connectEnabled,
  consentNotice,
  inviteRequestLabel,
}: GscConnectPanelProps) {
  const t = useTranslations(namespace);
  const authorizeHref = `/api/auth/google/start?scope=gsc&next=${encodeURIComponent(
    localePath(locale, toolPath),
  )}`;

  return (
    <section
      id={sectionId}
      data-locale={locale}
      className="scroll-mt-8 rounded-2xl border border-brand-border/70 bg-brand-bg-alt/35 p-6 md:p-7"
    >
      <div className="flex size-11 items-center justify-center rounded-xl border border-brand-accent/30 bg-brand-accent/10 text-brand-accent-text">
        {icon}
      </div>
      <h2 className="mt-4 text-[20px] font-semibold tracking-[-0.02em] text-text-dark-primary">
        {t("connectTitle")}
      </h2>
      <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-text-dark-secondary">
        {t("connectBody")}
      </p>

      {!connectEnabled ? (
        <p className="mt-5 rounded-xl border border-brand-border/60 bg-brand-bg/60 p-4 text-[13px] leading-relaxed text-text-dark-secondary">
          {t("connectPending")}
        </p>
      ) : consentNotice === "invite_only" ? (
        /*
         * The consent screen is in Testing: only accounts on its tester list
         * can authorize, everyone else is hard-blocked. The notice leads and
         * the authorize link stays secondary — an invited tester loses one
         * click, a stranger learns why instead of hitting a wall.
         */
        <div className="mt-5 rounded-xl border border-brand-warning/30 bg-[rgba(212,168,67,0.07)] p-4">
          <p className="text-[13px] font-semibold text-text-dark-primary">
            {t("inviteOnlyTitle")}
          </p>
          <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-text-dark-secondary">
            {t("inviteOnlyBody")}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <a
              href={authorizeHref}
              className="inline-flex min-h-9 items-center gap-1.5 text-[13px] font-semibold text-brand-accent-text hover:underline"
            >
              {t("inviteOnlyCta")}
              <ArrowRight aria-hidden="true" className="size-4" />
            </a>
            {inviteRequestLabel ? (
              <Link
                href={localePath(locale, "/contact")}
                className="text-[13px] text-text-dark-secondary hover:underline"
              >
                {inviteRequestLabel}
              </Link>
            ) : null}
          </div>
        </div>
      ) : consentNotice === "unverified" ? (
        /*
         * Published, but Google has not finished verifying the sensitive
         * scope, so everyone passes an "app isn't verified" interstitial.
         * Anyone can get through, so the button stays primary — but the
         * screen they are about to meet is described first. Being surprised
         * by that page is what loses people; being told about it beforehand
         * mostly does not.
         */
        <div className="mt-5 space-y-4">
          <div className="rounded-xl border border-brand-warning/30 bg-[rgba(212,168,67,0.07)] p-4">
            <p className="text-[13px] font-semibold text-text-dark-primary">
              {t("unverifiedTitle")}
            </p>
            <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-text-dark-secondary">
              {t("unverifiedBody")}
            </p>
            <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-text-dark-secondary">
              {t("unverifiedScope")}
            </p>
          </div>
          <ConnectCta href={authorizeHref} cta={t("connectCta")} trust={t("connectTrust")} />
        </div>
      ) : (
        <div className="mt-5">
          <ConnectCta href={authorizeHref} cta={t("connectCta")} trust={t("connectTrust")} />
        </div>
      )}
    </section>
  );
}

function ConnectCta({
  href,
  cta,
  trust,
}: {
  readonly href: string;
  readonly cta: string;
  readonly trust: string;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <a
        href={href}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-accent px-5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-accent-hover"
      >
        {cta}
        <ArrowRight aria-hidden="true" className="size-4" />
      </a>
      <p className="flex items-center gap-2 text-[12px] text-text-dark-secondary">
        <ShieldCheck aria-hidden="true" className="size-4" />
        {trust}
      </p>
    </div>
  );
}
