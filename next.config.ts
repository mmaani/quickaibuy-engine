import type { NextConfig } from "next";

const originalEmitWarning = process.emitWarning.bind(process);

process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const warningCode =
    typeof args[1] === "string"
      ? args[1]
      : typeof args[0] === "object" && args[0] !== null && "code" in args[0]
        ? String((args[0] as { code?: unknown }).code ?? "")
        : "";
  const warningMessage =
    typeof warning === "string"
      ? warning
      : warning instanceof Error
        ? warning.message
        : String(warning ?? "");

  // Next.js 16 still emits DEP0169 from its own server internals in dev/dashboard flows.
  if (warningCode === "DEP0169" || warningMessage.includes("`url.parse()` behavior is not standardized")) {
    return;
  }

  return originalEmitWarning(warning, ...(args as [type?: string, code?: string]));
}) as typeof process.emitWarning;

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
