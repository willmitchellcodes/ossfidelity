#!/usr/bin/env node
// One-time check that a GitHub App token can read public repositories it isn't installed on.
// Usage: node proxy/check-token.mjs <client ID> <path to the App's .pem file>
// It uses the Worker's own signing code, so a pass here means the deployed Worker will sign too.
import { readFileSync } from "node:fs";
import { installationToken } from "./worker.js";

const [clientId, keyPath] = process.argv.slice(2);
if (!clientId || !keyPath) {
  console.error("Usage: node proxy/check-token.mjs <client ID> <path to .pem>");
  process.exit(2);
}
const token = await installationToken({ GITHUB_APP_CLIENT_ID: clientId, GITHUB_APP_PRIVATE_KEY: readFileSync(keyPath, "utf8") });
const get = (path) => fetch(`https://api.github.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "ossfidelity-check" } });

const repo = await get("/repos/llvm/llvm-project");
const limit = (await (await get("/rate_limit")).json())?.resources?.core?.limit;
console.log(`Token created: yes`);
console.log(`Reads a public repository it isn't installed on (llvm/llvm-project): ${repo.ok ? "yes" : `NO (HTTP ${repo.status})`}`);
console.log(`Requests per hour: ${limit ?? "unknown"}`);
process.exit(repo.ok ? 0 : 1);
