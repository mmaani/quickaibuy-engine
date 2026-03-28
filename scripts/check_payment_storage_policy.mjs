#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOTS = [
  ".",
  "docs",
  "scripts",
  "seeds",
];

const SKIP_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  "coverage",
  "out",
  "build",
]);

const KEY_PATTERNS = [
  /\b(card[_ -]?number|payment[_ -]?card|cvv|cvc|exp_month|exp_year|expiry|expiration|billing[_ -]?zip)\s*[:=]\s*\S+/i,
];

function isLuhnCandidate(value) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }

  return sum % 10 === 0;
}

function scanFile(filePath, failures) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (KEY_PATTERNS.some((pattern) => pattern.test(line))) {
      failures.push(`${filePath}:${index + 1} contains a forbidden payment-data assignment`);
    }

    const digitMatches = line.match(/\b\d[\d -]{11,25}\d\b/g) ?? [];
    for (const match of digitMatches) {
      if (isLuhnCandidate(match)) {
        failures.push(`${filePath}:${index + 1} contains a card-like digit sequence`);
      }
    }
  });
}

function walk(targetPath, failures) {
  if (!fs.existsSync(targetPath)) return;
  const stat = fs.statSync(targetPath);

  if (stat.isDirectory()) {
    const base = path.basename(targetPath);
    if (SKIP_DIRS.has(base)) return;
    for (const entry of fs.readdirSync(targetPath)) {
      walk(path.join(targetPath, entry), failures);
    }
    return;
  }

  const base = path.basename(targetPath);
  const inAllowedRoot =
    base.startsWith(".env") ||
    targetPath.startsWith(`docs${path.sep}`) ||
    targetPath.startsWith(`scripts${path.sep}`) ||
    targetPath.startsWith(`seeds${path.sep}`);
  if (!inAllowedRoot) return;

  scanFile(targetPath, failures);
}

const failures = [];
for (const root of ROOTS) {
  walk(root, failures);
}

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
} else {
  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: [".env*", "docs", "scripts", "seeds"],
      },
      null,
      2
    )
  );
}
