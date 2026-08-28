import { describe, expect, it } from "vitest";

import * as route from "./route.ts";

describe("page-citability-check route", () => {
  it("runs on Node with a bounded duration", () => {
    expect(route.runtime).toBe("nodejs");
    expect(route.maxDuration).toBe(60);
  });

  it("exposes only POST", () => {
    expect(typeof route.POST).toBe("function");
    expect("GET" in route).toBe(false);
  });
});
