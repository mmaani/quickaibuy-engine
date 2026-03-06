import fs from "node:fs";

const p = JSON.parse(fs.readFileSync("package.json", "utf8"));

p.scripts ||= {};
p.scripts["db:generate"] ||= "drizzle-kit generate";
p.scripts["db:migrate"] ||= "drizzle-kit migrate";
p.scripts["db:push"] ||= "drizzle-kit push";

fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
console.log("✅ Patched package.json scripts:", ["db:generate","db:migrate","db:push"]);
