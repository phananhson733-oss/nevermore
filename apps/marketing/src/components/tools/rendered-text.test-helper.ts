/**
 * What a person can actually read in a subtree. `textContent` misses the value
 * of an input, so a read-only field rendered as a control -- which is how this
 * app renders every inherited value -- looks empty to an assertion written
 * against text nodes alone, and the test passes or fails for the wrong reason.
 */
export function renderedText(node: Element | null | undefined): string {
  if (!node) return "";
  const values = [...node.querySelectorAll("input,textarea,select")]
    .map(control => (control as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value)
    .filter(value => value !== "");
  return [node.textContent ?? "", ...values].join("\n");
}
