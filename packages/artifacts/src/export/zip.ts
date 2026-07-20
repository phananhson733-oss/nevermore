/**
 * Dependency-free ZIP writer (spec §10.5 enterprise export).
 *
 * Uses the STORE method only (compression method 0) so no zlib is required:
 * the enterprise bundle is a version-pinned archive whose reproducibility and
 * per-file sha256 integrity matter more than byte size. The output is fully
 * deterministic — DOS mod time/date are pinned to 0 so the same entries always
 * produce the same bytes (and therefore the same archive checksum).
 *
 * Layout written, in order:
 *   [ local file header + name + data ] * n
 *   [ central directory header + name ] * n
 *   [ end of central directory record ]
 */

import { constants as BUFFER_CONSTANTS } from "node:buffer";

/** A single archive member: an in-archive path and its raw bytes. */
export interface ZipEntry {
  readonly path: string;
  readonly data: Buffer;
}

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const END_OF_CENTRAL_DIR_SIG = 0x06054b50;

const VERSION_NEEDED = 20; // 2.0
const VERSION_MADE_BY = 20;
const FLAG_UTF8 = 0x0800; // general-purpose bit 11: filename is UTF-8
const METHOD_STORE = 0; // no compression
const DOS_TIME = 0; // pinned for determinism
const DOS_DATE = 0; // pinned for determinism

const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const EOCD_BYTES = 22;
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;

export interface CreateZipOptions {
  /** Exact completed STORE archive limit, checked before archive allocation. */
  readonly maxArchiveBytes?: number;
}

/** ZIP32 structural or caller-supplied archive limit was exceeded. */
export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipLimitError";
  }
}

/** CRC-32 (IEEE 802.3, polynomial 0xEDB88320) lookup table. */
function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = buildCrcTable();

/** Compute the CRC-32 of a buffer as an unsigned 32-bit integer. */
export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    const byte = data[i]!;
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeLocalHeader(
  target: Buffer,
  offset: number,
  nameLength: number,
  crc: number,
  size: number,
): number {
  target.writeUInt32LE(LOCAL_FILE_HEADER_SIG, offset);
  target.writeUInt16LE(VERSION_NEEDED, offset + 4);
  target.writeUInt16LE(FLAG_UTF8, offset + 6);
  target.writeUInt16LE(METHOD_STORE, offset + 8);
  target.writeUInt16LE(DOS_TIME, offset + 10);
  target.writeUInt16LE(DOS_DATE, offset + 12);
  target.writeUInt32LE(crc, offset + 14);
  target.writeUInt32LE(size, offset + 18); // compressed == uncompressed
  target.writeUInt32LE(size, offset + 22);
  target.writeUInt16LE(nameLength, offset + 26);
  target.writeUInt16LE(0, offset + 28); // extra field length
  return offset + LOCAL_HEADER_BYTES;
}

function writeCentralHeader(
  target: Buffer,
  offset: number,
  nameLength: number,
  crc: number,
  size: number,
  localOffset: number,
): number {
  target.writeUInt32LE(CENTRAL_DIR_HEADER_SIG, offset);
  target.writeUInt16LE(VERSION_MADE_BY, offset + 4);
  target.writeUInt16LE(VERSION_NEEDED, offset + 6);
  target.writeUInt16LE(FLAG_UTF8, offset + 8);
  target.writeUInt16LE(METHOD_STORE, offset + 10);
  target.writeUInt16LE(DOS_TIME, offset + 12);
  target.writeUInt16LE(DOS_DATE, offset + 14);
  target.writeUInt32LE(crc, offset + 16);
  target.writeUInt32LE(size, offset + 20); // compressed size
  target.writeUInt32LE(size, offset + 24); // uncompressed size
  target.writeUInt16LE(nameLength, offset + 28);
  target.writeUInt16LE(0, offset + 30); // extra field length
  target.writeUInt16LE(0, offset + 32); // comment length
  target.writeUInt16LE(0, offset + 34); // disk number start
  target.writeUInt16LE(0, offset + 36); // internal attributes
  target.writeUInt32LE(0, offset + 38); // external attributes
  target.writeUInt32LE(localOffset, offset + 42);
  return offset + CENTRAL_HEADER_BYTES;
}

function writeEndOfCentralDirectory(
  target: Buffer,
  offset: number,
  count: number,
  centralSize: number,
  centralOffset: number,
): number {
  target.writeUInt32LE(END_OF_CENTRAL_DIR_SIG, offset);
  target.writeUInt16LE(0, offset + 4); // this disk number
  target.writeUInt16LE(0, offset + 6); // disk with central directory
  target.writeUInt16LE(count, offset + 8); // records on this disk
  target.writeUInt16LE(count, offset + 10); // total records
  target.writeUInt32LE(centralSize, offset + 12);
  target.writeUInt32LE(centralOffset, offset + 16);
  target.writeUInt16LE(0, offset + 20); // archive comment length
  return offset + EOCD_BYTES;
}

interface PlannedZipEntry {
  readonly entry: ZipEntry;
  readonly nameLength: number;
  readonly localOffset: number;
}

interface ZipPlan {
  readonly entries: readonly PlannedZipEntry[];
  readonly localBytes: number;
  readonly centralBytes: number;
  readonly totalBytes: number;
}

function planZip(
  entries: readonly ZipEntry[],
  options: CreateZipOptions,
): ZipPlan {
  if (entries.length > UINT16_MAX) {
    throw new ZipLimitError("zip entry count exceeds the ZIP32 uint16 limit");
  }
  if (
    options.maxArchiveBytes !== undefined &&
    (!Number.isSafeInteger(options.maxArchiveBytes) ||
      options.maxArchiveBytes < 0)
  ) {
    throw new TypeError("maxArchiveBytes must be a non-negative safe integer");
  }

  const planned: PlannedZipEntry[] = [];
  let localBytes = 0;
  let centralBytes = 0;
  for (const entry of entries) {
    if (!Buffer.isBuffer(entry.data)) {
      throw new TypeError("zip entry data must be a Buffer");
    }
    const nameLength = Buffer.byteLength(entry.path, "utf8");
    if (nameLength > UINT16_MAX) {
      throw new ZipLimitError(
        "zip UTF-8 entry name exceeds the ZIP32 uint16 limit",
      );
    }
    const size = entry.data.length;
    if (!Number.isSafeInteger(size) || size < 0 || size > UINT32_MAX) {
      throw new ZipLimitError("zip entry size exceeds the ZIP32 uint32 limit");
    }
    if (localBytes > UINT32_MAX) {
      throw new ZipLimitError(
        "zip local-header offset exceeds the ZIP32 uint32 limit",
      );
    }
    planned.push({ entry, nameLength, localOffset: localBytes });
    localBytes += LOCAL_HEADER_BYTES + nameLength + size;
    centralBytes += CENTRAL_HEADER_BYTES + nameLength;
    if (centralBytes > UINT32_MAX) {
      throw new ZipLimitError(
        "zip central-directory size exceeds the ZIP32 uint32 limit",
      );
    }
  }
  if (localBytes > UINT32_MAX) {
    throw new ZipLimitError(
      "zip central-directory offset exceeds the ZIP32 uint32 limit",
    );
  }

  const totalBytes = localBytes + centralBytes + EOCD_BYTES;
  if (!Number.isSafeInteger(totalBytes)) {
    throw new ZipLimitError("zip archive size exceeds the safe integer limit");
  }
  if (
    options.maxArchiveBytes !== undefined &&
    totalBytes > options.maxArchiveBytes
  ) {
    throw new ZipLimitError("zip archive exceeds the configured byte limit");
  }
  if (totalBytes > BUFFER_CONSTANTS.MAX_LENGTH) {
    throw new ZipLimitError("zip archive exceeds the runtime buffer limit");
  }
  return { entries: planned, localBytes, centralBytes, totalBytes };
}

/**
 * Assemble a valid STORE-method .zip from the given entries. Entry order is
 * preserved. Deterministic: identical entries always yield identical bytes.
 */
export function createZip(
  entries: readonly ZipEntry[],
  options: CreateZipOptions = {},
): Buffer {
  const plan = planZip(entries, options);
  const nameCache = new Map<string, Buffer>();
  const prepared = plan.entries.map(({ entry, nameLength, localOffset }) => {
    let name = nameCache.get(entry.path);
    if (!name) {
      name = Buffer.from(entry.path, "utf8");
      nameCache.set(entry.path, name);
    }
    if (name.length !== nameLength) {
      throw new Error("zip UTF-8 filename length changed during assembly");
    }
    return { entry, name, localOffset, crc: crc32(entry.data) };
  });

  const zip = Buffer.allocUnsafe(plan.totalBytes);
  let offset = 0;
  for (const { entry, name, crc } of prepared) {
    offset = writeLocalHeader(
      zip,
      offset,
      name.length,
      crc,
      entry.data.length,
    );
    offset += name.copy(zip, offset);
    offset += entry.data.copy(zip, offset);
  }
  if (offset !== plan.localBytes) {
    throw new Error("zip local layout size mismatch");
  }

  for (const { entry, name, localOffset, crc } of prepared) {
    offset = writeCentralHeader(
      zip,
      offset,
      name.length,
      crc,
      entry.data.length,
      localOffset,
    );
    offset += name.copy(zip, offset);
  }
  if (offset !== plan.localBytes + plan.centralBytes) {
    throw new Error("zip central-directory size mismatch");
  }
  offset = writeEndOfCentralDirectory(
    zip,
    offset,
    entries.length,
    plan.centralBytes,
    plan.localBytes,
  );
  if (offset !== plan.totalBytes) {
    throw new Error("zip archive size mismatch");
  }
  return zip;
}

/**
 * Parse an archive produced by {@link createZip} back into its entries, walking
 * the local file headers and verifying each CRC-32. Self-contained (no external
 * unzip); used by round-trip tests and any in-process re-read.
 */
export function readZip(zip: Buffer): readonly ZipEntry[] {
  const entries: ZipEntry[] = [];
  let pos = 0;

  while (
    pos + LOCAL_HEADER_BYTES <= zip.length &&
    zip.readUInt32LE(pos) === LOCAL_FILE_HEADER_SIG
  ) {
    const crc = zip.readUInt32LE(pos + 14);
    const size = zip.readUInt32LE(pos + 22);
    const nameLength = zip.readUInt16LE(pos + 26);
    const extraLength = zip.readUInt16LE(pos + 28);
    const nameStart = pos + LOCAL_HEADER_BYTES;
    const path = zip.toString("utf8", nameStart, nameStart + nameLength);
    const dataStart = nameStart + nameLength + extraLength;
    const data = Buffer.from(zip.subarray(dataStart, dataStart + size));

    if (crc32(data) !== crc) {
      throw new Error(`zip: CRC-32 mismatch for entry "${path}"`);
    }

    entries.push({ path, data });
    pos = dataStart + size;
  }

  return entries;
}
