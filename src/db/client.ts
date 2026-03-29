// Compatibility shim: app/server code should use @/lib/db as the canonical runtime DB path.
export { db, pool } from "@/lib/db";
