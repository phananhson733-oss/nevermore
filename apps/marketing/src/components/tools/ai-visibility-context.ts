"use client";
// @input -- the account's latest contexts and the exact requested KB/snapshot
// @output -- only that frozen source, never a fallback to today's Profile
import { useEffect, useState } from "react";
import { parseVisibilityContext, type VisibilityContext, type VisibilityWebsiteContext } from "../../lib/geo-tools/visibility-context.ts";

type ExactRead = { readonly key: string; readonly source: VisibilityWebsiteContext } &
  ({ readonly kind: "ready"; readonly site: VisibilityWebsiteContext } | { readonly kind: "error" });

export function useExactVisibilitySource(context: VisibilityContext | null, kbId: string | null, snapshotId: string | null, expectedQuestionSetHash: string | null = null) {
  const [read, setRead] = useState<ExactRead | null>(null);
  const site = context?.websites.find(entry => entry.knowledgeBase?.kbId === kbId) ?? null;
  const key = `${site?.website.websiteId ?? ""}:${snapshotId ?? ""}:${expectedQuestionSetHash ?? ""}`;
  const mismatch = site?.frozen?.snapshotId === snapshotId && expectedQuestionSetHash !== null && site.frozen.questionSetHash !== expectedQuestionSetHash;
  const direct = site?.frozen?.snapshotId === snapshotId && !mismatch ? site : null;
  useEffect(() => {
    if (snapshotId === null || direct !== null || site === null || mismatch) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const params = new URLSearchParams({ websiteId: site.website.websiteId, snapshotId });
        const response = await fetch(`/api/tools/ai-visibility-check/context?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error("source_unavailable");
        const result = parseVisibilityContext(await response.json());
        const exact = result.websites.find(entry => entry.website.websiteId === site.website.websiteId);
        if (!exact || exact.frozen?.snapshotId !== snapshotId || exact.knowledgeBase?.kbId !== kbId || (expectedQuestionSetHash !== null && exact.frozen.questionSetHash !== expectedQuestionSetHash)) throw new Error("source_mismatch");
        if (!controller.signal.aborted) setRead({ key, source: site, kind: "ready", site: exact });
      } catch { if (!controller.signal.aborted) setRead({ key, source: site, kind: "error" }); }
    })();
    return () => controller.abort();
  }, [direct, expectedQuestionSetHash, key, kbId, mismatch, site, snapshotId]);
  // A refreshed account context invalidates an earlier read immediately, even
  // when the requested IDs are unchanged. Failed revalidation cannot enable a run.
  const current = read?.key === key && read.source === site ? read : null;
  const exact = direct ?? (current?.kind === "ready" ? current.site : null);
  const error = snapshotId !== null && context !== null && (site === null || mismatch || current?.kind === "error");
  return { site: error ? null : exact, loading: snapshotId !== null && context !== null && site !== null && !error && exact === null, error };
}
