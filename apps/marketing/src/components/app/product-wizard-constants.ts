// @input  -- url-validation module
// @output -- REGIONS, EXPERIMENT_GOALS, CONVERSION_EVENTS, TOTAL_STEPS, isValidUrl, validateUrlPattern
// @pos    -- Products module, shared constants for ProductWizard (SPEC 3.3)
// Once this file is updated, update the header comment and the folder _DIR.md

import { validateUrlPattern } from "@/lib/url-validation";

export { validateUrlPattern } from "@/lib/url-validation";

export const REGIONS = [
  {
    value: "US",
    flag: "\u{1F1FA}\u{1F1F8}",
    label: { zh: "\u7F8E\u56FD", en: "United States" },
  },
  {
    value: "UK",
    flag: "\u{1F1EC}\u{1F1E7}",
    label: { zh: "\u82F1\u56FD", en: "United Kingdom" },
  },
  {
    value: "DE",
    flag: "\u{1F1E9}\u{1F1EA}",
    label: { zh: "\u5FB7\u56FD", en: "Germany" },
  },
  {
    value: "FR",
    flag: "\u{1F1EB}\u{1F1F7}",
    label: { zh: "\u6CD5\u56FD", en: "France" },
  },
  {
    value: "JP",
    flag: "\u{1F1EF}\u{1F1F5}",
    label: { zh: "\u65E5\u672C", en: "Japan" },
  },
  {
    value: "CN",
    flag: "\u{1F1E8}\u{1F1F3}",
    label: { zh: "\u4E2D\u56FD", en: "China" },
  },
  {
    value: "IN",
    flag: "\u{1F1EE}\u{1F1F3}",
    label: { zh: "\u5370\u5EA6", en: "India" },
  },
  {
    value: "BR",
    flag: "\u{1F1E7}\u{1F1F7}",
    label: { zh: "\u5DF4\u897F", en: "Brazil" },
  },
  {
    value: "AU",
    flag: "\u{1F1E6}\u{1F1FA}",
    label: { zh: "\u6FB3\u5927\u5229\u4E9A", en: "Australia" },
  },
  {
    value: "CA",
    flag: "\u{1F1E8}\u{1F1E6}",
    label: { zh: "\u52A0\u62FF\u5927", en: "Canada" },
  },
] as const;

export const EXPERIMENT_GOALS = [
  { value: "organic_signup_growth", label: "Organic Signup Growth" },
  { value: "organic_traffic_growth", label: "Organic Traffic Growth" },
  { value: "brand_awareness", label: "Brand Awareness" },
  { value: "lead_generation", label: "Lead Generation" },
] as const;

export const CONVERSION_EVENTS = [
  { value: "signup", label: "Signup" },
  { value: "purchase", label: "Purchase" },
  { value: "trial_start", label: "Trial Start" },
  { value: "contact_form", label: "Contact Form" },
  { value: "newsletter_subscribe", label: "Newsletter Subscribe" },
] as const;

export const TOTAL_STEPS = 4;

export function isValidUrl(str: string): boolean {
  return validateUrlPattern(str).valid;
}

export function normalizeUrl(str: string): string {
  const trimmed = str.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
