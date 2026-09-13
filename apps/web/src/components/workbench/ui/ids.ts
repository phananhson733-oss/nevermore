/** The app root that Dialog makes inert while open. ShellChrome renders it; Dialog looks it up. */
export const WB_APP_ROOT_ID = "wb-app";

/**
 * The project layout's root element — the parent of `#wb-app` and of everything
 * `ShellChrome` renders beside it. It carries the next/font variable class that
 * defines `--font-wb`, so a portal that wants the workbench face has to land
 * inside it; `document.body` is outside, and `font-sans` falls back there with
 * no error of any kind. It is never made inert (`Dialog` marks `#wb-app`).
 */
export const WB_ROOT_ID = "wb-root";

/**
 * `<main>` in `ShellChrome`, and the last place `Dialog` sends focus on close
 * when none of its own targets can take it. It carries `tabIndex={-1}` there:
 * focusable by script (and by the skip link), never a Tab stop.
 */
export const WB_MAIN_ID = "main-content";
