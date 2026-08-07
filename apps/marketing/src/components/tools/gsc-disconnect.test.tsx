// @input  -- both tool namespaces, rendered through the real message bundles
// @output -- a failing test when "disconnect anytime" stops being a real control
// @pos    -- the guard on the visitor-side half of the disconnect promise
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import { GOOGLE_PERMISSIONS_URL } from "../../lib/auth/disconnect-request.ts";
import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { GscDisconnect } from "./gsc-disconnect.tsx";

const NAMESPACES = ["tools.quickWins", "tools.trafficDrop"] as const;

function render(locale: "en" | "zh", namespace: string): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh}>
      <GscDisconnect namespace={namespace} />
    </NextIntlClientProvider>,
  );
}

/** The tool source, read as text: what the connected branch actually mounts. */
function source(file: string): string {
  return readFileSync(
    fileURLToPath(new URL(file, import.meta.url)),
    "utf8",
  );
}

describe("GscDisconnect", () => {
  it.each(NAMESPACES)("renders a real control for %s in English", (ns) => {
    const markup = render("en", ns);

    expect(markup).toContain(en.tools[ns.split(".")[1] as "quickWins"].disconnect);
    expect(markup).toContain("<button");
    // Nothing is claimed up front about Google confirming anything; the hint
    // says what the control does, and the outcome says what happened.
    expect(markup).toContain(
      en.tools[ns.split(".")[1] as "quickWins"].disconnectHint,
    );
  });

  it.each(NAMESPACES)("renders a real control for %s in Chinese", (ns) => {
    const markup = render("zh", ns);

    expect(markup).toContain(zh.tools[ns.split(".")[1] as "quickWins"].disconnect);
    expect(markup).toMatch(/[一-鿿]/);
  });

  it("says nothing about the outcome before one has happened", () => {
    // The failure notices are the honest half of this control. Rendering one
    // unprompted would tell a visitor their disconnect failed before they
    // pressed anything.
    const markup = render("en", "tools.quickWins");

    expect(markup).not.toContain(en.tools.quickWins.disconnectRevokeFailed);
    expect(markup).not.toContain(en.tools.quickWins.disconnectFailed);
    expect(markup).not.toContain(GOOGLE_PERMISSIONS_URL);
  });
});

describe("the connected tools mount it", () => {
  // The promise is "disconnect anytime", so the control has to be reachable
  // from the running tool — not only from a page a connected visitor never
  // sees again. Both connected states mount it: the property picker, and the
  // "you own no verified property" state, which is where a visitor who
  // authorized the wrong Google account ends up.
  it.each([
    ["./quick-wins-tool.tsx", "tools.quickWins"],
    ["./traffic-drop-tool.tsx", "tools.trafficDrop"],
  ])("%s renders GscDisconnect only after the connect branch returns", (
    file,
    namespace,
  ) => {
    const text = source(file);
    const mounts = [...text.matchAll(/<GscDisconnect namespace="([^"]+)"/g)];

    expect(mounts).toHaveLength(2);
    for (const mount of mounts) expect(mount[1]).toBe(namespace);

    // Everything before this line runs for a visitor with no grant at all.
    const connectBranchEnd = text.indexOf("if (properties === null)");
    expect(connectBranchEnd).toBeGreaterThan(-1);
    for (const mount of mounts) {
      expect(mount.index).toBeGreaterThan(connectBranchEnd);
    }
  });
});
