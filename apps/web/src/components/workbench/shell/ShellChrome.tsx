"use client";

import { useTranslations } from "next-intl";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import type { ProjectShellOption } from "@/lib/services/project-shell";
import { WB_APP_ROOT_ID } from "../ui/ids.ts";
import { ArtifactDrawer } from "./ArtifactDrawer.tsx";
import { CommandPalette } from "./CommandPalette.tsx";
import { Sidebar, type SidebarSite } from "./Sidebar.tsx";
import { Topbar } from "./Topbar.tsx";
import { useGlobalShortcut } from "./useGlobalShortcut.ts";
import { useMediaQuery } from "./useMediaQuery.ts";

const SIDEBAR_ID = "wb-sidebar";

type Panel = "palette" | "drawer" | null;

/**
 * The legacy modals (Product Profile editor, action override) mark every
 * `document.body` child `inert` — `#wb-app` included — and sit at z-index 1200.
 * The root being inert while no workbench panel is open therefore means
 * someone else owns the page: a palette or drawer opened now (z-50) would mount
 * beneath that scrim and steal its focus. Read at call time, not from state:
 * those modals never tell the shell they opened.
 */
function pageOwnedElsewhere(panel: Panel): boolean {
  return (
    panel === null &&
    (document.getElementById(WB_APP_ROOT_ID)?.hasAttribute("inert") ?? false)
  );
}

/**
 * Client half of the shell (design §4.1). `#wb-app` is the root the two
 * dialogs make `inert`, so both of them render outside it.
 */
export function ShellChrome({
  projectId,
  site,
  projectOptions,
  projectControl,
  accountControl,
  children,
}: {
  readonly projectId: string;
  readonly site: SidebarSite;
  readonly projectOptions: readonly ProjectShellOption[];
  readonly projectControl: ReactNode;
  readonly accountControl: ReactNode;
  readonly children: ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Only one of the two dialogs may be open at a time: stacked `fixed inset-0
  // z-50` wrappers overlap, and closing the top one first returns focus to
  // `<body>` because the dialog underneath is the one holding the opener. One
  // slot makes that unrepresentable rather than something two setters have to
  // keep agreeing on. The `Dialog` inert ref-count stays as defence in depth.
  const [panel, setPanel] = useState<Panel>(null);
  const paletteOpen = panel === "palette";
  const drawerOpen = panel === "drawer";
  const paletteButtonRef = useRef<HTMLButtonElement>(null);
  const drawerButtonRef = useRef<HTMLButtonElement>(null);
  // Must match Tailwind v4's `md` (48rem), which the rail's `md:translate-x-0`
  // uses: a px value drifts from it as soon as the root font size is not 16px.
  const mobile = useMediaQuery("(width < 48rem)");
  const t = useTranslations("workbench.shell");

  const closeAll = useCallback(() => {
    setPanel(null);
    setSidebarOpen(false);
  }, []);
  // Every opener goes through the updater form so the ownership check reads
  // the slot as it is when the shortcut or click lands, not a stale closure.
  const openPalette = useCallback(
    (): void =>
      setPanel((current) => (pageOwnedElsewhere(current) ? current : "palette")),
    [],
  );
  const openDrawer = useCallback(
    (): void =>
      setPanel((current) => (pageOwnedElsewhere(current) ? current : "drawer")),
    [],
  );
  const handlers = useMemo(
    () => ({
      onTogglePalette: () =>
        setPanel((current) => {
          if (pageOwnedElsewhere(current)) return current;
          return current === "palette" ? null : "palette";
        }),
      onEscape: closeAll,
    }),
    [closeAll],
  );
  useGlobalShortcut(handlers);

  return (
    <>
      {/* No font/color here: they inherit into <main> and would change legacy pages (Task 0 baseline). */}
      <div id={WB_APP_ROOT_ID} data-app-shell="" className="flex min-h-screen bg-wb-paper">
        {sidebarOpen ? (
          <button
            type="button"
            aria-label={t("closeMenu")}
            tabIndex={-1}
            className="fixed inset-0 z-20 border-0 bg-slate-900/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}
        <Sidebar
          id={SIDEBAR_ID}
          projectId={projectId}
          site={site}
          siteCount={projectOptions.length}
          open={sidebarOpen}
          mobile={mobile}
        />
        <div
          data-wb-content=""
          className="flex min-h-screen min-w-0 flex-1 flex-col md:ml-64"
        >
          <Topbar
            projectControl={projectControl}
            accountControl={accountControl}
            onMenu={() => setSidebarOpen((o) => !o)}
            onPalette={openPalette}
            onDrawer={openDrawer}
            paletteButtonRef={paletteButtonRef}
            drawerButtonRef={drawerButtonRef}
            sidebarId={SIDEBAR_ID}
            sidebarOpen={sidebarOpen}
          />
          <main id="main-content" className="flex-1">
            {children}
          </main>
        </div>
      </div>
      <CommandPalette
        returnFocusTo={paletteButtonRef}
        open={paletteOpen}
        onClose={() => setPanel(null)}
        projectId={projectId}
        projectOptions={projectOptions}
      />
      <ArtifactDrawer
        returnFocusTo={drawerButtonRef}
        open={drawerOpen}
        onClose={() => setPanel(null)}
      />
    </>
  );
}
