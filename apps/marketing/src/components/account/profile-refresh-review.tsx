// @input  -- current website draft and one source-validated refresh proposal
// @output -- explicit field-level review actions; never mutates the draft by itself
// @pos    -- proposal gate between profile refresh and website draft editing
"use client";

import { useTranslations } from "next-intl";

import type { AgentProfileRefreshAvailability } from "../../lib/agents/profile-refresh-contract.ts";
import {
  WEBSITE_PROFILE_FIELD_NAMES,
  type MarketingWebsiteProfileV1,
  type WebsiteProfileFieldName,
} from "../../lib/account-websites/contracts.ts";
import { Button } from "../ui/button.tsx";

function sameValue(
  current: MarketingWebsiteProfileV1[WebsiteProfileFieldName],
  proposal: MarketingWebsiteProfileV1[WebsiteProfileFieldName],
): boolean {
  return JSON.stringify(current) === JSON.stringify(proposal);
}

function valueText(value: string | readonly string[]): string {
  if (typeof value !== "string") {
    return value.length === 0 ? "—" : value.join(" · ");
  }
  return value.trim() === "" ? "—" : value;
}

export function ProfileRefreshReview({
  current,
  proposal,
  availability,
  onApply,
  onDismiss,
}: {
  readonly current: MarketingWebsiteProfileV1;
  readonly proposal: MarketingWebsiteProfileV1;
  readonly availability: AgentProfileRefreshAvailability;
  readonly onApply: (fields: readonly WebsiteProfileFieldName[]) => void;
  readonly onDismiss: () => void;
}) {
  const t = useTranslations("account.websites.refresh");
  const fieldName = useTranslations("account.websites.fields");
  const changedFields = WEBSITE_PROFILE_FIELD_NAMES.filter(
    (field) => !sameValue(current[field], proposal[field]),
  );

  return (
    <section
      aria-labelledby="website-profile-refresh-title"
      className="rounded-card border border-brand-border-card bg-brand-panel p-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3
            id="website-profile-refresh-title"
            className="text-[16.5px] font-semibold text-text-dark-primary"
          >
            {t("title")}
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-text-dark-secondary">
            {t(availability)}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          {t("dismiss")}
        </Button>
      </div>

      {changedFields.length === 0 ? (
        <p className="mt-5 text-[13px] text-text-dark-secondary">
          {t("noChanges")}
        </p>
      ) : (
        <>
          <div className="mt-5 space-y-3">
            {changedFields.map((field) => {
              const provenance = proposal.fieldProvenance.find(
                (entry) => entry.path === "/" + field,
              );
              return (
                <article
                  key={field}
                  data-refresh-field={field}
                  className="rounded-[10px] border border-brand-border-card bg-brand-bg/60 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h4 className="text-[13px] font-semibold text-text-dark-primary">
                        {fieldName(field)}
                      </h4>
                      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div>
                          <dt className="font-mono text-[10px] tracking-[0.08em] text-text-dark-faint uppercase">
                            {t("current")}
                          </dt>
                          <dd className="mt-1 text-[12.5px] leading-relaxed text-text-dark-secondary">
                            {valueText(current[field])}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-mono text-[10px] tracking-[0.08em] text-brand-accent-text uppercase">
                            {t("proposed")}
                          </dt>
                          <dd className="mt-1 text-[12.5px] leading-relaxed text-text-dark-primary">
                            {valueText(proposal[field])}
                          </dd>
                        </div>
                      </dl>
                      {provenance === undefined ||
                      provenance.evidenceUrls.length === 0 ? null : (
                        <div className="mt-3">
                          <p className="font-mono text-[10px] text-text-dark-faint uppercase">
                            {t("evidence")}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                            {provenance.evidenceUrls.map((url) => (
                              <a
                                key={url}
                                href={url}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="max-w-full truncate text-[11px] text-brand-accent-text underline-offset-2 hover:underline"
                              >
                                {new URL(url).hostname}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onApply([field])}
                    >
                      {t("applyField")}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="mt-5 flex justify-end">
            <Button
              type="button"
              variant="cta"
              onClick={() => onApply(changedFields)}
            >
              {t("applyAll")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
