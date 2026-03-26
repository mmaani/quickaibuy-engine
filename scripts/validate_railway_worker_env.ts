import path from "path";
import { parseEnvFile, validateWorkerEnv } from "./lib/railwayWorkerEnv";

function main() {
  const target = process.argv[2] ?? "railway_worker.env";
  const filePath = path.resolve(target);
  const parsed = parseEnvFile(filePath);
  const result = validateWorkerEnv(parsed);

  console.log(
    JSON.stringify(
      {
        status: result.ok ? "OK" : "FAILED",
        filePath,
        issueCount: result.issues.length,
        issues: result.issues,
      },
      null,
      2
    )
  );

  process.exit(result.ok ? 0 : 1);
}

main();
