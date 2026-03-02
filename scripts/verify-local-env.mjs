#!/usr/bin/env node

import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";

const requiredFiles = [
  "plugin/manifest.json",
  "plugin/package.json",
  "supabase/config.toml",
  "supabase/migrations/202603030001_initial_schema.sql",
];

const requiredEnv = [
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_PROJECT_ID",
];

async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function printCheck(label, ok, details = "") {
  const status = ok ? "OK" : "MISSING";
  const suffix = details ? `: ${details}` : "";
  console.log(`${status} ${label}${suffix}`);
}

function getSupabaseVersion() {
  const result = spawnSync("supabase", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    return null;
  }

  return (result.stdout || result.stderr).trim() || "installed";
}

async function main() {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  printCheck("Node.js >= 20", major >= 20, process.versions.node);

  for (const path of requiredFiles) {
    printCheck(path, await fileExists(path));
  }

  for (const name of requiredEnv) {
    printCheck(`env ${name}`, Boolean(process.env[name]));
  }

  const supabaseVersion = getSupabaseVersion();
  printCheck("Supabase CLI", Boolean(supabaseVersion), supabaseVersion ?? "not found in PATH");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
