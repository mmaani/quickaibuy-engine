import { loadRuntimeEnv } from "@/lib/runtimeEnv";

loadRuntimeEnv();

async function main() {
  // IMPORTANT: dynamic import so dotenv runs BEFORE other modules read process.env
  await import("./engine.worker");
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
