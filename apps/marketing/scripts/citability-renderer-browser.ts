// Plain JavaScript strings intentionally: serializing transpiled functions can
// smuggle tsx/esbuild helpers (e.g. __name) into an isolated world without them.
export const CITABILITY_CAPTURE_SCRIPT = String.raw`(cap) => {
  if (!document.body) return { text: "", complete: true, presentationDependent: false };
  const nodes = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const parts = [];
  let length = 0, visited = 0, complete = true;
  const visible = new WeakMap();
  const elementVisible = (element) => {
    if (!element) return true;
    const cached = visible.get(element);
    if (cached !== undefined) return cached;
    const style = getComputedStyle(element);
    const value = !["SCRIPT", "STYLE", "TEMPLATE", "NAV", "FOOTER", "ASIDE"].includes(element.tagName) &&
      style.display !== "none" && style.opacity !== "0" && style.contentVisibility !== "hidden" && elementVisible(element.parentElement);
    visible.set(element, value);
    return value;
  };
  while (nodes.nextNode()) {
    if (++visited > 50000) { complete = false; break; }
    const node = nodes.currentNode;
    if (!elementVisible(node.parentElement)) continue;
    const style = node.parentElement ? getComputedStyle(node.parentElement) : null;
    if (style?.visibility === "hidden" || style?.visibility === "collapse") continue;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(node.length, cap + 1));
    if (![...range.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0)) continue;
    const text = node.substringData(0, cap + 1).replace(/\s+/g, " ").trim();
    if (node.length > cap) complete = false;
    if (!text) continue;
    if (length + text.length + parts.length > cap) { complete = false; parts.push(text.slice(0, Math.max(0, cap - length - parts.length))); break; }
    parts.push(text); length += text.length;
  }
  const media = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let presentationDependent = false, elements = 0;
  while (media.nextNode()) {
    if (++elements > 50000) { complete = false; break; }
    const element = media.currentNode;
    if (["IMG", "VIDEO", "AUDIO"].includes(element.tagName) && (element.hasAttribute("onload") || element.hasAttribute("onerror"))) { presentationDependent = true; break; }
  }
  return { text: parts.join(" ").slice(0, cap), complete, presentationDependent };
}`;

export const CITABILITY_INIT_SCRIPT = String.raw`(() => {
  const notifyBlocked = window.__citabilityPolicyBlocked;
  const notifyPresentation = window.__citabilityPresentationDependency;
  Object.defineProperty(window, "__citabilityPolicyBlocked", { value: notifyBlocked, writable: false, configurable: false });
  Object.defineProperty(window, "__citabilityPresentationDependency", { value: notifyPresentation, writable: false, configurable: false });
  const report = () => { void notifyBlocked(); };
  document.addEventListener("securitypolicyviolation", report);
  const presentation = () => { void notifyPresentation(); };
  const add = EventTarget.prototype.addEventListener;
  Object.defineProperty(EventTarget.prototype, "addEventListener", {
    configurable: false, writable: false,
    value: function(type, listener, options) {
      if ((this instanceof HTMLImageElement || this instanceof HTMLMediaElement) && ["load", "error", "loadeddata", "canplay"].includes(type)) presentation();
      return add.call(this, type, listener, options);
    }
  });
  for (const constructor of [HTMLImageElement, HTMLMediaElement]) {
    for (const key of ["onload", "onerror", "onloadeddata", "oncanplay"]) {
      let prototype = constructor.prototype, descriptor;
      while (prototype && !descriptor) { descriptor = Object.getOwnPropertyDescriptor(prototype, key); prototype = Object.getPrototypeOf(prototype); }
      if (!descriptor?.get || !descriptor?.set) continue;
      Object.defineProperty(constructor.prototype, key, {
        configurable: false,
        get: function() { return descriptor.get.call(this); },
        set: function(value) { if (value !== null) presentation(); return descriptor.set.call(this, value); }
      });
    }
  }
  const decode = HTMLImageElement.prototype.decode;
  Object.defineProperty(HTMLImageElement.prototype, "decode", { configurable: false, writable: false, value: function() { presentation(); return decode.call(this); } });
  if ("serviceWorker" in navigator) {
    Object.defineProperty(navigator.serviceWorker, "register", {
      configurable: false, writable: false,
      value: () => { report(); return Promise.reject(new DOMException("Service workers are disabled in this isolated capture", "SecurityError")); }
    });
  }
})()`;
