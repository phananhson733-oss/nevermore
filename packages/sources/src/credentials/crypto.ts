/**
 * Application-layer credential encryption (spec §14.3). AES-256-GCM with a
 * fresh random 96-bit (12-byte) IV per message.
 *
 * The 32-byte key is passed IN by the caller (derived at the boundary from env
 * `CREDENTIAL_ENCRYPTION_KEY`). This module is deliberately PURE — it never
 * reads the environment, never logs, and holds no state — so it stays trivially
 * testable and key management (rotation, sourcing) lives entirely at the call
 * site.
 *
 * Blob layout (contiguous bytes, fixed offsets):
 *   [ version : 1 byte  = 0x01 ]
 *   [ iv      : 12 bytes        ]
 *   [ authTag : 16 bytes        ]
 *   [ ciphertext : remaining    ]
 *
 * Never log plaintext, key, IV, or the blob.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Current cipher envelope version. Bump on any algorithm/layout change. */
export const CREDENTIAL_CIPHER_VERSION = 1;

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const VERSION_BYTES = 1;

const VERSION_OFFSET = 0;
const IV_OFFSET = VERSION_OFFSET + VERSION_BYTES;
const AUTH_TAG_OFFSET = IV_OFFSET + IV_BYTES;
const CIPHERTEXT_OFFSET = AUTH_TAG_OFFSET + AUTH_TAG_BYTES;

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(`credential key must be ${KEY_BYTES} bytes, got ${key.length}`);
  }
}

/**
 * Encrypt a credential. Returns a self-describing blob (version + IV + auth tag
 * + ciphertext). A new random IV is generated per call, so encrypting the same
 * plaintext twice yields different blobs.
 */
export function encryptCredential(plaintext: string | Buffer, key: Buffer): Buffer {
  assertKey(key);
  const input = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const version = Buffer.from([CREDENTIAL_CIPHER_VERSION]);
  return Buffer.concat([version, iv, authTag, ciphertext]);
}

/**
 * Decrypt a credential blob. Throws on a wrong-length key, a truncated blob, an
 * unsupported version, or a failed authentication tag (tamper / wrong key).
 */
export function decryptCredential(blob: Buffer, key: Buffer): Buffer {
  assertKey(key);
  if (blob.length < CIPHERTEXT_OFFSET) {
    throw new Error("credential blob is too short to contain a valid header");
  }
  const version = blob.readUInt8(VERSION_OFFSET);
  if (version !== CREDENTIAL_CIPHER_VERSION) {
    throw new Error(`unsupported credential cipher version ${version}`);
  }
  const iv = blob.subarray(IV_OFFSET, AUTH_TAG_OFFSET);
  const authTag = blob.subarray(AUTH_TAG_OFFSET, CIPHERTEXT_OFFSET);
  const ciphertext = blob.subarray(CIPHERTEXT_OFFSET);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
