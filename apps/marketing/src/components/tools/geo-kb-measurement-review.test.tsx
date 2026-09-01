// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../i18n/messages/en.json";
import { emptyMarketingWebsiteProfile } from "../../lib/account-websites/contracts.ts";
import { emptyGeoKbPayload } from "../../lib/geo-tools/kb-contract.ts";
import { GeoKbMeasurementReview } from "./geo-kb-measurement-review.tsx";

describe("measurement source review", () => {
  it("renders all source competitors and changes only explicit field selections after applying", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    const profile = { ...emptyMarketingWebsiteProfile(), productName: "Acme", categories: ["analytics"], country: "US", locale: "en", directCompetitors: ["one.com", "two.com", "three.com", "four.com", "five.com", "six.com"] };
    const payload = { ...emptyGeoKbPayload("https://example.com"), officialName: "Custom name", categoryTerms: ["old category"] };
    const onApply = vi.fn();
    await act(async () => root.render(<NextIntlClientProvider locale="en" messages={en}><GeoKbMeasurementReview profile={profile} payload={payload} disabled={false} onApply={onApply} /></NextIntlClientProvider>));
    expect(host.textContent).toContain("six.com");
    expect(host.querySelectorAll('input[data-competitor-choice]')).toHaveLength(6);
    expect([...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(input => !input.checked)).toBe(true);
    const category = host.querySelector<HTMLInputElement>('input[data-measurement-field="categoryTerms"]')!;
    await act(async () => category.click());
    expect(onApply).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>('button[data-apply-measurements]')!.click());
    expect(onApply).toHaveBeenCalledWith({ ...payload, categoryTerms: ["analytics"] });
    await act(async () => root.unmount()); host.remove();
  });
});
