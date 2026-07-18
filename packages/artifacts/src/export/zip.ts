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

function localHeader(nameLength: number, crc: number, size: number): Buffer {
  const header = Buffer.alloc(LOCAL_HEADER_BYTES);
  header.writeUInt32LE(LOCAL_FILE_HEADER_SIG, 0);
  header.writeUInt16LE(VERSION_NEEDED, 4);
  header.writeUInt16LE(FLAG_UTF8, 6);
  header.writeUInt16LE(METHOD_STORE, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(size, 18); // compressed size == uncompressed (store)
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(nameLength, 26);
  header.writeUInt16LE(0, 28); // extra field length
  return header;
}

function centralHeader(
  nameLength: number,
  crc: number,
  size: number,
  localOffset: number,
): Buffer {
  const header = Buffer.alloc(CENTRAL_HEADER_BYTES);
  header.writeUInt32LE(CENTRAL_DIR_HEADER_SIG, 0);
  header.writeUInt16LE(VERSION_MADE_BY, 4);
  header.writeUInt16LE(VERSION_NEEDED, 6);
  header.writeUInt16LE(FLAG_UTF8, 8);
  header.writeUInt16LE(METHOD_STORE, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(size, 20); // compressed size
  header.writeUInt32LE(size, 24); // uncompressed size
  header.writeUInt16LE(nameLength, 28);
  header.writeUInt16LE(0, 30); // extra field length
  header.writeUInt16LE(0, 32); // comment length
  header.writeUInt16LE(0, 34); // disk number start
  header.writeUInt16LE(0, 36); // internal attributes
  header.writeUInt32LE(0, 38); // external attributes
  header.writeUInt32LE(localOffset, 42);
  return header;
}

function endOfCentralDirectory(
  count: number,
  centralSize: number,
  centralOffset: number,
): Buffer {
  const eocd = Buffer.alloc(EOCD_BYTES);
  eocd.writeUInt32LE(END_OF_CENTRAL_DIR_SIG, 0);
  eocd.writeUInt16LE(0, 4); // this disk number
  eocd.writeUInt16LE(0, 6); // disk with central directory
  eocd.writeUInt16LE(count, 8); // records on this disk
  eocd.writeUInt16LE(count, 10); // total records
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20); // archive comment length
  return eocd;
}

/**
 * Assemble a valid STORE-method .zip from the given entries. Entry order is
 * preserved. Deterministic: identical entries always yield identical bytes.
 */
export function createZip(entries: readonly ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.path, "utf8");
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = localHeader(nameBuf.length, crc, size);
    localParts.push(local, nameBuf, entry.data);

    centralParts.push(centralHeader(nameBuf.length, crc, size, offset), nameBuf);
    offset += local.length + nameBuf.length + entry.data.length;
  }

  const localData = Buffer.concat(localParts);
  const centralDir = Buffer.concat(centralParts);
  const eocd = endOfCentralDirectory(
    entries.length,
    centralDir.length,
    localData.length,
  );

  return Buffer.concat([localData, centralDir, eocd]);
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
