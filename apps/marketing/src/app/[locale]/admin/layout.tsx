// @input  -- all /admin/* children
// @output -- a request-rendered, noindex frame; each page does its own admin check
// @pos    -- layout boundary for the internal admin pages
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "任务后台",
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

// The check lives in every page, not here: a layout is not re-rendered on
// every request for a child segment, so it cannot be the only gate.
export default function AdminLayout({ children }: { readonly children: ReactNode }) {
  return <section className="min-h-screen bg-brand-bg px-6 pt-10 pb-24 md:px-8">{children}</section>;
}
