import fs from "node:fs/promises";
import path from "node:path";
import { updateRepoTreeFile } from "./update_repo_tree.mjs";

const ROOT = process.cwd();
const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  ".turbo",
  ".vercel",
  "coverage",
  "dist",
]);
const POLL_MS = 1500;

async function collectSignature(absDir, relDir = "") {
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  const parts = [];

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (relPath === "repo_tree.txt") continue;

    const absPath = path.join(absDir, entry.name);
    const stat = await fs.stat(absPath);
    parts.push(`${relPath}:${Math.floor(stat.mtimeMs)}:${stat.size}`);

    if (entry.isDirectory()) {
      const child = await collectSignature(absPath, relPath);
      parts.push(child);
    }
  }

  return parts.sort().join("|");
}

async function runWatcher() {
  await updateRepoTreeFile();
  console.log("watching for changes -> repo_tree.txt");

  let previous = await collectSignature(ROOT);
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const next = await collectSignature(ROOT);
    if (next !== previous) {
      previous = next;
      const result = await updateRepoTreeFile();
      if (result.changed) {
        console.log(`[${new Date().toISOString()}] repo_tree.txt updated`);
      }
    }
  }
}

runWatcher().catch((error) => {
  console.error("repo tree watcher failed", error);
  process.exit(1);
});
