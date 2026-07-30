// @input  -- localStorage consent/visitor keys
// @output -- ConsentState type, consent read/write helpers, visitor ID helper
// @pos    -- Cookie consent data layer, shared by cookie-banner.tsx and consent-panel.tsx
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

const CONSENT_STORAGE_KEY = "gengrowth_consent";
export const CONSENT_VERSION = "1.0";

export interface ConsentState {
  consent_version: string;
  necessary: boolean;
  analytics: boolean;
  marketing: boolean;
  updated_at: string;
}

export function getStoredConsent(): ConsentState | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(CONSENT_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function saveConsent(consent: ConsentState) {
  localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(consent));
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
