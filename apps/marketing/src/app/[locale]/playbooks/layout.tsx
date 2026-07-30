// @input  -- children (React nodes), Next metadata
// @output -- playbooks layout retained for direct legacy URLs without search indexing
// @pos    -- layout for /playbooks/* routes
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function PlaybooksLayout({ children }: { children: ReactNode }) {
  return children;
}
