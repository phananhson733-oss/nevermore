// @input  -- children (React nodes), Next metadata
// @output -- compare section wrapper; retained for direct legacy URLs but not indexed
// @pos    -- layout for /compare/* routes
// once this file is updated, update header comments and _DIR.md in this folder
import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function CompareLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-brand-bg min-h-screen py-20 md:py-28">
      <div className="max-w-[1080px] mx-auto px-6">{children}</div>
    </div>
  );
}
