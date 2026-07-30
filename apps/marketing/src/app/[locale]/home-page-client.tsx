// @input  -- HomePage component
// @output -- Homepage client render entry
// @pos    -- Homepage client wrapper, referenced by page.tsx server component
// Once this file is updated, update header comment and folder _DIR.md
"use client";

import { HomePage } from "@/components/home/home-page";

export default function HomePageClient() {
  return <HomePage />;
}
