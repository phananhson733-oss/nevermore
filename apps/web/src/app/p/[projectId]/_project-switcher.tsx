"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, type MouseEvent } from "react";
import type { ProjectShellOption } from "@/lib/services/project-shell";
import {
  hasUnsavedContextChanges,
  shouldConfirmContextNavigation,
} from "./_context-navigation-guard";
import { projectSwitchHref } from "./_project-switcher-model.ts";
import styles from "./layout.module.css";

interface ProjectSwitcherIdentity {
  readonly primary: string;
  readonly secondary: string;
  readonly avatar: string;
}

function normalizedIdentityPart(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/**
 * Keep the project itself as the strongest visible identity. The client and
 * primary site remain available as supporting context, while exact duplicate
 * values are omitted so the compact switcher does not repeat itself.
 */
function projectSwitcherIdentity(
  project: Pick<
    ProjectShellOption,
    "clientName" | "projectName" | "host"
  >,
): ProjectSwitcherIdentity {
  const clientName = project.clientName.trim();
  const projectName =
    project.projectName.trim() || clientName || project.host.trim();
  const host = project.host.trim();
  const primaryKey = normalizedIdentityPart(projectName);
  const clientKey = normalizedIdentityPart(clientName);
  const secondaryParts = [
    ...(clientName && clientKey !== primaryKey ? [clientName] : []),
    ...(host &&
    normalizedIdentityPart(host) !== primaryKey &&
    normalizedIdentityPart(host) !== clientKey
      ? [host]
      : []),
  ];

  return {
    primary: projectName,
    secondary: secondaryParts.join(" · "),
    avatar: projectName.charAt(0).toLocaleUpperCase() || "•",
  };
}

/** Preserve the unambiguous client — project label in the native control. */
function projectSwitcherOptionText(
  option: Pick<ProjectShellOption, "label" | "host">,
): string {
  return `${option.label} · ${option.host}`;
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
  const selectedProject = options.find((option) => option.id === projectId);
  const selectedIdentity = selectedProject
    ? projectSwitcherIdentity(selectedProject)
    : null;

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
        {selectedIdentity?.avatar || "•"}
      </span>
      <span
        className={styles.projectIdentity}
        aria-hidden="true"
        data-project-identity
      >
        <strong>{selectedIdentity?.primary}</strong>
        {selectedIdentity?.secondary ? (
          <span>{selectedIdentity.secondary}</span>
        ) : null}
      </span>
      <ChevronDown
        className={styles.projectChevron}
        aria-hidden="true"
        size={16}
        strokeWidth={2}
      />
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
            {projectSwitcherOptionText(option)}
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
