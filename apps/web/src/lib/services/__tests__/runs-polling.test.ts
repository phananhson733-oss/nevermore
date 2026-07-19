import { describe, expect, it } from "vitest";
import { runPollingHeaders } from "../runs.ts";

describe("runPollingHeaders", () => {
  it.each(["queued", "running"])(
    "asks clients to poll an active %s run",
    (status) => {
      expect(runPollingHeaders(status)).toEqual({ "Retry-After": "1" });
    },
  );

  it.each(["completed", "partial", "failed", "cancelled"])(
    "does not advertise more polling for terminal status %s",
    (status) => {
      expect(runPollingHeaders(status)).toBeUndefined();
    },
  );
});
