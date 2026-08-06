// @input  — next-intl, next/link, lucide-react, radix-ui NavigationMenu, config/navigation
// @output — ToolsMenu（桌面悬停下拉）与 ToolsMenuMobile（移动端展开列表）
// @pos    — Header 的免费工具子菜单，对应 SPEC 2.3.1
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import {
  ChevronDown,
  Compass,
  Network,
  ScanSearch,
  TrendingDown,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { NavigationMenu } from "radix-ui";
import type { NavMenuGroup } from "@/types";
import { localePath } from "@/lib/locale-path";

/**
 * Icon names are strings in `config/navigation` so that module stays plain data
 * (a footer server component imports it too). Resolving them here keeps the
 * lucide import specific rather than dynamic, so the bundle carries these five
 * icons and not the whole set.
 */
const ICONS: Record<string, LucideIcon> = {
  Compass,
  Network,
  ScanSearch,
  TrendingDown,
  Zap,
};

interface ToolsMenuProps {
  readonly groups: NavMenuGroup[];
  readonly locale: string;
  readonly triggerLabel: string;
}

function ToolLink({
  slug,
  icon,
  label,
  description,
  locale,
  onNavigate,
}: {
  readonly slug: string;
  readonly icon: string;
  readonly label: string;
  readonly description: string;
  readonly locale: string;
  readonly onNavigate?: () => void;
}) {
  const Icon = ICONS[icon] ?? Compass;
  return (
    <Link
      href={localePath(locale, `/tools/${slug}`)}
      onClick={onNavigate}
      className="group flex items-start gap-3 rounded-lg p-3 transition-colors hover:bg-brand-bg-alt focus-visible:bg-brand-bg-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/60"
    >
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-brand-border bg-brand-bg-alt text-brand-accent-text transition-colors group-hover:border-brand-accent/40">
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-text-dark-primary">
          {label}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-text-dark-secondary">
          {description}
        </span>
      </span>
    </Link>
  );
}

/**
 * The desktop submenu.
 *
 * Radix's NavigationMenu is used rather than a CSS `:hover` panel because a
 * hover-only menu is unreachable by keyboard and invisible to assistive tech:
 * this one opens on hover, on Enter and on arrow keys, closes on Escape, and
 * announces itself as an expandable button. The trigger does not navigate — the
 * hub link lives at the foot of the panel, so a pointer user does not lose
 * `/tools` and a keyboard user does not have to pass through it.
 */
export function ToolsMenu({ groups, locale, triggerLabel }: ToolsMenuProps) {
  const t = useTranslations();

  return (
    <NavigationMenu.Root delayDuration={100} className="relative">
      <NavigationMenu.List className="flex list-none items-center">
        <NavigationMenu.Item>
          <NavigationMenu.Trigger className="group flex items-center gap-1 text-sm text-text-dark-secondary transition-colors hover:text-text-dark-primary focus-visible:text-text-dark-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-bg data-[state=open]:text-text-dark-primary">
            {triggerLabel}
            <ChevronDown
              aria-hidden="true"
              className="size-4 transition-transform duration-200 group-data-[state=open]:rotate-180"
            />
          </NavigationMenu.Trigger>

          <NavigationMenu.Content className="absolute left-1/2 top-full z-50 mt-3 w-[560px] -translate-x-1/2 rounded-xl border border-brand-border bg-brand-bg p-3 shadow-2xl shadow-black/40">
            {groups.map((group) => (
              <div key={group.labelKey} className="mb-1 last:mb-0">
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-dark-secondary">
                  {t(group.labelKey)}
                </p>
                <ul className="grid list-none grid-cols-2 gap-1">
                  {group.items.map((item) => (
                    <li key={item.slug}>
                      <NavigationMenu.Link asChild>
                        <ToolLink
                          slug={item.slug}
                          icon={item.icon}
                          label={t(item.labelKey)}
                          description={t(item.descriptionKey)}
                          locale={locale}
                        />
                      </NavigationMenu.Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="mt-2 border-t border-brand-border pt-2">
              <NavigationMenu.Link asChild>
                <Link
                  href={localePath(locale, "/tools")}
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-brand-accent-text transition-colors hover:bg-brand-bg-alt focus-visible:bg-brand-bg-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/60"
                >
                  {t("nav.toolsMenu.viewAll")}
                  <span aria-hidden="true">→</span>
                </Link>
              </NavigationMenu.Link>
            </div>
          </NavigationMenu.Content>
        </NavigationMenu.Item>
      </NavigationMenu.List>
    </NavigationMenu.Root>
  );
}

/**
 * The same catalogue inside the mobile sheet.
 *
 * Hover has no meaning on touch and the sheet is already a disclosure, so the
 * tools are listed outright rather than hidden behind a second tap.
 */
export function ToolsMenuMobile({
  groups,
  locale,
  triggerLabel,
  onNavigate,
}: ToolsMenuProps & { readonly onNavigate: () => void }) {
  const t = useTranslations();

  return (
    <div>
      <Link
        href={localePath(locale, "/tools")}
        onClick={onNavigate}
        className="text-text-dark-secondary hover:text-text-dark-primary text-lg transition-colors"
      >
        {triggerLabel}
      </Link>

      {groups.map((group) => (
        <div key={group.labelKey} className="mt-3">
          <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-dark-secondary">
            {t(group.labelKey)}
          </p>
          <ul className="mt-1 list-none space-y-0.5">
            {group.items.map((item) => (
              <li key={item.slug}>
                <ToolLink
                  slug={item.slug}
                  icon={item.icon}
                  label={t(item.labelKey)}
                  description={t(item.descriptionKey)}
                  locale={locale}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
