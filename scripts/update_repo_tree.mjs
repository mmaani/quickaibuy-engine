import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_FILE = "repo_tree.txt";
const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  ".turbo",
  ".vercel",
  "coverage",
  "dist",
]);

async function readDirSorted(absDir) {
  const dirents = await fs.readdir(absDir, { withFileTypes: true });
  return dirents
    .filter((entry) => !IGNORED_DIRS.has(entry.name))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });
}

async function buildTreeLines(absDir, prefix = "") {
  const entries = await readDirSorted(absDir);
  const lines = [];

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const isLast = index === entries.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = `${prefix}${isLast ? "    " : "│   "}`;
    lines.push(`${prefix}${connector}${entry.name}`);

    if (entry.isDirectory()) {
      const childLines = await buildTreeLines(path.join(absDir, entry.name), childPrefix);
      lines.push(...childLines);
    }
  }

  return lines;
}

export async function generateRepoTreeText() {
  const lines = await buildTreeLines(ROOT);
  return [".", ...lines, ""].join("\n");
}

export async function updateRepoTreeFile() {
  const nextText = await generateRepoTreeText();
  let currentText = "";
  try {
    currentText = await fs.readFile(path.join(ROOT, OUTPUT_FILE), "utf8");
  } catch {
    // file may not exist yet
  }

  if (currentText !== nextText) {
    await fs.writeFile(path.join(ROOT, OUTPUT_FILE), nextText, "utf8");
    return { changed: true };
  }

  return { changed: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await updateRepoTreeFile();
  console.log(result.changed ? "repo_tree.txt updated." : "repo_tree.txt already up to date.");
}
