import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBoss: vi.fn(),
  startBoss: vi.fn(),
  getEnv: vi.fn(),
}));

vi.mock("@sf/db", () => ({
  createBoss: mocks.createBoss,
  startBoss: mocks.startBoss,
}));

vi.mock("@/env", () => ({
  getEnv: mocks.getEnv,
}));

class FakeBoss extends EventEmitter {
  readonly stop = vi.fn(async () => undefined);
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  mocks.createBoss.mockReset();
  mocks.startBoss.mockReset();
  mocks.getEnv.mockReset().mockReturnValue({
    DATABASE_URL: "postgresql://unused:unused@127.0.0.1:5432/unused",
    DB_POOL_MAX: 1,
  });
});

describe("getBoss runtime lifecycle", () => {
  it("clears a failed startup so the next call can create a fresh boss", async () => {
    const first = new FakeBoss();
    const second = new FakeBoss();
    mocks.createBoss.mockReturnValueOnce(first).mockReturnValueOnce(second);
    mocks.startBoss
      .mockRejectedValueOnce(new Error("transient-startup-marker"))
      .mockResolvedValueOnce(undefined);
    const { getBoss } = await import("./boss.ts");

    await expect(getBoss()).rejects.toThrow("transient-startup-marker");
    await expect(getBoss()).resolves.toBe(second);

    expect(mocks.createBoss).toHaveBeenCalledTimes(2);
    expect(mocks.startBoss).toHaveBeenCalledTimes(2);
    expect(first.stop).toHaveBeenCalledWith({ graceful: false });
  });

  it("attaches a stable error listener before startup without reading the error", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const boss = new FakeBoss();
    mocks.createBoss.mockReturnValueOnce(boss);
    mocks.startBoss.mockImplementationOnce(async () => {
      expect(boss.listenerCount("error")).toBeGreaterThan(0);
    });
    const { getBoss } = await import("./boss.ts");
    await getBoss();
    let prototypeReads = 0;
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          prototypeReads += 1;
          throw new Error("hostile-boss-error-marker");
        },
      },
    );

    expect(() => boss.emit("error", hostile)).not.toThrow();
    expect(prototypeReads).toBe(0);
    const logged = stderr.mock.calls.map(([line]) => String(line)).join("");
    expect(logged).toContain('"event":"pgboss_error"');
    expect(logged).toContain('"code":"PGBOSS_RUNTIME_ERROR"');
    expect(logged).not.toContain("hostile-boss-error-marker");
  });

  it("continues to share one successfully started boss", async () => {
    const boss = new FakeBoss();
    mocks.createBoss.mockReturnValueOnce(boss);
    mocks.startBoss.mockResolvedValueOnce(undefined);
    const { getBoss } = await import("./boss.ts");

    await expect(Promise.all([getBoss(), getBoss()])).resolves.toEqual([
      boss,
      boss,
    ]);
    expect(mocks.createBoss).toHaveBeenCalledTimes(1);
    expect(mocks.startBoss).toHaveBeenCalledTimes(1);
  });
});
