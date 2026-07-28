#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  listOrderedMigrationSources,
  renderAuthoritySchema,
} from "../../../scripts/spec-authority-lib.mjs";

const authorityRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = resolve(authorityRoot, "../..");
const migrations = listOrderedMigrationSources({ root: repositoryRoot });
const output = resolve(authorityRoot, "schema.sql");

writeFileSync(output, renderAuthoritySchema(migrations));
console.log(
  `Generated ${output} from ${migrations.length} ordered migrations (${migrations[0].name} through ${migrations.at(-1).name}).`,
);
