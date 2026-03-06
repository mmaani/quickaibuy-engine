import dotenv from "dotenv";

// Load local env files for terminal runs (Codespaces/dev)
// On Vercel/hosted, process.env is already injected, so this is harmless.
dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  // IMPORTANT: dynamic import so dotenv runs BEFORE other modules read process.env
  await import("./engine.worker");
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
