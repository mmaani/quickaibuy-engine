import { getRuntimeDiagnostics } from "./lib/runtimeDiagnostics.mjs";

async function main() {
  const includeConnectivity = String(process.argv[2] ?? "").trim().toLowerCase() !== "--no-connectivity";
  const diagnostics = await getRuntimeDiagnostics({ includeConnectivity });
  console.log(JSON.stringify(diagnostics, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
