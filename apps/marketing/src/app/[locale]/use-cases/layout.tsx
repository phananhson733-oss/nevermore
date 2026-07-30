// @input  -- children (React nodes), Next metadata
// @output -- use-cases layout retained for direct legacy URLs without search indexing
// @pos    -- layout for /use-cases/* routes
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function UseCasesLayout({ children }: { children: ReactNode }) {
  return children;
}
