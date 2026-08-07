// @input  -- coming-soon copy from the server page, shared WaitlistForm
// @output -- the page's primary CTA: a working waitlist email capture
// @pos    -- client boundary of the hidden-keywords coming-soon page
"use client";

import { WaitlistForm } from "@/components/waitlist/waitlist-form";
import type { HiddenKeywordsComingSoonContent } from "./coming-soon-content";

export function ComingSoonWaitlist({
  content,
}: {
  readonly content: HiddenKeywordsComingSoonContent;
}) {
  return (
    <div className="rounded-card border-brand-border-card bg-brand-panel mt-8 max-w-xl border p-[26px]">
      <h2 className="text-[16.5px] font-semibold text-text-dark-primary">
        {content.waitlistTitle}
      </h2>
      <p className="mt-2 text-[13px] leading-[1.6] text-text-dark-secondary">
        {content.waitlistBody}
      </p>
      <WaitlistForm
        onSuccess={() => {}}
        source="tools-hidden-keywords"
        copy={{
          submit: content.submitLabel,
          successTitle: content.successTitle,
          successDesc: content.successDesc,
        }}
      />
    </div>
  );
}
