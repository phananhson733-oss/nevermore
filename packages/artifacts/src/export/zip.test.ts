import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
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

  it("preserves the stable STORE byte layout", () => {
    const zip = createZip([entry("a.txt", "hello")]);
    expect(createHash("sha256").update(zip).digest("hex")).toBe(
      "04a435f8d1103037ad6971c6ecb289cdf4020ee04524f2b00c663d14123f3030",
    );
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

  it("reuses an encoded filename for duplicate paths without changing entry order", () => {
    const parsed = readZip(
      createZip([entry("same.txt", "first"), entry("same.txt", "second")]),
    );

    expect(parsed.map(({ path }) => path)).toEqual(["same.txt", "same.txt"]);
    expect(parsed.map(({ data }) => data.toString("utf8"))).toEqual([
      "first",
      "second",
    ]);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid maxArchiveBytes value %s before allocating",
    (maxArchiveBytes) => {
      const allocUnsafe = vi.spyOn(Buffer, "allocUnsafe");

      try {
        expect(() =>
          createZip([entry("a.txt", "hello")], { maxArchiveBytes }),
        ).toThrowError(
          new TypeError("maxArchiveBytes must be a non-negative safe integer"),
        );
        expect(allocUnsafe).not.toHaveBeenCalled();
      } finally {
        allocUnsafe.mockRestore();
      }
    },
  );

  it("rejects a non-Buffer entry body before allocating", () => {
    const malformed = { path: "a.txt", data: "hello" } as unknown as ZipEntry;
    const allocUnsafe = vi.spyOn(Buffer, "allocUnsafe");

    try {
      expect(() => createZip([malformed])).toThrowError(
        new TypeError("zip entry data must be a Buffer"),
      );
      expect(allocUnsafe).not.toHaveBeenCalled();
    } finally {
      allocUnsafe.mockRestore();
    }
  });

  it("rejects an entry body whose reported size exceeds ZIP32", () => {
    const oversizedData = { length: 0x1_0000_0000 } as Buffer;
    const isBuffer = vi.spyOn(Buffer, "isBuffer").mockReturnValue(true);

    try {
      expect(() =>
        createZip([{ path: "oversized.bin", data: oversizedData }]),
      ).toThrowError(/entry size exceeds the ZIP32 uint32 limit/);
    } finally {
      isBuffer.mockRestore();
    }
  });

  it("rejects a later local-header offset that cannot fit in ZIP32", () => {
    const uint32SizedData = { length: 0xffff_ffff } as Buffer;
    const isBuffer = vi.spyOn(Buffer, "isBuffer").mockReturnValue(true);

    try {
      expect(() =>
        createZip([
          { path: "first.bin", data: uint32SizedData },
          { path: "second.bin", data: Buffer.alloc(0) },
        ]),
      ).toThrowError(/local-header offset exceeds the ZIP32 uint32 limit/);
    } finally {
      isBuffer.mockRestore();
    }
  });

  it("rejects a central-directory offset that cannot fit in ZIP32", () => {
    const uint32SizedData = { length: 0xffff_ffff } as Buffer;
    const isBuffer = vi.spyOn(Buffer, "isBuffer").mockReturnValue(true);

    try {
      expect(() =>
        createZip([{ path: "oversized-local-layout.bin", data: uint32SizedData }]),
      ).toThrowError(/central-directory offset exceeds the ZIP32 uint32 limit/);
    } finally {
      isBuffer.mockRestore();
    }
  });

  it("rejects a central directory whose ZIP32 size field would overflow", () => {
    const empty = entry("x", "");
    const entries = new Array<ZipEntry>(65_535).fill(empty);
    const byteLength = vi
      .spyOn(Buffer, "byteLength")
      .mockReturnValue(0xffff);

    try {
      expect(() => createZip(entries)).toThrowError(
        /central-directory size exceeds the ZIP32 uint32 limit/,
      );
    } finally {
      byteLength.mockRestore();
    }
  });

  it("rejects an exact STORE archive over the caller limit before allocating it", () => {
    const input = [entry("a.txt", "hello")];
    const exactBytes = createZip(input).length;
    const alloc = vi.spyOn(Buffer, "alloc");
    const allocUnsafe = vi.spyOn(Buffer, "allocUnsafe");

    try {
      expect(() =>
        createZip(input, { maxArchiveBytes: exactBytes - 1 }),
      ).toThrowError(expect.objectContaining({ name: "ZipLimitError" }));
      expect(alloc).not.toHaveBeenCalled();
      expect(allocUnsafe).not.toHaveBeenCalled();
    } finally {
      alloc.mockRestore();
      allocUnsafe.mockRestore();
    }
  });

  it("allocates the completed archive once at its exact size", () => {
    const alloc = vi.spyOn(Buffer, "alloc");
    const allocUnsafe = vi.spyOn(Buffer, "allocUnsafe");

    try {
      const zip = createZip([entry("a.txt", "hello"), entry("b.txt", "world")]);
      expect(alloc).not.toHaveBeenCalled();
      expect(allocUnsafe).toHaveBeenCalledTimes(1);
      expect(allocUnsafe).toHaveBeenCalledWith(zip.length);
    } finally {
      alloc.mockRestore();
      allocUnsafe.mockRestore();
    }
  });

  it("rejects 65,536 entries as a ZIP32 limit error", () => {
    const empty = entry("empty", "");
    const entries = new Array<ZipEntry>(65_536).fill(empty);
    expect(() => createZip(entries)).toThrowError(
      expect.objectContaining({ name: "ZipLimitError" }),
    );
  });

  it("checks UTF-8 filename bytes against the ZIP32 uint16 limit", () => {
    expect(() => createZip([entry("界".repeat(21_846), "")])).toThrowError(
      expect.objectContaining({ name: "ZipLimitError" }),
    );
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
