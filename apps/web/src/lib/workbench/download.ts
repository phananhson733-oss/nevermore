/** Blob download for artifacts (jsx L326). Client only. */
export function downloadText(
  name: string,
  text: string,
  mime = "text/plain;charset=utf-8",
): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  // Belt and braces: a `download` anchor never opens a window, but the opener
  // reference is worthless to us either way.
  a.rel = "noopener";
  // Firefox only activates a connected anchor, and the object URL has to stay
  // alive until the download has actually started — hence the next-task revoke
  // rather than revoking inline.
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
