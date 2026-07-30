import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const PUBLIC_ASSETS = [
  {
    fileName: "icon-32x32.png",
    magic: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    width: 32,
    height: 32,
  },
  {
    fileName: "apple-touch-icon.png",
    magic: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    width: 180,
    height: 180,
  },
] as const;

describe("GenGrowth browser identity", () => {
  it("declares favicon, PNG, shortcut, and Apple Touch icons in root metadata", async () => {
    const layout = await readFile(new URL("./layout.tsx", import.meta.url), "utf8");

    expect(layout).toContain('applicationName: "GenGrowth"');
    expect(layout).toContain(
      '{ url: "/favicon.ico", sizes: "32x32", type: "image/x-icon" }',
    );
    expect(layout).toContain(
      '{ url: "/icon-32x32.png", sizes: "32x32", type: "image/png" }',
    );
    expect(layout).toContain(
      'shortcut: [{ url: "/favicon.ico", type: "image/x-icon" }]',
    );
    expect(layout).toContain('url: "/apple-touch-icon.png"');
    expect(layout).toContain('sizes: "180x180"');
  });

  it.each(PUBLIC_ASSETS)(
    "ships $fileName as a real PNG with the declared dimensions",
    async ({ fileName, magic, width, height }) => {
      const bytes = await readFile(
        new URL(`../../public/${fileName}`, import.meta.url),
      );

      expect(bytes.subarray(0, magic.length)).toEqual(magic);
      expect(bytes.readUInt32BE(16)).toBe(width);
      expect(bytes.readUInt32BE(20)).toBe(height);
    },
  );

  it("ships favicon.ico as a 32x32 Windows icon, not renamed JPEG bytes", async () => {
    const bytes = await readFile(
      new URL("../../public/favicon.ico", import.meta.url),
    );

    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
    expect(bytes.readUInt16LE(4)).toBe(1);
    expect(bytes[6]).toBe(32);
    expect(bytes[7]).toBe(32);
  });
});
