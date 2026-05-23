import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  REPORTS_DIR,
  FIG_CATALOG_PATH,
  CLUBS_INDEX_URL,
  buildCsv,
  buildSearchQueries,
  fetchClubsIndexPage,
  getArgValue,
  loadFigClubs,
  rankCandidates,
  searchGesGolfClub
} from "./shared.mjs";

const DEFAULT_JSON_OUTPUT = path.join(REPORTS_DIR, "fig-gesgolf-coverage.json");
const DEFAULT_CSV_OUTPUT = path.join(REPORTS_DIR, "fig-gesgolf-coverage.csv");

async function main() {
  const jsonOut = path.resolve(getArgValue("--json-out", DEFAULT_JSON_OUTPUT));
  const csvOut = path.resolve(getArgValue("--csv-out", DEFAULT_CSV_OUTPUT));
  const strongThreshold = Number(getArgValue("--strong-threshold", "90"));
  const delayMs = Number(getArgValue("--delay-ms", "50"));

  const clubs = await loadFigClubs();
  const pageState = await fetchClubsIndexPage();
  const results = [];

  for (let index = 0; index < clubs.length; index += 1) {
    const club = clubs[index];
    const queries = buildSearchQueries(club.name);
    let bestMatch = null;

    for (const query of queries) {
      const candidates = await searchGesGolfClub(query, pageState);
      const ranked = rankCandidates(club.name, candidates, query);

      if (ranked[0] && (!bestMatch || ranked[0].score > bestMatch.score)) {
        [bestMatch] = ranked;
      }

      if (bestMatch && bestMatch.score >= 96) {
        break;
      }

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    results.push({
      fig_club: club.name,
      fig_name_normalized: club.name_normalized,
      queries,
      match: bestMatch
    });

    if ((index + 1) % 25 === 0 || index === clubs.length - 1) {
      console.log(`Progress ${index + 1}/${clubs.length}`);
    }
  }

  const summary = {
    total_fig_clubs: results.length,
    present_in_gesgolf_strong: results.filter((row) => row.match && row.match.score >= strongThreshold).length,
    possible_match_below_threshold: results.filter(
      (row) => row.match && row.match.score >= 75 && row.match.score < strongThreshold
    ).length,
    not_found_or_weak_match: results.filter((row) => !row.match || row.match.score < 75).length,
    strong_threshold: strongThreshold
  };

  const csvRows = results.map((row) => ({
    fig_club: row.fig_club,
    gesgolf_club: row.match && row.match.score >= strongThreshold ? row.match.name : "",
    gesgolf_circolo_id: row.match && row.match.score >= strongThreshold ? row.match.circolo_id : "",
    match_score: row.match ? row.match.score : "",
    search_query: row.match ? row.match.query : row.queries[0] || ""
  }));

  await mkdir(path.dirname(jsonOut), { recursive: true });
  await mkdir(path.dirname(csvOut), { recursive: true });

  await writeFile(
    jsonOut,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        source: {
          fig_catalog_path: FIG_CATALOG_PATH,
          gesgolf_clubs_index_url: CLUBS_INDEX_URL
        },
        summary,
        results
      },
      null,
      2
    ),
    "utf-8"
  );

  await writeFile(csvOut, buildCsv(csvRows), "utf-8");

  console.log(JSON.stringify({ summary, jsonOut, csvOut }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
