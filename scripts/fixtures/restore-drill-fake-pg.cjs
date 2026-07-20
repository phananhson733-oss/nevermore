#!/usr/bin/env node

/* eslint-disable @typescript-eslint/no-require-imports -- standalone no-extension fixture */

const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const tool = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const statePath = path.resolve(path.dirname(process.argv[1]), "../state.json");

function readState() {
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

function updateState(update) {
  const state = readState();
  update(state);
  fs.writeFileSync(statePath, JSON.stringify(state));
  return state;
}

function argumentAfter(flag) {
  return args[args.indexOf(flag) + 1];
}

function recordProcessBoundary() {
  const passfilePath = process.env.PGPASSFILE;
  let passfileMode = null;
  let passfileHashMatches = false;
  if (passfilePath) {
    try {
      const passfile = fs.readFileSync(passfilePath);
      passfileMode = fs.statSync(passfilePath).mode & 0o777;
      passfileHashMatches =
        createHash("sha256").update(passfile).digest("hex") ===
        readState().expectedPassfileHash;
    } catch {
      // The product test asserts these fields and reports an inaccessible file.
    }
  }

  updateState((state) => {
    state.observations.push({
      tool,
      envKeys: Object.keys(process.env).sort(),
      passfilePath: passfilePath ?? null,
      passfileMode,
      passfileHashMatches,
      hasPgPassword: Object.hasOwn(process.env, "PGPASSWORD"),
    });
  });
}

recordProcessBoundary();

const state = readState();
const commandIndex = args.indexOf("--command");
const command = commandIndex >= 0 ? args[commandIndex + 1] : "";
const failureMatches =
  state.failureTool === tool &&
  (state.failureWhen !== "checksum" || command.startsWith("copy ("));

if (failureMatches) {
  if (state.rawStderr) process.stderr.write(state.rawStderr);
  if (state.failureKind === "signal") {
    process.kill(process.pid, state.signal ?? "SIGTERM");
    setInterval(() => {}, 1_000);
  }
  process.exit(state.exitCode ?? 23);
}

if (tool === "pg_dump") {
  fs.writeFileSync(argumentAfter("--file"), "fake custom dump");
} else if (tool === "createdb") {
  updateState((next) => {
    next.exists = true;
  });
} else if (tool === "dropdb") {
  updateState((next) => {
    next.exists = false;
  });
} else if (tool === "pg_restore") {
  if (!fs.existsSync(args.at(-1))) process.exit(2);
} else if (tool === "psql" && commandIndex >= 0) {
  if (command.includes("from pg_database")) {
    process.stdout.write((readState().exists ? "yes" : "no") + "\t1\n");
  } else if (command.includes("count(*)::text")) {
    for (const match of command.matchAll(/select '([a-z_]+)' as key/g)) {
      process.stdout.write(match[1] + "\t0\n");
    }
  } else if (command.startsWith("copy (")) {
    process.stdout.write("stable canonical row\n");
  }
}
