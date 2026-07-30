// @input  -- children (React nodes)
// @output -- compare section layout wrapper with consistent max-width container
// @pos    -- layout for /compare/* routes
// once this file is updated, update header comments and _DIR.md in this folder
import type { ReactNode } from "react";

export default function CompareLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-brand-bg min-h-screen py-20 md:py-28">
      <div className="max-w-[1080px] mx-auto px-6">{children}</div>
    </div>
  );
}
