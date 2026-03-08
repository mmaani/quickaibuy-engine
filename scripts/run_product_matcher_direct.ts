import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const limitArg = Number(process.argv[2] || "20");
  const productRawIdArg = process.argv[3] || undefined;

  const { runEbayMatches } = await import("@/lib/matches/ebayMatchEngine");

  const result = await runEbayMatches({
    limit: limitArg,
    productRawId: productRawIdArg,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});