import { getCjSettingsSummary } from "@/lib/suppliers/cj";

const summary = await getCjSettingsSummary();
console.log(JSON.stringify(summary, null, 2));
if (!summary) process.exitCode = 1;
