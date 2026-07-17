import { redact } from "./redact.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

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
  const value = (raw ?? "info").toLowerCase();
  return value === "debug" || value === "info" || value === "warn" || value === "error"
    ? value
    : "info";
};

/**
 * Create a JSON-lines logger. `fields` are deep-redacted before emission so that
 * tokens, cookies, and credentials can never leak into stdout (spec §14.3).
 * Callers must not pass client content, query text, full URLs, or model
 * prompt/output as fields.
 */
export function createLogger(context: LogContext, minLevel?: LogLevel): Logger {
  const threshold = LEVEL_ORDER[minLevel ?? parseLevel(process.env["LOG_LEVEL"])];

  const emit = (level: LogLevel, event: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[level] < threshold) return;
    const line = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...context,
      ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
    };
    const sink = level === "error" || level === "warn" ? process.stderr : process.stdout;
    sink.write(`${JSON.stringify(line)}\n`);
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
