import type { Page } from "@playwright/test";

/**
 * Hit-area measurement shared by the shell sweep (workbench-shell.mock.spec.ts)
 * and the view sweep (workbench-pr3-a11y.mock.spec.ts).
 *
 * WCAG 2.5.8 Target Size (Minimum) is 24 x 24 CSS px. A box that clears it is
 * not yet a target a finger can use, so a sweep keeps three things per target:
 * the box, whether the element sits under `[inert]` / `[hidden]`, and the DOM
 * containment between matched targets (a label that wraps its input overlaps it
 * by construction, not by accident). `operableFailures` then asks Playwright's
 * own actionability check, which fails on `pointer-events: none`, a clip, or a
 * neighbour painted on top.
 */

export const MIN_TARGET_PX = 24;

/** Comfortable touch size (iOS HIG / Material). Held only where a spec says so. */
export const TOUCH_TARGET_PX = 44;

export interface TargetBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SweptTarget {
  readonly name: string;
  /** Position in `document.querySelectorAll(selector)`, i.e. `locator(selector).nth(index)`. */
  readonly index: number;
  /** `null` when the element renders no box (`display: none`, itself or an ancestor). */
  readonly box: TargetBox | null;
  readonly underInert: boolean;
  readonly underHidden: boolean;
  /** Found by structure: an anchor that is a sibling of the project switcher's `<select>`. */
  readonly switcherProxy: boolean;
  readonly ariaHidden: string | null;
  readonly tabIndex: number;
  /** Indices of other matched targets inside this one. */
  readonly contains: readonly number[];
}

/**
 * A stable name for every target. Data hooks first, then the accessible name,
 * then the associated label, then the text. A `<kbd>` shortcut hint is
 * stripped: it reads differently per platform and is not part of the name.
 */
export async function sweep(
  page: Page,
  selector: string,
): Promise<readonly SweptTarget[]> {
  return page.evaluate((sel) => {
    const nameOf = (node: Element): string => {
      const tag = node.tagName.toLowerCase();
      const rail = node.getAttribute("data-wb-nav");
      if (rail !== null) return `rail:${rail}`;
      const legacy = node.getAttribute("data-wb-legacy-link");
      if (legacy !== null) return `legacy:${legacy}`;
      if (node.hasAttribute("data-wb-drawer-button")) return "topbar:artifacts";
      const card = node.closest("[data-wb-week-card]");
      if (card !== null) return `card:${card.getAttribute("data-wb-week-card") ?? ""}`;
      const ariaLabel = node.getAttribute("aria-label");
      if (ariaLabel !== null) return `${tag}:${ariaLabel}`;
      const clean = (text: string | null | undefined): string =>
        (text ?? "").replace(/\s+/gu, " ").trim().slice(0, 48);
      if (
        node instanceof HTMLInputElement ||
        node instanceof HTMLTextAreaElement ||
        node instanceof HTMLSelectElement
      ) {
        return `${tag}:${clean(node.labels?.[0]?.textContent)}`;
      }
      const clone = node.cloneNode(true) as Element;
      for (const kbd of clone.querySelectorAll("kbd")) kbd.remove();
      return `${tag}:${clean(clone.textContent).slice(0, 32)}`;
    };
    const nodes = Array.from(document.querySelectorAll(sel));
    return nodes.map((node, index) => {
      const rect = node.getBoundingClientRect();
      const parent = node.parentElement;
      return {
        name: nameOf(node),
        index,
        box:
          node.getClientRects().length === 0
            ? null
            : { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        underInert: node.closest("[inert]") !== null,
        underHidden: node.closest("[hidden]") !== null,
        switcherProxy:
          node instanceof HTMLAnchorElement &&
          parent !== null &&
          parent.querySelector(":scope > select") !== null,
        ariaHidden: node.getAttribute("aria-hidden"),
        tabIndex: node instanceof HTMLElement ? node.tabIndex : 0,
        contains: nodes.flatMap((other, j) =>
          j !== index && node.contains(other) ? [j] : [],
        ),
      };
    });
  }, selector);
}

/** `name WxH` for every target with a box smaller than `min` on either axis. */
export function under(
  swept: readonly SweptTarget[],
  min: number,
  only?: readonly string[],
): readonly string[] {
  return swept
    .filter((t) => only === undefined || only.includes(t.name))
    .flatMap((t) =>
      t.box !== null && (t.box.width < min || t.box.height < min)
        ? [`${t.name} ${t.box.width}x${t.box.height}`]
        : [],
    );
}

export function absent(swept: readonly SweptTarget[]): readonly string[] {
  return swept.flatMap((t) => (t.box === null ? [t.name] : [])).sort();
}

export function names(swept: readonly SweptTarget[]): readonly string[] {
  return swept.map((t) => t.name).sort();
}

/**
 * Pairs of targets whose boxes share a positive area. A pair where one element
 * contains the other is not a collision (a label around its input).
 */
export function overlaps(swept: readonly SweptTarget[]): readonly string[] {
  const boxed = swept.filter((t) => t.box !== null);
  const out: string[] = [];
  for (const [i, a] of boxed.entries()) {
    for (const b of boxed.slice(i + 1)) {
      if (a.box === null || b.box === null) continue;
      if (a.contains.includes(b.index) || b.contains.includes(a.index)) continue;
      const width =
        Math.min(a.box.x + a.box.width, b.box.x + b.box.width) -
        Math.max(a.box.x, b.box.x);
      const height =
        Math.min(a.box.y + a.box.height, b.box.y + b.box.height) -
        Math.max(a.box.y, b.box.y);
      if (width > 0.01 && height > 0.01) out.push(`${a.name} x ${b.name}`);
    }
  }
  return out;
}

/**
 * Names of the targets Playwright would refuse to click: not visible, not
 * enabled, not stable, or something else receiving the pointer at their centre.
 * `trial` performs every check and dispatches nothing.
 */
export async function operableFailures(
  page: Page,
  selector: string,
  targets: readonly SweptTarget[],
  timeout = 2_000,
): Promise<readonly string[]> {
  const failures: string[] = [];
  for (const target of targets) {
    try {
      await page
        .locator(selector)
        .nth(target.index)
        .click({ trial: true, timeout });
    } catch {
      failures.push(target.name);
    }
  }
  return failures;
}
