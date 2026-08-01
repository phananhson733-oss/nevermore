import type { ReactNode } from "react";
import {
  ChartNoAxesCombined,
  CircleHelp,
  LayoutDashboard,
  Map,
  Plus,
  Settings,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { signOutAction } from "@/lib/auth/actions";
import { cx, LocaleSwitch } from "@/components/ui";
import {
  PRIMARY_NAV_ITEMS,
  type PrimaryNavKey,
  type PrimaryNavLabelKey,
} from "./nav-model";
import navStyles from "./app-nav.module.css";
import styles from "./app-shell.module.css";

const PRIMARY_NAV_ICONS: Readonly<
  Record<PrimaryNavKey, typeof LayoutDashboard>
> = {
  overview: LayoutDashboard,
  "growth-map": Map,
  execution: Wrench,
  results: ChartNoAxesCombined,
};

interface AppShellCommonProps {
  readonly children: ReactNode;
  readonly projectControl: ReactNode;
  readonly navigation: ReactNode;
  readonly breadcrumbRoot: ReactNode;
  readonly breadcrumbCurrent: ReactNode;
  readonly statusLabel: ReactNode;
}

export type AppShellProps = AppShellCommonProps &
  (
    | {
        readonly state: "project";
        readonly sidebarPanel: ReactNode;
        readonly settingsHref: string;
      }
    | {
        readonly state: "empty-project";
        readonly sidebarPanel?: never;
        readonly settingsHref?: never;
      }
  );

/**
 * The one customer-visible GenGrowth chrome. Project routes and the zero-project
 * entry route only supply truthful stateful slots; sidebar, topbar, language,
 * account, utilities, and responsive behavior stay in one implementation.
 */
export async function AppShell({
  children,
  state,
  projectControl,
  navigation,
  sidebarPanel,
  settingsHref,
  breadcrumbRoot,
  breadcrumbCurrent,
  statusLabel,
}: AppShellProps) {
  const tShell = await getTranslations("appShell");
  const tNav = await getTranslations("nav");

  return (
    <div
      className={styles.shell}
      data-app-shell=""
      data-app-shell-state={state}
    >
      <a className={styles.skipLink} href="#main-content">
        {tShell("skipToContent")}
      </a>

      <aside className={styles.sidebar} data-app-shell-sidebar="">
        <div className={styles.brand} aria-label="GenGrowth">
          <span className={styles.brandMark} aria-hidden="true">
            G
          </span>
          <span className={styles.brandCopy}>
            <span className={styles.brandWord}>GenGrowth</span>
            <span className={styles.brandTagline}>
              {tShell("brandTagline")}
            </span>
          </span>
        </div>

        {projectControl}
        {navigation}
        {sidebarPanel}

        <div
          className={styles.sidebarUtilities}
          role="group"
          aria-label={tShell("productTools")}
        >
          {state === "empty-project" ? (
            <span
              className={cx(
                styles.newProjectLink,
                styles.newProjectLinkActive,
              )}
              aria-current="page"
            >
              <Plus aria-hidden="true" size={17} strokeWidth={1.8} />
              <span>{tNav("newProject")}</span>
            </span>
          ) : (
            <Link href="/new-project" className={styles.newProjectLink}>
              <Plus aria-hidden="true" size={17} strokeWidth={1.8} />
              <span>{tNav("newProject")}</span>
            </Link>
          )}
          <button
            type="button"
            className={styles.sidebarUtility}
            aria-label={tShell("help")}
            title={`${tShell("help")} — ${tShell("comingSoon")}`}
            disabled
          >
            <CircleHelp aria-hidden="true" size={17} strokeWidth={1.8} />
            <span>{tShell("help")}</span>
          </button>
          {state === "project" ? (
            <Link
              href={settingsHref}
              className={styles.sidebarUtility}
              aria-label={tShell("settings")}
            >
              <Settings aria-hidden="true" size={17} strokeWidth={1.8} />
              <span>{tShell("settings")}</span>
            </Link>
          ) : (
            <button
              type="button"
              className={styles.sidebarUtility}
              aria-label={tShell("settings")}
              title={`${tShell("settings")} — ${tShell("comingSoon")}`}
              disabled
            >
              <Settings aria-hidden="true" size={17} strokeWidth={1.8} />
              <span>{tShell("settings")}</span>
            </button>
          )}
        </div>
      </aside>

      <div className={styles.body}>
        <header className={styles.topbar} data-app-shell-topbar="">
          <nav className={styles.breadcrumb} aria-label={tShell("breadcrumb")}>
            <span className={styles.crumbRoot}>{breadcrumbRoot}</span>
            <span className={styles.crumbSep} aria-hidden="true">
              /
            </span>
            <span className={styles.crumbCurrent} aria-current="page">
              {breadcrumbCurrent}
            </span>
          </nav>

          <div className={styles.topbarActions}>
            <span className={styles.stagePill}>
              <span aria-hidden="true" />
              {statusLabel}
            </span>
            <LocaleSwitch aria-label={tShell("localeSwitch")} />
            <div
              className={styles.account}
              role="group"
              aria-label={tShell("account")}
            >
              <span className={styles.accountLabel}>{tShell("account")}</span>
              <form action={signOutAction}>
                <button
                  className={styles.logoutButton}
                  type="submit"
                  aria-label={tNav("logout")}
                  title={tNav("logout")}
                >
                  <span className={styles.accountMonogram} aria-hidden="true">
                    GG
                  </span>
                </button>
              </form>
            </div>
          </div>
        </header>

        <main id="main-content" className={styles.main}>
          {children}
        </main>
      </div>
    </div>
  );
}

export function NewProductControl({
  title,
  detail,
}: {
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <div
      className={cx(styles.projectSwitcher, styles.newProjectControl)}
      data-new-product-control=""
      role="group"
      aria-label={title}
    >
      <span className={styles.projectAvatar} aria-hidden="true">
        +
      </span>
      <span className={styles.projectIdentity}>
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
    </div>
  );
}

export function LockedProjectNavigation({
  ariaLabel,
  lockedLabel,
  labels,
}: {
  readonly ariaLabel: string;
  readonly lockedLabel: string;
  readonly labels: Readonly<Record<PrimaryNavLabelKey, string>>;
}) {
  return (
    <nav
      className={navStyles.nav}
      aria-label={ariaLabel}
      aria-describedby="locked-project-navigation-reason"
      tabIndex={0}
      data-app-shell-locked-navigation=""
      data-project-navigation-state="disabled"
    >
      <p
        id="locked-project-navigation-reason"
        className={navStyles.lockedReason}
      >
        {lockedLabel}
      </p>
      {PRIMARY_NAV_ITEMS.map((item) => {
        const Icon = PRIMARY_NAV_ICONS[item.key];
        return (
          <div className={navStyles.entry} key={item.key}>
            <button
              type="button"
              className={cx(navStyles.item, navStyles.lockedItem)}
              title={lockedLabel}
              disabled
              aria-describedby="locked-project-navigation-reason"
              data-workspace-module={item.key}
            >
              <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
              <span>{labels[item.labelKey]}</span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}

export function SidebarProgress({
  title,
  stage,
  summary,
  progressLabel,
  value,
  max,
}: {
  readonly title: string;
  readonly stage: string;
  readonly summary: string;
  readonly progressLabel: string;
  readonly value: number;
  readonly max: number;
}) {
  return (
    <section className={styles.program} aria-label={title}>
      <div className={styles.programHeader}>
        <span className={styles.programTitle}>{title}</span>
        <span className={styles.programStage}>{stage}</span>
      </div>
      <strong className={styles.programDay}>{summary}</strong>
      <progress
        className={styles.programProgress}
        aria-label={progressLabel}
        aria-valuemin={1}
        aria-valuenow={value}
        aria-valuemax={max}
        max={max}
        value={value}
      />
    </section>
  );
}
