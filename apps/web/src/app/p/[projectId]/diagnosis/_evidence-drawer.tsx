import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarDays,
  Check,
  Database,
  ExternalLink,
  FileSearch,
  Link2,
  ShieldCheck,
  X,
} from "lucide-react";
import { LimitationHint } from "@/components/ui";
import type { Evidence } from "@/lib/api/hooks-diagnosis";
import styles from "./diagnosis.module.css";

function formatObservedAt(value: string, locale: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      !element.hasAttribute("hidden"),
  );
}

export interface EvidenceDrawerProps {
  readonly projectId: string;
  readonly findingId: string;
  readonly findingTitle: string;
  readonly findingSummary: string;
  readonly evidence: readonly Evidence[];
  readonly open: boolean;
  readonly onClose: () => void;
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
}

/**
 * Modal evidence trace. The finding stays visible behind a dimmed audit layer,
 * while the canonical evidence rows become keyboard-operable source tabs.
 */
export function EvidenceDrawer({
  projectId,
  findingId,
  findingTitle,
  findingSummary,
  evidence,
  open,
  onClose,
  returnFocusRef,
}: EvidenceDrawerProps) {
  const t = useTranslations("diagnosis");
  const tCommon = useTranslations("common");
  const tProvider = useTranslations("provider");
  const tSourceState = useTranslations("sourceState");
  const locale = useLocale();
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const firstEvidenceId = evidence[0]?.id ?? null;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setActiveEvidenceId(firstEvidenceId);
  }, [firstEvidenceId, open]);

  const requestClose = useCallback((): void => {
    onClose();
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, [onClose, returnFocusRef]);

  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    const focusFrame = requestAnimationFrame(() => closeRef.current?.focus());

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab" || drawerRef.current === null) return;
      const focusable = focusableElements(drawerRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      body.style.overflow = previousOverflow;
    };
  }, [open, requestClose]);

  if (!mounted || !open || firstEvidenceId === null) return null;

  const activeEvidence =
    evidence.find((item) => item.id === activeEvidenceId) ?? evidence[0];
  if (activeEvidence === undefined) return null;

  const observedAt = formatObservedAt(activeEvidence.observedAt, locale);
  const sourceProvider =
    activeEvidence.sourceProvider === "system" ||
    activeEvidence.sourceProvider === "llm"
      ? t(`evidence.provider.${activeEvidence.sourceProvider}`)
      : tProvider(activeEvidence.sourceProvider);
  const drawerTitleId = `sf-finding-${findingId}-evidence-title`;
  const tabPanelId = `sf-finding-${findingId}-evidence-panel`;

  function selectTab(index: number, focus: boolean): void {
    const next = evidence[index];
    if (next === undefined) return;
    setActiveEvidenceId(next.id);
    if (focus) {
      requestAnimationFrame(() =>
        document
          .getElementById(`sf-finding-${findingId}-evidence-tab-${next.id}`)
          ?.focus(),
      );
    }
  }

  function onTabKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % evidence.length;
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + evidence.length) % evidence.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = evidence.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    selectTab(nextIndex, true);
  }

  return createPortal(
    <div
      className={styles.drawerBackdrop}
      data-evidence-backdrop=""
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={drawerRef}
        id={`sf-finding-${findingId}-evidence-drawer`}
        className={styles.evidenceDrawer}
        data-evidence-drawer=""
        role="dialog"
        aria-modal="true"
        aria-labelledby={drawerTitleId}
      >
        <header className={styles.drawerHeader}>
          <div>
            <p className={styles.drawerEyebrow}>{t("evidence.drawerLabel")}</p>
            <h2 id={drawerTitleId} className={styles.drawerTitle}>
              {t("evidence.drawerTitle")}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className={styles.drawerClose}
            aria-label={t("evidence.close")}
            onClick={requestClose}
          >
            <X aria-hidden="true" size={22} strokeWidth={1.7} />
          </button>
        </header>

        <section className={styles.drawerFinding}>
          <span>{t("evidence.supportsFinding")}</span>
          <strong>{findingTitle}</strong>
          <p>{findingSummary}</p>
        </section>

        <div
          className={styles.evidenceTabs}
          role="tablist"
          aria-label={t("evidence.tabsLabel")}
        >
          {evidence.map((item, index) => {
            const provider =
              item.sourceProvider === "system" || item.sourceProvider === "llm"
                ? t(`evidence.provider.${item.sourceProvider}`)
                : tProvider(item.sourceProvider);
            const selected = item.id === activeEvidence.id;
            return (
              <button
                key={item.id}
                id={`sf-finding-${findingId}-evidence-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={tabPanelId}
                tabIndex={selected ? 0 : -1}
                className={styles.evidenceTab}
                onClick={() => selectTab(index, false)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
              >
                <span>
                  {String(index + 1).padStart(2, "0")}
                </span>
                {provider}
              </button>
            );
          })}
        </div>

        <div
          className={styles.drawerScroll}
          tabIndex={0}
          aria-label={t("evidence.scrollLabel")}
        >
          <div
            id={tabPanelId}
            role="tabpanel"
            aria-labelledby={`sf-finding-${findingId}-evidence-tab-${activeEvidence.id}`}
            className={styles.evidencePanel}
          >
            <section
              className={styles.sourceCard}
              aria-label={t("evidence.sourceCardLabel", {
                claim: activeEvidence.claim,
              })}
            >
              <header className={styles.sourceCardHeader}>
                <span className={styles.sourceIcon} aria-hidden="true">
                  <Database size={20} strokeWidth={1.8} />
                </span>
                <div className={styles.sourceIdentity}>
                  <span>{activeEvidence.origin || tCommon("unavailable")}</span>
                  <strong>{sourceProvider}</strong>
                </div>
                <span className={styles.sourceGrade}>
                  {t("gradeLabel", { grade: activeEvidence.grade })}
                </span>
              </header>
              <div className={styles.sourceCardBody}>
                <span className={styles.sourceMetric} aria-hidden="true">
                  {activeEvidence.subjectRefs.length}
                </span>
                <span className={styles.sourceMetricLabel}>
                  {t("evidence.subjectCount", {
                    count: activeEvidence.subjectRefs.length,
                  })}
                </span>
              </div>
              <p className={styles.sourceClaim}>{activeEvidence.claim}</p>
              <p className={styles.sourceMethod}>
                {activeEvidence.method || tCommon("unavailable")}
              </p>
            </section>

            <section className={styles.traceSection}>
              <header className={styles.drawerSectionHeader}>
                <p>{t("evidence.traceEyebrow")}</p>
                <h3>{t("evidence.traceTitle")}</h3>
              </header>
              <dl className={styles.traceGrid}>
                <div>
                  <dt>
                    <Check aria-hidden="true" size={16} />
                    {t("evidence.availability")}
                  </dt>
                  <dd>{tSourceState(activeEvidence.availability)}</dd>
                </div>
                <div>
                  <dt>
                    <ShieldCheck aria-hidden="true" size={16} />
                    {t("evidence.supportLabel")}
                  </dt>
                  <dd>{t(`evidence.support.${activeEvidence.support}`)}</dd>
                </div>
                <div>
                  <dt>
                    <CalendarDays aria-hidden="true" size={16} />
                    {t("evidence.observedAtLabel")}
                  </dt>
                  <dd>{observedAt ?? tCommon("unavailable")}</dd>
                </div>
                <div>
                  <dt>
                    <FileSearch aria-hidden="true" size={16} />
                    {t("evidence.method")}
                  </dt>
                  <dd>{activeEvidence.method || tCommon("unavailable")}</dd>
                </div>
              </dl>
            </section>

            {activeEvidence.limitation ? (
              <section
                className={styles.limitationSection}
                aria-label={t("evidence.limitationsEyebrow")}
              >
                <LimitationHint
                  label={t("evidence.limitationsTitle")}
                  limitations={[activeEvidence.limitation]}
                />
              </section>
            ) : null}

            <section className={styles.dimensionSection}>
              <header className={styles.drawerSectionHeader}>
                <p>{t("evidence.dimensionsEyebrow")}</p>
                <h3>{t("evidence.dimensionsTitle")}</h3>
              </header>
              <dl className={styles.dimensionList}>
                <div>
                  <dt>{t("evidence.origin")}</dt>
                  <dd>{activeEvidence.origin || tCommon("unavailable")}</dd>
                </div>
                <div>
                  <dt>{t("evidence.snapshotReference")}</dt>
                  <dd>
                    <code>
                      {activeEvidence.snapshotId ?? tCommon("unavailable")}
                    </code>
                  </dd>
                </div>
                <div>
                  <dt>{t("evidence.analysisReference")}</dt>
                  <dd>
                    <code>
                      {activeEvidence.analysisInvocationId ??
                        tCommon("unavailable")}
                    </code>
                  </dd>
                </div>
              </dl>
              <div className={styles.drawerSubjects}>
                <span className={styles.subLabel}>{t("evidence.subjects")}</span>
                {activeEvidence.subjectRefs.length > 0 ? (
                  <ul className={styles.drawerSubjectList}>
                    {activeEvidence.subjectRefs.map((subject, index) => (
                      <li key={`${subject.type}:${subject.value}:${index}`}>
                        <Link2 aria-hidden="true" size={15} />
                        <strong>{subject.type}</strong>
                        <span>{subject.value}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.evidenceEmptyDetail}>
                    {t("evidence.noSubjects")}
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>

        <footer className={styles.drawerFooter}>
          <span>
            <ShieldCheck aria-hidden="true" size={17} />
            {`${tSourceState(activeEvidence.availability)} · ${t(
              `evidence.support.${activeEvidence.support}`,
            )}`}
          </span>
          <Link href={`/p/${projectId}/sources`}>
            {t("evidence.openSources")}
            <ExternalLink aria-hidden="true" size={15} />
          </Link>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
