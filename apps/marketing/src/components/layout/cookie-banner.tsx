// @input  -- consent-panel, cookie-consent-state, lucide-react Settings icon
// @output -- CookieBanner component (banner + preferences modal + floating button)
// @pos    -- Global layout component for cookie consent, SPEC 2.4.1
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useState, useEffect, useRef } from "react";
import { Settings } from "lucide-react";
import { getStoredConsent } from "./cookie-consent-state";
import { ConsentPanel } from "./consent-panel";

export function CookieBanner({
  prefsOpen,
  onPrefsClose,
}: {
  prefsOpen?: boolean;
  onPrefsClose?: () => void;
}) {
  const [showBanner, setShowBanner] = useState(() => {
    if (typeof window === "undefined") return false;
    return getStoredConsent() === null;
  });
  const [showPreferences, setShowPreferences] = useState(false);

  const effectiveShowPrefs = showPreferences || (prefsOpen ?? false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const handleCloseBanner = () => setShowBanner(false);
  const handleClosePreferences = () => {
    setShowPreferences(false);
    onPrefsClose?.();
    triggerRef.current?.focus();
  };

  // Escape key + focus trap for preferences modal
  useEffect(() => {
    if (!effectiveShowPrefs) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowPreferences(false);
        onPrefsClose?.();
        triggerRef.current?.focus();
        return;
      }
      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    // Auto-focus first focusable element in modal
    if (modalRef.current) {
      const first = modalRef.current.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      first?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [effectiveShowPrefs, onPrefsClose]);

  return (
    <>
      {/* Initial banner -- fixed bottom */}
      {showBanner && (
        <div
          className="fixed right-0 bottom-0 left-0 z-50 flex justify-center p-4"
          role="region"
          aria-label="Cookie consent"
        >
          <ConsentPanel mode="banner" onClose={handleCloseBanner} />
        </div>
      )}

      {/* Preferences modal overlay */}
      {effectiveShowPrefs && (
        <div
          ref={modalRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-brand-bg/80 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClosePreferences();
          }}
        >
          <ConsentPanel mode="preferences" onClose={handleClosePreferences} />
        </div>
      )}

      {/* Floating button -- always visible after consent given */}
      {!showBanner && (
        <button
          ref={triggerRef}
          onClick={() => setShowPreferences(true)}
          className="fixed right-4 bottom-4 z-40 flex size-10 items-center justify-center rounded-full border border-brand-border-strong bg-brand-panel text-text-dark-secondary transition-colors hover:border-brand-accent/50 hover:text-text-dark-primary"
          aria-label="Cookie Preferences"
        >
          <Settings className="size-4" aria-hidden="true" />
        </button>
      )}
    </>
  );
}
