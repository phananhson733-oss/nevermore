import type { ReactNode } from "react";
import { PANEL_BODY, PANEL_FOOT, PANEL_HEAD, PANEL_SHELL, PANEL_TAG, PANEL_TITLE } from "./panel.ts";
import { RunningSteps, type RunProgress } from "./RunningSteps.tsx";
import { Tabs, tabButtonId, tabPanelId, type TabItem } from "./Tabs.tsx";

/**
 * The right-hand pane of a two-pane view (`jsx:946`): the result, whatever state
 * it is in.
 *
 * Its body is a three-way machine — a run in flight beats everything, then
 * content, then the empty state — and the three are mutually exclusive on
 * purpose. Children rendered under the run list would say a finished result is
 * already there; an empty state next to content says the opposite. `hasContent`
 * is the caller's own answer rather than something guessed from `children`,
 * because a view that always renders a fragment would otherwise never show its
 * empty state, silently.
 *
 * Tabs appear only when there is more than one (a single-tab tablist is a
 * promise to a screen-reader user that there is somewhere to move to). When they
 * are there, the body is that tab's panel and the two ids are built with `Tabs`'s
 * own helpers — hand-spelling either half is how the pointer between a tab and
 * its panel goes stale. Only the selected panel is rendered, which is what the
 * prototype does and what the views need; the unselected tabs' `aria-controls`
 * therefore point at nothing until they are selected.
 *
 * The footer is the caller's (`ArtifactActions` for a view with an artifact), so
 * this file holds no action of its own.
 */

export interface OutPaneTabs {
  readonly items: readonly TabItem[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  /** Accessible name for the tablist, e.g. "output view". */
  readonly label: string;
  /** Namespace for the tab/panel ids; must be unique on the page. */
  readonly idPrefix: string;
}

export function OutPane({
  title,
  tag,
  tabs,
  run,
  hasContent,
  empty,
  footer,
  children,
}: {
  readonly title: string;
  /** The small "output" chip that opens the header; omitted when absent. */
  readonly tag?: string | undefined;
  readonly tabs?: OutPaneTabs | undefined;
  /** Non-null while a run is in flight; it wins over content and over empty. */
  readonly run?: RunProgress | null | undefined;
  readonly hasContent: boolean;
  /** What to show when there is nothing yet — an `EmptyState`, usually. */
  readonly empty: ReactNode;
  readonly footer?: ReactNode | undefined;
  readonly children: ReactNode;
}) {
  const withTabs = tabs !== undefined && tabs.items.length > 1;
  const panel = withTabs
    ? {
        role: "tabpanel" as const,
        id: tabPanelId(tabs.idPrefix, tabs.value),
        "aria-labelledby": tabButtonId(tabs.idPrefix, tabs.value),
      }
    : {};

  return (
    <section className={PANEL_SHELL}>
      <div data-wb-pane-head className={PANEL_HEAD}>
        <div className="flex flex-wrap items-center gap-2">
          {tag === undefined ? null : <span className={PANEL_TAG}>{tag}</span>}
          <h2 className={PANEL_TITLE}>{title}</h2>
        </div>
        {withTabs ? (
          <Tabs
            tabs={tabs.items}
            value={tabs.value}
            onChange={tabs.onChange}
            label={tabs.label}
            idPrefix={tabs.idPrefix}
            // Exactly one panel is in the DOM: the selected one, rendered below
            // (裁决 Q34). Passing every id would aim the other tabs at nothing.
            renderedIds={[tabs.value]}
          />
        ) : null}
      </div>
      <div data-wb-pane-body className={PANEL_BODY} {...panel}>
        {run === undefined || run === null ? (
          hasContent ? (
            children
          ) : (
            empty
          )
        ) : (
          <RunningSteps progress={run} />
        )}
      </div>
      {footer === undefined || footer === null ? null : (
        <div data-wb-pane-foot className={PANEL_FOOT}>
          {footer}
        </div>
      )}
    </section>
  );
}
