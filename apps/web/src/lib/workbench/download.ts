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
  // alive until the download has actually started — hence the deferred revoke
  // rather than revoking inline.
  document.body.append(a);
  try {
    a.click();
  } finally {
    // A throwing click() must not leak the anchor into the document or the blob
    // into the URL store; the finally covers both.
    a.remove();
    // Not 0ms: WebKit reads the object URL after the current task, and a same-tick
    // revoke has it fetch a URL that no longer resolves.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
