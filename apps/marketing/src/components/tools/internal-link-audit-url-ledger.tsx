"use client";

import type {
  InternalLinkAuditFinding,
  InternalLinkAuditPayload,
} from "@sf/public-tools";
import { Copy } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import type { InternalLinkAuditLocale } from "./internal-link-audit-content";
import {
  buildInternalLinkAuditAiHandoff,
  buildInternalLinkAuditLedger,
  type InternalLinkAuditLedgerRow,
} from "./internal-link-audit-ledger";

interface InternalLinkAuditUrlLedgerProps {
  readonly payload: InternalLinkAuditPayload;
  readonly locale: InternalLinkAuditLocale;
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
}

const LEDGER_COPY = {
  en: {
    eyebrow: "Internal link audit",
    title: "Internal link audit URL details",
    unavailableTitle: "Internal link audit unavailable",
    partial: "Partial coverage",
    summary: (pages: number, problems: number, unresolved: number) =>
      `${pages} URLs collected · ${problems} need attention · ${unresolved} targets unverified`,
    copyForAi: "Copy for AI resolution",
    copying: "Copying…",
    copied: "Copied",
    copiedStatus: (problems: number, unresolved: number) =>
      `Copied ${problems} problem URLs and ${unresolved} unverified targets.`,
    fallbackLabel: "Full AI handoff text for manual copying",
    fallbackStatus:
      "The browser did not return a verifiable copy receipt. The complete handoff is selected; use the system copy shortcut.",
    noProblems: "This run has no URLs that need an AI handoff.",
    caption: "Collected URLs and their observed internal-link state",
    problemGroup: "URLs linked to findings",
    unmarkedGroup: "URLs not linked to findings",
    page: "Page",
    category: "Category",
    homepageClicks: "Homepage clicks",
    inbound: "Inbound",
    outbound: "Outbound",
    sitemap: "Sitemap",
    notReachable: "Not reachable",
    yes: "Yes",
    no: "No",
    unverified: "Unverified",
    unmarked: "Not marked this run",
    findingLabels: {
      orphan_candidate: "Orphan candidate",
      orphan_undetermined: "Inbound links unchecked",
      unreachable_page: "Unreachable from homepage",
      deep_page: "Deeper click path",
      low_inbound: "Low inbound",
      duplicate_content: "Duplicate content candidate",
      unresolved_target: "Contains unverified target",
    },
  },
  zh: {
    eyebrow: "内链审计",
    title: "内链审计 URL 明细",
    unavailableTitle: "内链审计暂不可用",
    partial: "部分覆盖",
    summary: (pages: number, problems: number, unresolved: number) =>
      `已采集 ${pages} 个 URL · ${problems} 个需要关注 · ${unresolved} 个目标待验证`,
    copyForAi: "复制给 AI 解决",
    copying: "正在复制…",
    copied: "已复制",
    copiedStatus: (problems: number, unresolved: number) =>
      `已复制 ${problems} 个问题 URL 和 ${unresolved} 个待验证目标。`,
    fallbackLabel: "供手动复制的完整 AI 交接文本",
    fallbackStatus:
      "浏览器未返回可验证的复制回执；完整交接文本已全选，请使用系统复制快捷键。",
    noProblems: "本次没有需要交给 AI 的 URL",
    caption: "已采集 URL 及其内链观测状态",
    problemGroup: "与发现关联的 URL",
    unmarkedGroup: "本次未与发现关联的 URL",
    page: "页面",
    category: "分类",
    homepageClicks: "首页点击",
    inbound: "入链",
    outbound: "出链",
    sitemap: "Sitemap",
    notReachable: "无法到达",
    yes: "是",
    no: "否",
    unverified: "未验证",
    unmarked: "本次未标记",
    findingLabels: {
      orphan_candidate: "候选孤岛",
      orphan_undetermined: "入链未验证",
      unreachable_page: "首页无法到达",
      deep_page: "点击较深",
      low_inbound: "低入链",
      duplicate_content: "重复内容候选",
      unresolved_target: "含未验证目标",
    },
  },
} as const;

type LedgerCopy = (typeof LEDGER_COPY)[keyof typeof LEDGER_COPY];
type FindingTone = "error" | "warning" | "info";
type CopyState = "idle" | "copying" | "copied" | "fallback";

const ROW_TONE_CLASSES: Record<FindingTone, string> = {
  error: "bg-brand-error/[0.07]",
  warning: "bg-brand-warning/[0.06]",
  info: "bg-brand-info/[0.05]",
};

const RAIL_TONE_CLASSES: Record<FindingTone, string> = {
  error: "border-l-brand-error",
  warning: "border-l-brand-warning",
  info: "border-l-brand-info border-l-dashed",
};

const CHIP_TONE_CLASSES: Record<FindingTone, string> = {
  error: "border-brand-error/30 bg-brand-error/[0.08] text-brand-error",
  warning:
    "border-brand-warning/30 bg-brand-warning/[0.08] text-brand-warning",
  info: "border-brand-info/30 bg-brand-panel text-brand-info",
};

const CELL_LABEL_CLASS =
  "max-[619px]:before:mb-1.5 max-[619px]:before:block max-[619px]:before:font-mono max-[619px]:before:text-[9px] max-[619px]:before:font-normal max-[619px]:before:tracking-[0.1em] max-[619px]:before:text-text-dark-secondary max-[619px]:before:uppercase max-[619px]:before:content-[attr(data-label)]";

function findingTone(findings: readonly InternalLinkAuditFinding[]): FindingTone {
  if (findings.some((finding) => finding.kind === "unreachable_page")) {
    return "error";
  }
  if (
    findings.some((finding) =>
      [
        "orphan_candidate",
        "deep_page",
        "low_inbound",
        "duplicate_content",
      ].includes(finding.kind),
    )
  ) {
    return "warning";
  }
  return "info";
}

function sitemapLabel(
  row: InternalLinkAuditLedgerRow,
  copy: LedgerCopy,
): string {
  if (row.sitemapState === "unverified") return copy.unverified;
  return row.sitemapState === "yes" ? copy.yes : copy.no;
}

function LedgerRow({
  row,
  copy,
  problem,
}: {
  readonly row: InternalLinkAuditLedgerRow;
  readonly copy: LedgerCopy;
  readonly problem: boolean;
}) {
  const tone = findingTone(row.findings);
  return (
    <tr
      className={`border-t border-brand-border-faint max-[619px]:grid max-[619px]:grid-cols-2 ${
        problem ? ROW_TONE_CLASSES[tone] : "bg-brand-panel"
      }`}
      data-testid={
        problem ? "internal-link-problem-row" : "internal-link-unmarked-row"
      }
      data-tone={problem ? tone : "neutral"}
    >
      <td
        data-label={copy.page}
        className={`${CELL_LABEL_CLASS} min-w-0 border-l-2 px-4 py-3.5 align-top max-[619px]:col-span-2 max-[619px]:border-l-2 max-[619px]:px-4 ${
          problem
            ? `${RAIL_TONE_CLASSES[tone]} font-semibold`
            : "border-l-transparent font-medium"
        }`}
      >
        <span
          className="block min-w-0 break-words font-mono text-[13px] leading-[1.55] text-text-dark-primary [overflow-wrap:anywhere]"
          data-testid="internal-link-url-path"
        >
          {row.displayPath}
        </span>
        {row.node.title ? (
          <span className="mt-1 block break-words text-[12.5px] font-normal leading-[1.5] text-text-dark-secondary">
            {row.node.title}
          </span>
        ) : null}
      </td>
      <td
        data-label={copy.category}
        className={`${CELL_LABEL_CLASS} px-4 py-3.5 align-top max-[619px]:col-span-2 max-[619px]:pt-0`}
      >
        <span className="flex flex-wrap gap-1.5">
          {problem
            ? row.findings.map((finding) => {
                const chipTone = findingTone([finding]);
                return (
                  <span
                    key={finding.id}
                    data-finding-kind={finding.kind}
                    data-tone={chipTone}
                    className={`rounded-md border px-2 py-1 font-mono text-[9.5px] leading-[1.35] ${CHIP_TONE_CLASSES[chipTone]}`}
                  >
                    {copy.findingLabels[finding.kind]}
                  </span>
                );
              })
            : (
                <span
                  data-tone="neutral"
                  className="rounded-md border border-brand-border bg-brand-panel-raised px-2 py-1 font-mono text-[9.5px] leading-[1.35] text-text-dark-secondary"
                >
                  {copy.unmarked}
                </span>
              )}
        </span>
      </td>
      <td
        data-label={copy.homepageClicks}
        className={`${CELL_LABEL_CLASS} px-2 py-3.5 text-center align-top font-mono text-[12px] tabular-nums text-text-dark-strong max-[619px]:text-left`}
      >
        {row.node.clickDepth === null
          ? copy.notReachable
          : row.node.clickDepth}
      </td>
      <td
        data-label={copy.inbound}
        className={`${CELL_LABEL_CLASS} px-2 py-3.5 text-center align-top font-mono text-[12px] tabular-nums text-text-dark-strong max-[619px]:text-left`}
      >
        {row.node.inboundLinks}
      </td>
      <td
        data-label={copy.outbound}
        className={`${CELL_LABEL_CLASS} px-2 py-3.5 text-center align-top font-mono text-[12px] tabular-nums text-text-dark-strong max-[619px]:text-left`}
      >
        {row.node.outboundLinks}
      </td>
      <td
        data-label={copy.sitemap}
        className={`${CELL_LABEL_CLASS} px-2 py-3.5 text-center align-top font-mono text-[12px] tabular-nums text-text-dark-strong max-[619px]:text-left`}
      >
        {sitemapLabel(row, copy)}
      </td>
    </tr>
  );
}

export function InternalLinkAuditUrlLedger({
  payload,
  locale,
  headingRef,
}: InternalLinkAuditUrlLedgerProps) {
  const copy = LEDGER_COPY[locale];
  const report = payload.result;
  const ledger = useMemo(() => buildInternalLinkAuditLedger(report), [report]);
  const problemCount = ledger.problemRows.length;
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [manualCopyText, setManualCopyText] = useState("");
  const copyAttemptRef = useRef(0);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const manualCopyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    copyAttemptRef.current += 1;
    setCopyState("idle");
    setManualCopyText("");
    return () => {
      copyAttemptRef.current += 1;
    };
  }, [payload]);

  useEffect(() => {
    if (copyState === "copied" && document.activeElement === document.body) {
      copyButtonRef.current?.focus({ preventScroll: true });
    }
    if (copyState !== "fallback") return;
    const field = manualCopyRef.current;
    if (!field) return;
    field.focus();
    field.select();
    field.setSelectionRange(0, field.value.length);
  }, [copyState]);

  async function copyForAi(): Promise<void> {
    const handoff = buildInternalLinkAuditAiHandoff(payload);
    if (!handoff) return;

    const attemptId = ++copyAttemptRef.current;
    setManualCopyText(handoff);
    setCopyState("copying");

    let clipboardAttempt = Promise.resolve(false);
    try {
      const clipboard = navigator.clipboard;
      if (typeof clipboard?.writeText === "function") {
        clipboardAttempt = clipboard
          .writeText(handoff)
          .then(() => true)
          .catch(() => false);
      }
    } catch {
      clipboardAttempt = Promise.resolve(false);
    }
    const confirmed = await Promise.race([
      clipboardAttempt,
      new Promise<boolean>((resolve) => {
        window.setTimeout(() => resolve(false), 800);
      }),
    ]);

    if (attemptId !== copyAttemptRef.current) return;
    setCopyState(confirmed ? "copied" : "fallback");
  }

  const buttonLabel =
    copyState === "copying"
      ? copy.copying
      : copyState === "copied"
        ? copy.copied
        : copy.copyForAi;
  const status =
    problemCount === 0
      ? copy.noProblems
      : copyState === "copied"
        ? copy.copiedStatus(problemCount, ledger.unresolvedTargetCount)
        : copyState === "fallback"
          ? copy.fallbackStatus
          : "";

  if (report.availability === "unavailable") {
    return (
      <section
        aria-labelledby="internal-link-audit-ledger-heading"
        className="mt-6 rounded-card border border-brand-info/30 bg-brand-info/[0.05] px-5 py-5 md:px-6 md:py-6"
        data-testid="internal-link-audit-result"
      >
        <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-info uppercase">
          {copy.eyebrow}
        </p>
        <h2
          id="internal-link-audit-ledger-heading"
          ref={headingRef}
          tabIndex={-1}
          className="mt-2 text-[25px] font-semibold leading-tight tracking-[-0.03em] text-text-dark-primary outline-none md:text-[28px]"
        >
          {copy.unavailableTitle}
        </h2>
        <p className="mt-3 max-w-3xl text-[13.5px] leading-[1.65] text-text-dark-secondary">
          {report.limitation}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="internal-link-audit-ledger-heading"
      className="mt-6 overflow-hidden rounded-card border border-brand-border-card bg-brand-panel"
      data-testid="internal-link-audit-result"
    >
      <div className="flex flex-col gap-4 border-b border-brand-border px-5 py-5 md:flex-row md:items-center md:justify-between md:px-6 md:py-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
              {copy.eyebrow}
            </p>
            {report.availability === "partial" ? (
              <span className="rounded-md border border-brand-info/30 bg-brand-info/[0.07] px-2 py-1 font-mono text-[9.5px] text-brand-info">
                {copy.partial}
              </span>
            ) : null}
          </div>
          <h2
            id="internal-link-audit-ledger-heading"
            ref={headingRef}
            tabIndex={-1}
            className="mt-2 text-[25px] font-semibold leading-tight tracking-[-0.03em] text-text-dark-primary outline-none md:text-[28px]"
          >
            {copy.title}
          </h2>
          <p className="mt-2 text-[13px] leading-[1.6] text-text-dark-secondary">
            {copy.summary(
              report.nodes.length,
              problemCount,
              ledger.unresolvedTargetCount,
            )}
          </p>
        </div>
        <button
          ref={copyButtonRef}
          type="button"
          disabled={problemCount === 0 || copyState === "copying"}
          aria-busy={copyState === "copying" ? "true" : undefined}
          aria-describedby="internal-link-copy-status"
          onClick={() => void copyForAi()}
          className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-[26px] text-[14.5px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none motion-reduce:transition-none max-[619px]:w-full"
          data-testid="internal-link-copy-ai"
        >
          {buttonLabel}
          <Copy aria-hidden="true" className="size-4" />
        </button>
      </div>

      <p
        id="internal-link-copy-status"
        className={`px-5 text-[12px] leading-[1.5] text-text-dark-secondary md:px-6 ${status ? "py-2.5" : ""}`}
        role="status"
        aria-live="polite"
        data-testid="internal-link-copy-status"
      >
        {status}
      </p>
      {copyState === "fallback" ? (
        <div className="border-b border-brand-border px-5 pb-4 md:px-6">
          <label
            htmlFor="internal-link-manual-copy"
            className="block text-[12.5px] font-medium text-text-dark-primary"
          >
            {copy.fallbackLabel}
          </label>
          <textarea
            id="internal-link-manual-copy"
            ref={manualCopyRef}
            readOnly
            value={manualCopyText}
            className="mt-2 min-h-44 w-full resize-y rounded-[10px] border border-brand-border-strong bg-brand-panel-sunken px-3.5 py-3 font-mono text-[11px] leading-[1.55] text-text-dark-primary outline-none focus-visible:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
          />
        </div>
      ) : null}

      <div className="min-w-0">
        <table className="w-full table-fixed border-collapse max-[619px]:block max-[619px]:table-auto">
          <caption className="sr-only">{copy.caption}</caption>
          <colgroup className="max-[619px]:hidden">
            <col className="w-[36%]" />
            <col className="w-[30%]" />
            <col className="w-[10%]" />
            <col className="w-[7%]" />
            <col className="w-[7%]" />
            <col className="w-[10%]" />
          </colgroup>
          <thead className="bg-brand-panel-sunken max-[619px]:sr-only">
            <tr>
              {[
                copy.page,
                copy.category,
                copy.homepageClicks,
                copy.inbound,
                copy.outbound,
                copy.sitemap,
              ].map((label, index) => (
                <th
                  key={label}
                  scope="col"
                  className={`px-4 py-3 text-left font-mono text-[10px] font-medium tracking-[0.1em] text-text-dark-secondary uppercase ${
                    index >= 2 ? "px-2 text-center" : ""
                  }`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody
            aria-label={copy.problemGroup}
            className="max-[619px]:block"
            data-testid="internal-link-problem-group"
          >
            {ledger.problemRows.map((row) => (
              <LedgerRow key={row.node.id} row={row} copy={copy} problem />
            ))}
          </tbody>
          <tbody
            aria-label={copy.unmarkedGroup}
            className="max-[619px]:block"
            data-testid="internal-link-unmarked-group"
          >
            {ledger.unmarkedRows.map((row) => (
              <LedgerRow
                key={row.node.id}
                row={row}
                copy={copy}
                problem={false}
              />
            ))}
          </tbody>
        </table>
      </div>

    </section>
  );
}
