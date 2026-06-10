import { getArgValue } from "./shared.mjs";
import { scrapeGesGolfClub, slugify } from "./scrape-club-lib.mjs";

async function main() {
  const circoloId = getArgValue("--circolo-id", "112");
  const slug = getArgValue("--slug", null);
  const result = await scrapeGesGolfClub({
    circoloId,
    slug,
    sourceLabel: "Benchmark scraper output. Do not upsert into live DB automatically."
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        ...result
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
