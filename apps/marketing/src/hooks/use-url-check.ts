// @input  -- URL string from wizard input
// @output -- useUrlCheck hook: { checking, patternError, reachable, reachError, check }
// @pos    -- custom hook for URL validation in product/trial wizards
// Once this file is updated, update the header comment and the folder _DIR.md
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { validateUrlPattern } from "@/lib/url-validation";

interface UrlCheckState {
  /** Backend reachability check in progress */
  readonly checking: boolean;
  /** i18n key for pattern validation error (instant, client-side) */
  readonly patternError: string | null;
  /** URL is reachable (null = not yet checked) */
  readonly reachable: boolean | null;
  /** i18n key for reachability error (async, server-side) */
  readonly reachError: string | null;
  /** Trigger a reachability check */
  readonly check: () => void;
  /** Reset all state */
  readonly reset: () => void;
}

export function useUrlCheck(url: string): UrlCheckState {
  const [checking, setChecking] = useState(false);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [reachError, setReachError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastCheckedUrl = useRef<string>("");

  // Pattern validation (synchronous, runs on every render with new url)
  const patternResult = url ? validateUrlPattern(url) : { valid: false, errorKey: null };
  const patternError = url ? patternResult.errorKey : null;

  // Reset reachability state when URL changes
  useEffect(() => {
    if (url !== lastCheckedUrl.current) {
      setReachable(null);
      setReachError(null);
    }
  }, [url]);

  const reset = useCallback(() => {
    setChecking(false);
    setReachable(null);
    setReachError(null);
    lastCheckedUrl.current = "";
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const check = useCallback(async () => {
    if (!url || !patternResult.valid) return;
    if (url === lastCheckedUrl.current && reachable !== null) return;

    // Cancel any in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;
    lastCheckedUrl.current = url;

    setChecking(true);
    setReachable(null);
    setReachError(null);

    try {
      const res = await fetch("/api/url-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      const json = await res.json();
      const data = json.data;

      setReachable(data.reachable);
      setReachError(data.reachable ? null : data.errorKey);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setReachable(false);
      setReachError("urlUnreachable");
    } finally {
      if (!controller.signal.aborted) {
        setChecking(false);
      }
    }
  }, [url, patternResult.valid, reachable]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  return {
    checking,
    patternError,
    reachable,
    reachError,
    check,
    reset,
  };
}
