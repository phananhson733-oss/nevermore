import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

type CgroupFile = "memory.max" | "cpu.max" | "pids.max";
interface RuntimeDependencies {
  readonly platform?: NodeJS.Platform;
  readonly read?: (name: CgroupFile) => string;
}

/** Production entrypoint must prove kernel-enforced cgroup v2 limits. Merely
 * setting NODE_ENV or a custom 'sandboxed' flag cannot satisfy this check. */
export function assertCitabilityRuntimeEnvelope(options: RuntimeDependencies = {}): { memoryBytes: number; cpuCores: number; maxProcesses: number } {
  if ((options.platform ?? process.platform) !== "linux") throw new Error("Renderer production runtime requires Linux cgroup v2 limits");
  const read = options.read ?? ((name: CgroupFile) => readFileSync(`/sys/fs/cgroup/${name}`, "utf8"));
  const integer = (text: string): number => {
    if (!/^[1-9]\d*$/.test(text.trim())) throw new Error("Renderer runtime limit is missing or unlimited");
    const value = Number(text.trim());
    if (!Number.isSafeInteger(value)) throw new Error("Renderer runtime limit is invalid");
    return value;
  };
  const memoryBytes = integer(read("memory.max"));
  const maxProcesses = integer(read("pids.max"));
  const cpu = read("cpu.max").trim().split(/\s+/);
  if (cpu.length !== 2) throw new Error("Renderer CPU limit is invalid");
  const cpuCores = integer(cpu[0]!) / integer(cpu[1]!);
  if (memoryBytes > 768 * 1024 * 1024 || maxProcesses > 128 || cpuCores > 1) throw new Error("Renderer runtime limits exceed the approved envelope");
  return { memoryBytes, cpuCores, maxProcesses };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(assertCitabilityRuntimeEnvelope())}\n`);
}
