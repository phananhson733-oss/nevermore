// @input  -- localStorage consent/visitor keys
// @output -- validated consent storage, same-tab updates, and visitor ID helper
// @pos    -- Cookie consent data layer, shared by cookie-banner.tsx and consent-panel.tsx
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

const CONSENT_STORAGE_KEY = "gengrowth_consent";
export const CONSENT_VERSION = "1.0";
export const CONSENT_UPDATED_EVENT = "gengrowth:consent-updated";

export interface ConsentState {
  consent_version: string;
  necessary: boolean;
  analytics: boolean;
  marketing: boolean;
  updated_at: string;
}

export function isConsentState(value: unknown): value is ConsentState {
  if (!value || typeof value !== "object") return false;
  const consent = value as Partial<ConsentState>;
  return (
    consent.consent_version === CONSENT_VERSION &&
    consent.necessary === true &&
    typeof consent.analytics === "boolean" &&
    typeof consent.marketing === "boolean" &&
    typeof consent.updated_at === "string"
  );
}

export function getStoredConsent(): ConsentState | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(CONSENT_STORAGE_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : null;
    return isConsentState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveConsent(consent: ConsentState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(consent));
  window.dispatchEvent(
    new CustomEvent<ConsentState>(CONSENT_UPDATED_EVENT, { detail: consent }),
  );
}

const VISITOR_ID_KEY = "gengrowth_visitor_id";

export function getOrCreateVisitorId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(VISITOR_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(VISITOR_ID_KEY, id);
  }
  return id;
}
