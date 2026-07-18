import { describe, expect, it } from "vitest";
import { createZip, crc32, readZip } from "./zip.ts";
import type { ZipEntry } from "./zip.ts";

const LOCAL_FILE_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
const CENTRAL_DIR_HEADER = Buffer.from([0x50, 0x4b, 0x01, 0x02]); // PK\x01\x02
const END_OF_CENTRAL_DIR = Buffer.from([0x50, 0x4b, 0x05, 0x06]); // PK\x05\x06

function entry(path: string, text: string): ZipEntry {
  return { path, data: Buffer.from(text, "utf8") };
}

describe("createZip", () => {
  it("starts with the local file header magic bytes", () => {
    const zip = createZip([entry("a.txt", "hello")]);
    expect(zip.subarray(0, 4).equals(LOCAL_FILE_HEADER)).toBe(true);
  });

  it("contains a central directory and an end-of-central-directory record", () => {
    const zip = createZip([entry("a.txt", "hello"), entry("b.txt", "world")]);
    expect(zip.includes(CENTRAL_DIR_HEADER)).toBe(true);
    // EOCD is the final 22-byte record.
    expect(zip.subarray(zip.length - 22, zip.length - 18).equals(END_OF_CENTRAL_DIR)).toBe(
      true,
    );
  });

  it("records the entry count in the end-of-central-directory record", () => {
    const zip = createZip([entry("a.txt", "1"), entry("b.txt", "2"), entry("c.txt", "3")]);
    const totalRecords = zip.readUInt16LE(zip.length - 22 + 10);
    expect(totalRecords).toBe(3);
  });

  it("is deterministic for identical input", () => {
    const build = (): Buffer =>
      createZip([entry("a.txt", "hello"), entry("dir/b.json", '{"k":1}')]);
    expect(build().equals(build())).toBe(true);
  });

  it("round-trips entries (paths + bytes recovered by parsing its own structure)", () => {
    const input: readonly ZipEntry[] = [
      entry("manifest.json", '{"schemaVersion":"x"}'),
      entry("observations.ndjson", '{"a":1}\n{"b":2}\n'),
      entry("artifacts/abc/revision-1.md", "# Title\n"),
    ];
    const parsed = readZip(createZip(input));
    expect(parsed.map((e) => e.path)).toEqual(input.map((e) => e.path));
    for (let i = 0; i < input.length; i += 1) {
      expect(parsed[i]!.data.equals(input[i]!.data)).toBe(true);
    }
  });

  it("handles empty file data", () => {
    const parsed = readZip(createZip([entry("empty.ndjson", "")]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.data.length).toBe(0);
  });

  it("readZip throws when a stored entry's CRC does not match its data", () => {
    const zip = createZip([entry("a.txt", "hello")]);
    // Corrupt the stored data byte (after the 30-byte header + 5-byte name).
    const corrupted = Buffer.from(zip);
    corrupted[30 + "a.txt".length] = corrupted[30 + "a.txt".length]! ^ 0xff;
    expect(() => readZip(corrupted)).toThrow(/CRC-32 mismatch/);
  });
});

describe("crc32", () => {
  it("matches the known CRC-32 of the ASCII string 'abc'", () => {
    // Reference CRC-32 of "abc" is 0x352441C2.
    expect(crc32(Buffer.from("abc", "utf8"))).toBe(0x352441c2);
  });

  it("is 0 for empty input", () => {
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });
});
