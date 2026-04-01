import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ts from "typescript";

type FileStatus = "OK" | "FAILED" | "SKIPPED";

type FileCheckResult = {
  file: string;
  kind: string;
  status: FileStatus;
  reason?: string;
};

type TypecheckSummary = {
  status: FileStatus;
  reason: string;
};

const execFileAsync = promisify(execFile);
const SCRIPTS_DIR = path.resolve("scripts");
const TSC_PATH = path.resolve("node_modules/typescript/lib/tsc.js");

function shorten(text: string, limit = 240): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 3)}...`;
}

function formatCommandFailure(error: unknown, fallback: string): string {
  if (!error || typeof error !== "object") return fallback;
  const pieces: string[] = [];
  if ("code" in error && error.code != null) pieces.push(`code=${String(error.code)}`);
  if ("signal" in error && error.signal != null) pieces.push(`signal=${String(error.signal)}`);
  if ("stderr" in error && typeof error.stderr === "string" && error.stderr.trim()) pieces.push(shorten(error.stderr));
  if ("stdout" in error && typeof error.stdout === "string" && error.stdout.trim()) pieces.push(shorten(error.stdout));
  if ("message" in error && typeof error.message === "string" && error.message.trim()) pieces.push(shorten(error.message));
  return pieces[0] ? pieces.join(" | ") : fallback;
}

async function listTopLevelFiles(): Promise<string[]> {
  const entries = await fs.readdir(SCRIPTS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.resolve(SCRIPTS_DIR, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function checkShellScript(file: string): Promise<FileCheckResult> {
  try {
    await execFileAsync("bash", ["-n", file]);
    return { file, kind: "shell", status: "OK" };
  } catch (error) {
    return {
      file,
      kind: "shell",
      status: "FAILED",
      reason: formatCommandFailure(error, "bash -n failed"),
    };
  }
}

async function checkNodeModule(file: string): Promise<FileCheckResult> {
  try {
    await execFileAsync("node", ["--check", file]);
    return { file, kind: "node-module", status: "OK" };
  } catch (error) {
    return {
      file,
      kind: "node-module",
      status: "FAILED",
      reason: formatCommandFailure(error, "node --check failed"),
    };
  }
}

async function checkPythonFile(file: string): Promise<FileCheckResult> {
  try {
    await execFileAsync("python3", [
      "-c",
      [
        "import ast",
        "import pathlib",
        "import sys",
        "source = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')",
        "ast.parse(source, filename=sys.argv[1])",
      ].join("; "),
      file,
    ]);
    return { file, kind: "python", status: "OK" };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code ?? "") : "";
    if (code === "ENOENT") {
      return {
        file,
        kind: "python",
        status: "SKIPPED",
        reason: "python3 is not installed in this environment",
      };
    }

    return {
      file,
      kind: "python",
      status: "FAILED",
      reason: formatCommandFailure(error, "python3 AST syntax parse failed"),
    };
  }
}

async function checkTypeScriptSyntax(file: string): Promise<FileCheckResult> {
  const source = await fs.readFile(file, "utf8");
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const diagnostics = result.diagnostics ?? [];
  if (diagnostics.length === 0) {
    return { file, kind: "typescript-syntax", status: "OK" };
  }

  const detail = diagnostics
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "))
    .join(" | ");
  return {
    file,
    kind: "typescript-syntax",
    status: "FAILED",
    reason: shorten(detail),
  };
}

async function runRepoTypecheck(): Promise<TypecheckSummary> {
  try {
    await execFileAsync(process.execPath, [TSC_PATH, "--noEmit", "--pretty", "false"], {
      cwd: path.resolve("."),
      maxBuffer: 1024 * 1024 * 8,
    });
    return {
      status: "OK",
      reason: "Repository TypeScript typecheck passed",
    };
  } catch (error) {
    return {
      status: "FAILED",
      reason: formatCommandFailure(error, "TypeScript typecheck failed"),
    };
  }
}

async function checkFile(file: string): Promise<FileCheckResult> {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".sh") return checkShellScript(file);
  if (ext === ".mjs") return checkNodeModule(file);
  if (ext === ".py") return checkPythonFile(file);
  if (ext === ".ts") return checkTypeScriptSyntax(file);
  return {
    file,
    kind: "unsupported",
    status: "SKIPPED",
    reason: `No checker configured for ${ext || "extensionless"} files`,
  };
}

async function main() {
  const files = await listTopLevelFiles();
  const fileResults: FileCheckResult[] = [];

  for (const file of files) {
    fileResults.push(await checkFile(file));
  }

  const typecheck = await runRepoTypecheck();
  const failures = fileResults.filter((result) => result.status === "FAILED");
  const skipped = fileResults.filter((result) => result.status === "SKIPPED");
  const status: FileStatus = failures.length === 0 && typecheck.status !== "FAILED" ? "OK" : "FAILED";

  console.log(
    JSON.stringify(
      {
        title: "scripts catalog validation",
        status,
        totals: {
          files: fileResults.length,
          ok: fileResults.filter((result) => result.status === "OK").length,
          failed: failures.length,
          skipped: skipped.length,
        },
        typecheck,
        failures,
        skipped,
      },
      null,
      2
    )
  );

  process.exit(status === "OK" ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
