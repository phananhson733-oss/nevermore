// @input  -- HomePage component, trial-context (waitlist-context.tsx)
// @output -- Homepage client render entry
// @pos    -- Homepage client wrapper, referenced by page.tsx server component
// Once this file is updated, update header comment and folder _DIR.md
"use client";

import { HomePage } from "@/components/home/home-page";
import { useTrial } from "@/components/layout/waitlist-context";

export default function HomePageClient() {
  const { openTrial, openWaitlist } = useTrial();

  return <HomePage onOpenTrial={openTrial} onOpenWaitlist={openWaitlist} />;
}
