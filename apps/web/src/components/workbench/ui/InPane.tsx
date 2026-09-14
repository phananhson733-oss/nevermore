import type { ReactNode } from "react";
import { PANEL_BODY, PANEL_FOOT, PANEL_HEAD, PANEL_SHELL, PANEL_TAG, PANEL_TITLE } from "./panel.ts";

/**
 * The left-hand pane of a two-pane view: what the operator fills in, with the
 * control that starts the run in its footer (`jsx:923`).
 *
 * It owns the shell and nothing else. Every word is the caller's — the `tag`
 * included, because "input" is a translated label and a view is not allowed to
 * spell a Chinese literal (design §7). No `.wb-reset` wrapper either: that class
 * belongs to the view root, which is a direct child of `<main>` (裁决 Q26), and a
 * second reset inside it would re-zero borders below the point the view already
 * handled.
 *
 * The `data-wb-pane-*` attributes are where the tests and the mock e2e find the
 * three regions; class names are not a contract, and reading structure by
 * position ("the second div") breaks the first time a wrapper appears.
 */
export function InPane({
  title,
  tag,
  note,
  footer,
  children,
}: {
  readonly title: string;
  /** The small "input" chip that opens the header; omitted when absent. */
  readonly tag?: string | undefined;
  /** One sentence above the fields. Rendered first, so it reads as an intro. */
  readonly note?: string | undefined;
  readonly footer?: ReactNode | undefined;
  readonly children: ReactNode;
}) {
  return (
    <section className={PANEL_SHELL}>
      <div data-wb-pane-head className={PANEL_HEAD}>
        <div className="flex flex-wrap items-center gap-2">
          {tag === undefined ? null : <span className={PANEL_TAG}>{tag}</span>}
          <h2 className={PANEL_TITLE}>{title}</h2>
        </div>
      </div>
      <div data-wb-pane-body className={PANEL_BODY}>
        {note === undefined ? null : <p className="mb-4 text-sm text-slate-500">{note}</p>}
        {children}
      </div>
      {footer === undefined || footer === null ? null : (
        <div data-wb-pane-foot className={PANEL_FOOT}>
          {footer}
        </div>
      )}
    </section>
  );
}
