import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

describe("marketing font build contract", () => {
  it("does not require segmented Noto Sans SC downloads during production builds", () => {
    const layoutSource = readSource("./layout.tsx");
    const globalStyles = readSource("../globals.css");

    expect(layoutSource).not.toContain("Noto_Sans_SC");
    expect(layoutSource).not.toContain("--font-noto-sans-sc");
    expect(globalStyles).not.toContain("var(--font-noto-sans-sc)");
    expect(globalStyles).toContain('"PingFang SC"');
    expect(globalStyles).toContain('"Microsoft YaHei"');
  });
});
