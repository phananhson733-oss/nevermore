import { z } from "zod";

// Shared API primitives. JSON is camelCase across the contract.
// Each primitive exports both a runtime schema (PascalCase value) and the
// inferred TypeScript type under the same name.

// Strict RFC3339 UTC instant: date-time with a mandatory Zulu ("Z") designator
// and no numeric offset, matching z.iso.datetime({ offset: false }) semantics.
const ISO_UTC_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

// BCP-47 language tag: 2-3 alpha primary subtag plus optional alphanumeric subtags.
const BCP47_LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

// ISO 3166-1 alpha-2 market code.
const MARKET_CODE_PATTERN = /^[A-Z]{2}$/;

// Opaque base64url-encoded pagination cursor.
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

// Printable ASCII (space through tilde, 0x20-0x7E).
const PRINTABLE_ASCII_PATTERN = /^[\x20-\x7e]+$/;

export const Uuid = z.uuid();
export type Uuid = z.infer<typeof Uuid>;

export const IsoDateTime = z
  .string()
  .regex(ISO_UTC_DATE_TIME_PATTERN, "Must be a strict RFC3339 UTC date-time (Z)");
export type IsoDateTime = z.infer<typeof IsoDateTime>;

export const Bcp47Locale = z
  .string()
  .min(2)
  .max(35)
  .regex(BCP47_LOCALE_PATTERN, "Must be a valid BCP-47 language tag");
export type Bcp47Locale = z.infer<typeof Bcp47Locale>;

export const MarketCode = z
  .string()
  .regex(MARKET_CODE_PATTERN, "Must be an ISO 3166-1 alpha-2 market code");
export type MarketCode = z.infer<typeof MarketCode>;

export const Cursor = z
  .string()
  .min(1)
  .max(1024)
  .regex(BASE64URL_PATTERN, "Must be a base64url string");
export type Cursor = z.infer<typeof Cursor>;

export const IdempotencyKey = z
  .string()
  .min(1)
  .max(128)
  .regex(PRINTABLE_ASCII_PATTERN, "Must be 1-128 printable ASCII characters");
export type IdempotencyKey = z.infer<typeof IdempotencyKey>;

export const RequestId = z.string().min(8).max(128);
export type RequestId = z.infer<typeof RequestId>;
