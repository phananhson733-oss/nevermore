// @input  -- locale-aware account destinations and private route content
// @output -- responsive settings frame with only real Websites/Credits/Agents links
// @pos    -- shared visual shell for every /account route
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Bot, Globe2, Zap } from "lucide-react";
import { useTranslations } from "next-intl";

import { localePath } from "../../lib/locale-path.ts";
import { cn } from "../../lib/utils.ts";

export function AccountSettingsShell({
  children,
  locale,
}: {
  readonly children: React.ReactNode;
  readonly locale: string;
}) {
  const pathname = usePathname();
  const t = useTranslations("account.settings");
  const destinations = [
    {
      label: t("websites"),
      href: localePath(locale, "/account/websites"),
      active: pathname.includes("/account/websites"),
      icon: Globe2,
    },
    {
      label: t("credits"),
      href: localePath(locale, "/account/credits"),
      active: pathname.includes("/account/credits"),
      icon: Zap,
    },
    {
      label: t("agents"),
      href: localePath(locale, "/agents"),
      active: false,
      icon: Bot,
    },
  ] as const;

  return (
    <section className="min-h-screen bg-brand-bg px-5 pt-8 pb-24 sm:px-7 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <Link
          href={localePath(locale)}
          className="inline-flex items-center gap-2 rounded-[8px] text-[12px] text-text-dark-secondary transition-colors hover:text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          {t("back")}
        </Link>
        <p className="mt-8 font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
          {t("eyebrow")}
        </p>
        <h1 className="text-page-title mt-3 text-text-dark-primary">
          {t("title")}
        </h1>

        <div className="mt-8 grid items-start gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
          <aside className="lg:sticky lg:top-24">
            <nav
              aria-label={t("navigation")}
              className="grid grid-cols-3 gap-2 lg:grid-cols-1"
            >
              {destinations.map(({ label, href, active, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex min-h-11 items-center justify-center gap-2 rounded-[10px] border px-3 py-2.5 text-[13px] font-medium transition-colors lg:justify-start",
                    active
                      ? "border-brand-border-card bg-brand-panel-raised text-text-dark-primary"
                      : "border-transparent text-text-dark-secondary hover:border-brand-border-card hover:bg-brand-panel/60 hover:text-text-dark-primary",
                  )}
                >
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      "size-4 transition-colors",
                      active
                        ? "text-brand-accent-text"
                        : "text-text-dark-faint group-hover:text-text-dark-secondary",
                    )}
                  />
                  <span>{label}</span>
                </Link>
              ))}
            </nav>
          </aside>

          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </section>
  );
}
