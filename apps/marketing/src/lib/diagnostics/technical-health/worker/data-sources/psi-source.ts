// @input  -- injectable PsiPort (wraps fetchFullPageSpeed; tests pass fixtures,
//            production a thin adapter); a sampled URL+template list (mobile-first)
// @output -- buildPsiCoverage(port, input): Promise<PerfCoverage> — a frozen
//            per-run PSI/CrUX snapshot. ok carries per-URL lab + CrUX field
//            samples (or per-URL na with a reason); na when no URLs. quota/5xx/
//            timeout ⇒ that URL is na (run still completes). Zero AI; no secrets.
// @pos    -- D1 v2.1 Phase 5 U7 — the deterministic, fixture-testable PSI data
//            source. CrUX field data is folded in via crux-source (PSI's
//            loadingExperience). Live PSI/CrUX key is a deploy-time concern.
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { CruxField } from "./crux-source";

/** Machine reason for a degraded (na) per-URL PSI sample. */
export type PsiNaReason =
  | "no_field_data"
  | "psi_5xx"
  | "quota_exhausted"
  | "psi_timeout"
  | "psi_error";

/** Lab (Lighthouse) metrics PSI returns for one URL. ms except where noted. */
export interface PsiLab {
  readonly lcp: number;
  readonly tbt: number;
  readonly ttfb: number;
}

/**
 * One URL's PSI result from the port. `ok` carries field (CrUX p75) + lab; `na`
 * carries a machine reason (quota / 5xx / timeout / missing field data). The
 * port NEVER throws for a degraded URL — it returns na so the run completes.
 */
export type PsiPortResult =
  | {
      readonly status: "ok";
      readonly field: CruxField | null;
      readonly lab: PsiLab;
    }
  | { readonly status: "na"; readonly reason: PsiNaReason };

/**
 * Injectable PSI port. Tests pass a fixture; production passes a thin adapter
 * over `fetchFullPageSpeed` + the PSI key (resolved at the deploy boundary —
 * this source never reads `process.env`). Mobile-first is the adapter's concern.
 */
export interface PsiPort {
  readonly fetch: (url: string) => Promise<PsiPortResult>;
}

/** A URL the PSI step should sample, tagged with its template bucket. */
export interface PsiSampleUrl {
  readonly url: string;
  readonly template: string;
}

export interface PsiCoverageInput {
  /** Deterministic sampled set (1 URL per template upstream; PSI cap 30/run). */
  readonly urls: readonly PsiSampleUrl[];
  /**
   * Optional absolute wall-clock deadline (ms, comparable to `now()`). Once
   * reached, no further PSI fetches are launched — the remaining URLs degrade to
   * na (`psi_timeout`) so the loop cannot blow the worker watchdog. Absent ⇒ no
   * deadline (every URL is fetched).
   */
  readonly deadlineAt?: number;
  /** Injectable clock for the deadline check (defaults to Date.now). */
  readonly now?: () => number;
  /**
   * Max in-flight PSI fetches. PSI is ~22s/URL, so concurrency lets N URLs
   * complete in ceil(N/concurrency) batches instead of N×22s. Defaults to 1
   * (sequential). The deadline is checked at each batch boundary.
   */
  readonly concurrency?: number;
}

/** One URL's resolved perf sample inside the coverage snapshot. */
export type PerfSample =
  | {
      readonly status: "ok";
      readonly url: string;
      readonly template: string;
      readonly field: CruxField | null;
      readonly lab: PsiLab;
    }
  | {
      readonly status: "na";
      readonly url: string;
      readonly template: string;
      readonly reason: PsiNaReason;
    };

/**
 * The frozen per-run PSI/CrUX coverage snapshot. A discriminated union: `ok`
 * carries the per-URL samples (each itself ok or na); `na` when there were no
 * URLs to sample at all (no fabricated 0 coverage).
 *
 * `confidenceReason` (U7 / AC8): the human reason for the A8 confidence ceiling
 * (e.g. "仅检测首页，不能代表全站性能"), stamped by `runPsiCoverageStep` so the PERF
 * rules can surface it on their observedValue (AC8 requires the reason, not just
 * the ≤0.40 number). Optional — `buildPsiCoverage` itself never sets it.
 */
export type PerfCoverage =
  | {
      readonly status: "ok";
      readonly samples: readonly PerfSample[];
      readonly confidenceReason?: string;
    }
  | { readonly status: "na"; readonly reason: "no_urls" };

/** PSI daily quota awareness (25k/day). Real enforcement is a deploy concern. */
export const PSI_DAILY_QUOTA = 25_000;

/**
 * Build the frozen per-run PSI/CrUX coverage snapshot.
 *
 * Degrade-to-na (locked decision): a port result of na, OR a thrown port error
 * (timeout / network), maps that URL to a na sample with a machine reason — the
 * snapshot is returned, never thrown, so a run with no PSI still completes. When
 * the sampled set is empty, the whole snapshot is na (`no_urls`).
 *
 * Once the port reports `quota_exhausted` for a URL we STOP calling it and mark
 * every remaining URL na/quota_exhausted (no point burning more calls) — the run
 * still completes with a partial sample and the A8 confidence reflects it.
 *
 * Pure over its inputs + port: same urls + port ⇒ same snapshot (frozen, no
 * mid-run re-fetch). Zero AI; no secrets read here.
 */
export async function buildPsiCoverage(
  port: PsiPort,
  input: PsiCoverageInput,
): Promise<PerfCoverage> {
  if (input.urls.length === 0) {
    return { status: "na", reason: "no_urls" };
  }

  const samples: PerfSample[] = new Array(input.urls.length);
  let quotaExhausted = false;
  let deadlineHit = false;
  const now = input.now ?? Date.now;
  const concurrency = Math.max(1, input.concurrency ?? 1);

  // Resolve one URL to a PerfSample. Never throws — a port reject degrades the
  // URL to na so the run always completes.
  const fetchOne = async (
    url: string,
    template: string,
  ): Promise<PerfSample> => {
    let result: PsiPortResult;
    try {
      result = await port.fetch(url);
    } catch {
      return { status: "na", url, template, reason: "psi_error" };
    }
    if (result.status === "na") {
      return { status: "na", url, template, reason: result.reason };
    }
    return {
      status: "ok",
      url,
      template,
      field: result.field,
      lab: result.lab,
    };
  };

  for (let i = 0; i < input.urls.length; i += concurrency) {
    // Wall-clock deadline + quota gate checked at each batch boundary: once
    // spent, launch no further fetches so the loop stays inside the watchdog.
    if (
      !deadlineHit &&
      input.deadlineAt !== undefined &&
      now() >= input.deadlineAt
    ) {
      deadlineHit = true;
    }

    const batch = input.urls.slice(i, i + concurrency);

    if (deadlineHit || quotaExhausted) {
      const reason = deadlineHit ? "psi_timeout" : "quota_exhausted";
      batch.forEach(({ url, template }, j) => {
        samples[i + j] = { status: "na", url, template, reason };
      });
      continue;
    }

    const batchResults = await Promise.all(
      batch.map(({ url, template }) => fetchOne(url, template)),
    );
    batchResults.forEach((sample, j) => {
      samples[i + j] = sample;
      if (sample.status === "na" && sample.reason === "quota_exhausted") {
        quotaExhausted = true;
      }
    });
  }

  return { status: "ok", samples };
}

/**
 * Sampling coverage facts derived from a PerfCoverage snapshot, for the A8
 * confidence ceiling. Counts distinct templates + sampled/successful URLs and
 * detects the AC8 homepage-only case (a single homepage URL sampled).
 */
export function summarizePsiCoverage(coverage: PerfCoverage): {
  sampledTemplates: number;
  sampledUrls: number;
  successfulUrls: number;
  homepageOnly: boolean;
} {
  if (coverage.status === "na") {
    return {
      sampledTemplates: 0,
      sampledUrls: 0,
      successfulUrls: 0,
      homepageOnly: false,
    };
  }
  const templates = new Set(coverage.samples.map((s) => s.template));
  const successfulUrls = coverage.samples.filter(
    (s) => s.status === "ok",
  ).length;
  const homepageOnly = coverage.samples.length === 1 && templates.has("/");
  return {
    sampledTemplates: templates.size,
    sampledUrls: coverage.samples.length,
    successfulUrls,
    homepageOnly,
  };
}
