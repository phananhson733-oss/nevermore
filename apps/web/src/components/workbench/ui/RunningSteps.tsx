import { cn } from "./cn.ts";

/**
 * The step list an output pane shows while a module is working (`jsx:930`).
 *
 * The three states are derived from one index rather than handed in per step: a
 * caller that computed them itself would be the second place the mapping lives,
 * and "the step that has not started yet, painted as finished" is not something
 * a screenshot review catches.
 *
 * The list is the live region (`aria-live="polite"`), so a screen reader is told
 * the run moved on rather than being left with a silent screen. The pulsing dot
 * is a Tailwind keyframe with `motion-reduce:animate-none`: production CSP has
 * no `unsafe-inline`, so no animation may come from a style attribute, and a
 * reader who asked for less motion must be able to switch it off. Done and
 * pending differ by fill, not only by colour (WCAG 1.4.1): finished dots are
 * solid, waiting ones are an outline.
 */

export interface RunProgress {
  readonly steps: readonly string[];
  /** The step in flight. Everything before it is done, everything after pending. */
  readonly current: number;
}

type StepState = "done" | "now" | "pending";

const DOT_BASE = "h-2 w-2 shrink-0 rounded-full";
const DOT: Readonly<Record<StepState, string>> = {
  done: "bg-emerald-500",
  now: "bg-wb-ink animate-pulse motion-reduce:animate-none",
  pending: "border border-slate-300 bg-white",
};
const TEXT: Readonly<Record<StepState, string>> = {
  done: "text-slate-500",
  now: "font-medium text-slate-900",
  pending: "text-slate-500",
};

function stepState(index: number, current: number): StepState {
  if (index < current) return "done";
  return index === current ? "now" : "pending";
}

export function RunningSteps({ progress }: { readonly progress: RunProgress }) {
  return (
    <ol aria-live="polite" className="flex flex-col gap-2.5">
      {progress.steps.map((label, index) => {
        const state = stepState(index, progress.current);
        return (
          <li
            // The labels are a fixed list per module, so the index is stable.
            key={index}
            data-wb-step={state}
            className="flex items-center gap-2.5 text-sm"
          >
            <span aria-hidden="true" className={cn(DOT_BASE, DOT[state])} />
            <span className={TEXT[state]}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
