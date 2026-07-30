// @input  -- react
// @output -- TrialContext + useTrial hook (openTrial for 5-step wizard, openWaitlist for email-only)
// @pos    -- Global Context, allows child pages to trigger Trial or Waitlist modals
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
