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
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
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
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
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
          className="fixed bottom-0 left-0 right-0 z-50 p-4 flex justify-center"
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
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClosePreferences();
          }}
        >
          <ConsentPanel
            mode="preferences"
            onClose={handleClosePreferences}
          />
        </div>
      )}

      {/* Floating button -- always visible after consent given */}
      {!showBanner && (
        <button
          ref={triggerRef}
          onClick={() => setShowPreferences(true)}
          className="fixed bottom-4 right-4 z-40 size-10 rounded-full bg-brand-bg-alt border border-brand-border flex items-center justify-center text-text-dark-secondary hover:text-text-dark-primary transition-colors shadow-lg"
          aria-label="Cookie Preferences"
        >
          <Settings className="size-4" aria-hidden="true" />
        </button>
      )}
    </>
  );
}
