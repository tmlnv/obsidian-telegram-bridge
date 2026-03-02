#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const requiredEnv = [
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_PROJECT_ID",
];

function getMissingEnv() {
  return requiredEnv.filter((name) => !process.env[name]);
}

function hasSupabaseCli() {
  const result = spawnSync("supabase", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return result.status === 0;
}

function main() {
  const missing = getMissingEnv();

  if (missing.length > 0) {
    console.error("Missing required environment variables:");
    for (const name of missing) {
      console.error(`- ${name}`);
    }
    process.exitCode = 1;
    return;
  }

  if (!hasSupabaseCli()) {
    console.error("Supabase CLI not found in PATH.");
    process.exitCode = 1;
    return;
  }

  const projectId = process.env.SUPABASE_PROJECT_ID;

  console.log("Bootstrap script scaffold is ready.");
  console.log("Run the following commands from the repository root:");
  console.log("");
  console.log(`supabase link --project-ref ${projectId}`);
  console.log("supabase db push");
  console.log("supabase functions deploy telegram-webhook");
  console.log("supabase functions deploy setup-bot");
  console.log("supabase secrets set SUPABASE_ANON_KEY=<value> SUPABASE_SERVICE_ROLE_KEY=<value>");
  console.log("");
  console.log("After deployment:");
  console.log("1. Install plugin dependencies with: npm install --prefix plugin");
  console.log("2. Build the plugin with: npm run build:plugin");
  console.log("3. Open Obsidian and complete bot setup in the plugin settings.");
}

main();
