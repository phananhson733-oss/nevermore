import { routing } from "./i18n/routing";

export type RetiredMarketingRouteDisposition =
  | {
      readonly kind: "gone";
    }
  | {
      readonly kind: "redirect";
      readonly location: string;
    };

const DEFAULT_LOCALE = routing.defaultLocale;
const RETIRED_ROUTE_PREFIXES = [
  "/glossary/",
  "/playbooks/",
  "/use-cases/",
  "/compare/",
] as const;
const RETIRED_ROUTE_EXACT = new Set([
  "/about",
  "/features",
  "/glossary",
  "/templates",
  "/playbooks",
  "/use-cases",
  "/blog/gengrowth-vs-blaze",
  "/blog/gengrowth-vs-cometly",
  "/blog/gengrowth-vs-okara",
  "/tools/ab-test-calculator",
  "/tools/growth-roi-calculator",
]);

const REDIRECT_ROUTE_EXACT = {
  "/compare": "/blog#comparisons",
  "/tools/seo-audit": "/agents/seo",
  "/tools/internal-link-audit": "/agents/tech",
} as const;

function splitLocalePath(pathname: string): {
  readonly locale: (typeof routing.locales)[number];
  readonly remainder: string;
} {
  for (const locale of routing.locales) {
    const prefix = `/${locale}`;
    if (pathname === prefix) {
      return { locale, remainder: "/" };
    }
    if (pathname.startsWith(`${prefix}/`)) {
      return { locale, remainder: pathname.slice(prefix.length) || "/" };
    }
  }

  return { locale: DEFAULT_LOCALE, remainder: pathname || "/" };
}

function localePublicPath(
  locale: (typeof routing.locales)[number],
  path: string,
): string {
  if (locale === DEFAULT_LOCALE) return path;
  return `/${locale}${path}`;
}

/**
 * Explicit retired-route boundary for the B4 closeout only.
 *
 * This is intentionally NOT a claim that we recovered every historical broken
 * marketing URL. It is the auditable subset we can justify from the 2026-08-05
 * review instructions and the current legacy route surface:
 *
 * - exact semantic replacements keep a redirect;
 * - broad retired surfaces without an equivalent now return 410;
 * - the unverified glossary corpus remains retired, so its former generic
 *   redirect is now a truthful 410 until a vetted corpus exists.
 */
export function getRetiredMarketingRouteDisposition(
  pathname: string,
): RetiredMarketingRouteDisposition | null {
  const { locale, remainder } = splitLocalePath(pathname);

  if (remainder in REDIRECT_ROUTE_EXACT) {
    return {
      kind: "redirect",
      location: localePublicPath(
        locale,
        REDIRECT_ROUTE_EXACT[remainder as keyof typeof REDIRECT_ROUTE_EXACT],
      ),
    };
  }

  if (RETIRED_ROUTE_EXACT.has(remainder)) {
    return { kind: "gone" };
  }

  if (
    RETIRED_ROUTE_PREFIXES.some((prefix) => remainder.startsWith(prefix))
  ) {
    return { kind: "gone" };
  }

  return null;
}
