import type { ReactNode } from "react";

/**
 * Page header contract: exactly one <h1 data-wb-page-title> per page. The
 * legacy `data-app-page-title` attribute is NOT used here on purpose — its
 * global !important rule forces 32–48px, the design is 24px.
 */
export function PageHead({
  title,
  subtitle,
  aside,
}: {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly aside?: ReactNode | undefined;
}) {
  return (
    <div className="mb-8">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 data-wb-page-title="" className="text-2xl font-bold tracking-tight text-slate-900">
          {title}
        </h1>
        {aside ? <div className="flex items-center gap-2">{aside}</div> : null}
      </div>
      {subtitle ? <p className="max-w-3xl text-[13px] text-slate-500">{subtitle}</p> : null}
    </div>
  );
}
