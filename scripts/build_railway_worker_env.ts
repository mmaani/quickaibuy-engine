import { buildWorkerEnvCandidate } from "./lib/railwayWorkerEnv";

function getArgValue(flag: string): string | null {
  const args = process.argv.slice(2);
  const index = args.findIndex((arg) => arg === flag);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function parseSources(): string[] {
  const raw = getArgValue("--from");
  if (!raw) return [".env.local", ".env.vercel"];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseOutput(): string {
  return getArgValue("--out")?.trim() || "railway_worker.env";
}

function main() {
  const result = buildWorkerEnvCandidate({
    sources: parseSources(),
    outputPath: parseOutput(),
  });

  console.log(
    JSON.stringify(
      {
        status: "OK",
        outputPath: result.outputPath,
        selectedKeyCount: result.selectedKeys.length,
        selectedKeys: result.selectedKeys,
        missingRequiredGroups: result.missingRequiredGroups,
      },
      null,
      2
    )
  );
}

main();
