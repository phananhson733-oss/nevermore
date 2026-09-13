/**
 * The "JSON" and "AI context block" tabs: the builder's text as it will be
 * copied, minus the provenance line the actions stamp on (Q23). One component
 * for both — the two tabs differ only in which builder produced the text
 * (`profileArtifactBody`), and a second file would be the same `<pre>` twice.
 *
 * `whitespace-pre-wrap` + `break-words` so a long line wraps inside the pane
 * instead of widening the page; the body scrolls in its own box.
 */
export function ProfileTextTab({ text }: { readonly text: string }) {
  return (
    <pre className="max-h-[640px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-5 font-mono text-[13px] leading-relaxed text-slate-700">
      {text}
    </pre>
  );
}
