// @input  — next-intl, next/link, lucide-react, radix-ui NavigationMenu, config/navigation
// @output — NavSubmenu（桌面悬停下拉）与 NavSubmenuMobile（移动端展开列表）
// @pos    — Header 的通用目录子菜单，对应 SPEC 2.3.1
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import {
  ChevronDown,
  Compass,
  ScanSearch,
  Wrench,
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
 * lucide import specific rather than dynamic.
 */
const ICONS: Record<string, LucideIcon> = {
  Compass,
  ScanSearch,
  Wrench,
};

interface NavSubmenuProps {
  readonly basePath: string;
  readonly groups: NavMenuGroup[];
  readonly locale: string;
  readonly triggerLabel: string;
  readonly viewAllLabelKey: string;
}

function MenuLink({
  basePath,
  slug,
  icon,
  label,
  description,
  locale,
  onNavigate,
}: {
  readonly basePath: string;
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
      href={localePath(locale, `${basePath}/${slug}`)}
      onClick={onNavigate}
      className="group flex items-start gap-3 rounded-row p-3 transition-colors hover:bg-brand-panel focus-visible:bg-brand-panel focus-visible:ring-2 focus-visible:ring-brand-accent/60 focus-visible:outline-none"
    >
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-brand-border-strong bg-brand-panel text-brand-accent-text transition-colors group-hover:border-brand-accent/40">
        <Icon aria-hidden="true" className="size-[18px]" />
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] leading-snug font-semibold text-text-dark-primary transition-colors group-hover:text-brand-accent-text">
          {label}
        </span>
        <span className="mt-1 block text-[12px] leading-[1.6] text-text-dark-secondary">
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
 * directory link lives at the foot of the panel, so pointer and keyboard users
 * can still reach the parent route.
 */
export function NavSubmenu({
  basePath,
  groups,
  locale,
  triggerLabel,
  viewAllLabelKey,
}: NavSubmenuProps) {
  const t = useTranslations();

  return (
    <NavigationMenu.Root delayDuration={100} className="relative">
      <NavigationMenu.List className="flex list-none items-center">
        <NavigationMenu.Item>
          <NavigationMenu.Trigger className="group flex items-center gap-1 text-[13.5px] text-text-dark-secondary transition-colors hover:text-text-dark-primary focus-visible:text-text-dark-primary focus-visible:ring-2 focus-visible:ring-brand-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-bg focus-visible:outline-none data-[state=open]:text-text-dark-primary">
            {triggerLabel}
            <ChevronDown
              aria-hidden="true"
              className="size-4 transition-transform duration-200 group-data-[state=open]:rotate-180"
            />
          </NavigationMenu.Trigger>

          {/* A raised panel, not the page surface: this floats above the header
              and needs to read as a layer. Signal Console allows a shadow here
              (Design Spec 05) — it is the panel shadow, not a glow. */}
          <NavigationMenu.Content className="absolute top-full left-1/2 z-50 mt-3 w-[560px] -translate-x-1/2 rounded-card border border-brand-border-card bg-brand-panel-raised p-3 shadow-panel">
            {groups.map((group) => (
              <div key={group.labelKey} className="mb-1 last:mb-0">
                {/* mono + uppercase: the eyebrow/label role, per Design Spec 02 */}
                <p className="px-3 pt-2 pb-1.5 font-mono text-[10.5px] tracking-[0.14em] text-text-dark-secondary uppercase">
                  {t(group.labelKey)}
                </p>
                <ul className="grid list-none grid-cols-2 gap-1">
                  {group.items.map((item) => (
                    <li key={item.slug}>
                      <NavigationMenu.Link asChild>
                        <MenuLink
                          basePath={basePath}
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
                  href={localePath(locale, basePath)}
                  className="group flex items-center justify-between rounded-row px-3 py-2.5 font-mono text-[10.5px] tracking-[0.06em] text-brand-accent-text uppercase transition-colors hover:bg-brand-panel focus-visible:bg-brand-panel focus-visible:ring-2 focus-visible:ring-brand-accent/60 focus-visible:outline-none"
                >
                  {t(viewAllLabelKey)}
                  <span
                    aria-hidden="true"
                    className="transition-transform duration-200 group-hover:translate-x-0.5"
                  >
                    &rarr;
                  </span>
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
 * destinations are listed outright rather than hidden behind a second tap.
 */
export function NavSubmenuMobile({
  basePath,
  groups,
  locale,
  triggerLabel,
  viewAllLabelKey: _viewAllLabelKey,
  onNavigate,
}: NavSubmenuProps & { readonly onNavigate: () => void }) {
  const t = useTranslations();

  return (
    <div>
      <Link
        href={localePath(locale, basePath)}
        onClick={onNavigate}
        className="text-lg text-text-dark-secondary transition-colors hover:text-text-dark-primary"
      >
        {triggerLabel}
      </Link>

      {groups.map((group) => (
        <div key={group.labelKey} className="mt-3">
          <p className="px-1 font-mono text-[10.5px] tracking-[0.14em] text-text-dark-secondary uppercase">
            {t(group.labelKey)}
          </p>
          <ul className="mt-1 list-none space-y-0.5">
            {group.items.map((item) => (
              <li key={item.slug}>
                <MenuLink
                  basePath={basePath}
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
