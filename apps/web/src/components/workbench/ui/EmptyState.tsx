import type { ReactNode } from "react";

/**
 * What a panel shows before it has anything to show: a title, one sentence, and
 * optionally the control that fills it (the overview's "load the sample site").
 *
 * The copy is entirely the caller's (next-intl), and the component adds no
 * sentence of its own on purpose — a `detail` written here would be the same
 * sentence under every empty panel, and the one thing that sentence must not do
 * is name a cause. One empty state has several causes (never run, run and found
 * nothing, ran before this project had a profile), so "because you have not run
 * an audit" is a guess that is wrong some of the time. Say what is missing, not
 * why (memory: 空态文案不要点名成因).
 *
 * An empty state is also not a loading state: while the store has not read
 * storage the caller renders a skeleton (design §4.3).
 */
export function EmptyState({
  title,
  detail,
  action,
}: {
  readonly title: string;
  readonly detail: string;
  readonly action?: ReactNode | undefined;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-[15px] font-semibold text-slate-900">{title}</p>
      <p className="max-w-md text-sm text-slate-500">{detail}</p>
      {action === undefined || action === null ? null : <div className="mt-2">{action}</div>}
    </div>
  );
}
