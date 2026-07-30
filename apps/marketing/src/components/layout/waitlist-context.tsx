// @input  -- react
// @output -- Product CTA context + useTrial compatibility hook
// @pos    -- Global Context, allows child pages to route trial and waitlist CTAs to the product app
// Once this file is updated, update header comment and folder _DIR.md
"use client";

import { createContext, useContext } from "react";

interface TrialContextValue {
  openTrial: () => void;
  openWaitlist: () => void;
}

const TrialContext = createContext<TrialContextValue>({
  openTrial: () => {},
  openWaitlist: () => {},
});

export const TrialProvider = TrialContext.Provider;

export function useTrial() {
  return useContext(TrialContext);
}
