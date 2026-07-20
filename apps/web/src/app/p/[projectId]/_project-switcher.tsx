"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, type MouseEvent } from "react";
import type { ProjectShellOption } from "@/lib/services/project-shell";
import {
  hasUnsavedContextChanges,
  shouldConfirmContextNavigation,
} from "./_context-navigation-guard";
import styles from "./layout.module.css";

const PROJECT_SECTIONS = new Set([
  "overview",
  "context",
  "sources",
  "diagnosis",
  "plan",
  "studio",
  "report",
]);

function currentSection(pathname: string): string {
  const segment = pathname.split("/").filter(Boolean)[2];
  return segment && PROJECT_SECTIONS.has(segment) ? segment : "overview";
}

/** Preserve the operator's current live section when changing projects. */
export function projectSwitchHref(pathname: string, projectId: string): string {
  return `/p/${projectId}/${currentSection(pathname)}`;
}

export function ProjectSwitcher({
  projectId,
  options,
}: {
  readonly projectId: string;
  readonly options: readonly ProjectShellOption[];
}) {
  const tShell = useTranslations("appShell");
  const tContext = useTranslations("context");
  const pathname = usePathname();
  const linkRefs = useRef(new Map<string, HTMLAnchorElement>());

  function confirmContextNavigation(
    event: MouseEvent<HTMLAnchorElement>,
  ): void {
    if (
      !shouldConfirmContextNavigation({
        dirty: hasUnsavedContextChanges(),
        current: false,
        button: event.button,
        modified:
          event.altKey || event.ctrlKey || event.metaKey || event.shiftKey,
      })
    ) {
      return;
    }
    if (!window.confirm(tContext("leaveWarning"))) event.preventDefault();
  }

  return (
    <div className={styles.projectSwitcher}>
      <span className={styles.projectAvatar} aria-hidden="true">
        {options
          .find((option) => option.id === projectId)
          ?.clientName.trim()
          .charAt(0)
          .toUpperCase() || "•"}
      </span>
      <select
        className={styles.projectSelect}
        aria-label={tShell("switchProject")}
        value={projectId}
        onChange={(event) => {
          const nextProjectId = event.currentTarget.value;
          if (nextProjectId === projectId) return;
          // Clicking the real hidden Next link lets Studio's document-level
          // unsaved-editor guard and the Context guard observe/cancel the same
          // navigation instead of bypassing them with an imperative router push.
          linkRefs.current.get(nextProjectId)?.click();
        }}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label} · {option.host}
          </option>
        ))}
      </select>

      {options.map((option) =>
        option.id === projectId ? null : (
          <Link
            key={option.id}
            hidden
            aria-hidden="true"
            tabIndex={-1}
            href={projectSwitchHref(pathname, option.id)}
            onClick={confirmContextNavigation}
            ref={(node) => {
              if (node) linkRefs.current.set(option.id, node);
              else linkRefs.current.delete(option.id);
            }}
          />
        ),
      )}
    </div>
  );
}
