import { LOG_REDACT_LIMITS, redact, redactText } from "./redact.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const RESERVED_LOG_FIELDS: ReadonlySet<string> = new Set([
  "timestamp",
  "level",
  "event",
  "service",
  "environment",
  "requestId",
  "runId",
  "workspaceId",
  "projectId",
]);
const FALLBACK_LINE =
  '{"level":"error","event":"logger_emit_failed","code":"LOG_EMIT_FAILED"}\n';

/** Correlation fields carried on every structured log line (spec §15.2). */
export interface LogContext {
  readonly service: "web" | "worker";
  readonly environment: string;
  readonly requestId?: string;
  readonly runId?: string;
  readonly workspaceId?: string;
  readonly projectId?: string;
}

export interface Logger {
  readonly context: LogContext;
  child(extra: Partial<LogContext>): Logger;
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

const parseLevel = (raw: string | undefined): LogLevel => {
  if (typeof raw !== "string") return "info";
  const value = raw.toLowerCase();
  return value === "debug" || value === "info" || value === "warn" || value === "error"
    ? value
    : "info";
};

function safeFields(fields: Record<string, unknown> | undefined): Record<string, unknown> {
  if (fields === undefined) return {};
  const redacted = redact(fields, LOG_REDACT_LIMITS);
  if (
    typeof redacted !== "object" ||
    redacted === null ||
    Array.isArray(redacted)
  ) {
    return { fields: redacted };
  }

  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(redacted)) {
    if (!RESERVED_LOG_FIELDS.has(key)) {
      Reflect.defineProperty(filtered, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
    }
  }
  return filtered;
}

function writeFallback(failedSink?: NodeJS.WriteStream): void {
  const sinks =
    failedSink === process.stderr
      ? [process.stdout]
      : failedSink === process.stdout
        ? [process.stderr]
        : [process.stderr, process.stdout];
  for (const sink of sinks) {
    try {
      sink.write(FALLBACK_LINE);
      return;
    } catch {
      // A logger must never become the application failure path.
    }
  }
}

/**
 * Create a JSON-lines logger. `fields` are deep-redacted before emission so that
 * tokens, cookies, and credentials can never leak into stdout (spec §14.3).
 * Callers must not pass client content, query text, full URLs, or model
 * prompt/output as fields.
 */
export function createLogger(context: LogContext, minLevel?: LogLevel): Logger {
  const threshold = LEVEL_ORDER[
    parseLevel(minLevel ?? process.env["LOG_LEVEL"])
  ];

  const emit = (level: LogLevel, event: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[level] < threshold) return;
    const sink = level === "error" || level === "warn" ? process.stderr : process.stdout;
    let serialized: string;
    try {
      const line = {
        ...safeFields(fields),
        ...context,
        timestamp: new Date().toISOString(),
        level,
        event: redactText(event),
      };
      const encoded = JSON.stringify(line);
      if (typeof encoded !== "string") throw new TypeError("log serialization failed");
      serialized = `${encoded}\n`;
    } catch {
      writeFallback();
      return;
    }

    try {
      sink.write(serialized);
    } catch {
      writeFallback(sink);
    }
  };

  return {
    context,
    child(extra) {
      return createLogger({ ...context, ...extra }, minLevel);
    },
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };
}
