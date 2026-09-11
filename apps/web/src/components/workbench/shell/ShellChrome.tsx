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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const paletteButtonRef = useRef<HTMLButtonElement>(null);
  const drawerButtonRef = useRef<HTMLButtonElement>(null);
  const mobile = useMediaQuery("(max-width: 767px)");
  const t = useTranslations("workbench.shell");

  const closeAll = useCallback(() => {
    setPaletteOpen(false);
    setDrawerOpen(false);
    setSidebarOpen(false);
  }, []);
  // Only one of the two dialogs may be open at a time: stacked `fixed inset-0
  // z-50` wrappers overlap, and closing the top one first returns focus to
  // `<body>` because the dialog underneath is the one holding the opener. The
  // `Dialog` inert ref-count stays as defence in depth.
  const openPalette = useCallback((): void => {
    setPaletteOpen(true);
    setDrawerOpen(false);
  }, []);
  const openDrawer = useCallback((): void => {
    setDrawerOpen(true);
    setPaletteOpen(false);
  }, []);
  const handlers = useMemo(
    () => ({
      onTogglePalette: () => {
        setPaletteOpen((p) => !p);
        setDrawerOpen(false);
      },
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
        <div className="flex min-h-screen min-w-0 flex-1 flex-col md:ml-64">
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
        onClose={() => setPaletteOpen(false)}
        projectId={projectId}
        projectOptions={projectOptions}
      />
      <ArtifactDrawer
        returnFocusTo={drawerButtonRef}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </>
  );
}
