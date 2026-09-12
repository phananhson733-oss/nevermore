import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// The rail's width and the content column's offset live in two components and
// must move together, or the column silently misaligns with the rail.
it("ShellChrome's content offset matches the Sidebar's rail width", () => {
  const sidebar = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
  const shell = readFileSync(new URL("./ShellChrome.tsx", import.meta.url), "utf8");
  const width = /\bw-(\d+)\b/.exec(sidebar)?.[1];
  const offset = /\bmd:ml-(\d+)\b/.exec(shell)?.[1];
  expect(width).toBeDefined();
  expect(offset).toBe(width);
});
