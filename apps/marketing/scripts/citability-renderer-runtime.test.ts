import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertCitabilityRuntimeEnvelope } from "./citability-renderer-runtime.ts";

describe("hard runtime envelope", () => {
  const valid = { "memory.max": "805306368", "cpu.max": "100000 100000", "pids.max": "128" };
  it("requires actual Linux cgroup bounds rather than an environment claim", () => {
    expect(assertCitabilityRuntimeEnvelope({ platform: "linux", read: (name) => valid[name] })).toEqual({ memoryBytes: 805306368, cpuCores: 1, maxProcesses: 128 });
    expect(() => assertCitabilityRuntimeEnvelope({ platform: "darwin", read: (name) => valid[name] })).toThrow();
  });
  it.each(["memory.max", "cpu.max", "pids.max"] as const)("refuses missing, unlimited or excessive %s", (name) => {
    for (const value of ["max", "0", "999999999999999 1", ""]) {
      expect(() => assertCitabilityRuntimeEnvelope({ platform: "linux", read: (field) => field === name ? value : valid[field] })).toThrow();
    }
  });
  it("ships runnable container hard limits with no capabilities or host mounts", () => {
    const compose = readFileSync(new URL("./citability-renderer.compose.yml", import.meta.url), "utf8");
    expect(compose).toContain("mem_limit: 768m");
    expect(compose).toContain('cpus: "1.0"');
    expect(compose).toContain("pids_limit: 128");
    expect(compose).toContain("read_only: true");
    expect(compose).toContain('cap_drop: ["ALL"]');
    expect(compose).toContain("no-new-privileges:true");
    expect(compose).not.toContain("privileged: true");
    expect(compose).not.toContain("/var/run/docker.sock");
  });
  it("permits Chromium's inner user-namespace chroot without granting host capabilities", () => {
    const profile = JSON.parse(readFileSync(new URL("./citability-renderer.seccomp.json", import.meta.url), "utf8")) as { syscalls: { names: string[]; action: string; includes?: { caps?: string[] } }[] };
    expect(profile.syscalls.some((rule) => rule.names.includes("chroot") && rule.action === "SCMP_ACT_ALLOW" && !rule.includes?.caps)).toBe(true);
  });
});
