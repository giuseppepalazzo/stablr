import { mkdir, readFile, writeFile } from "node:fs/promises";
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

const DEFAULT_JSON_OUTPUT = path.join(REPORTS_DIR, "fig-gesgolf-missing-review.json");
const DEFAULT_CSV_OUTPUT = path.join(REPORTS_DIR, "fig-gesgolf-missing-review.csv");

async function main() {
  const jsonOut = path.resolve(getArgValue("--json-out", DEFAULT_JSON_OUTPUT));
  const csvOut = path.resolve(getArgValue("--csv-out", DEFAULT_CSV_OUTPUT));
  const delayMs = Number(getArgValue("--delay-ms", "50"));
  const candidateLimit = Number(getArgValue("--candidate-limit", "5"));

  const coveragePath = path.resolve(
    getArgValue("--coverage-json", path.join(REPORTS_DIR, "fig-gesgolf-coverage.json"))
  );

  const coverage = JSON.parse(await readFile(coveragePath, "utf-8"));
  const missingNames = new Set(
    coverage.results
      .filter((row) => !row.match || row.match.score < 75)
      .map((row) => row.fig_club)
  );

  const allFigClubs = await loadFigClubs();
  const missingClubs = allFigClubs.filter((club) => missingNames.has(club.name));
  const pageState = await fetchClubsIndexPage();
  const results = [];

  for (let index = 0; index < missingClubs.length; index += 1) {
    const club = missingClubs[index];
    const queries = buildSearchQueries(club.name);
    const candidatesById = new Map();

    for (const query of queries) {
      const candidates = await searchGesGolfClub(query, pageState);
      const ranked = rankCandidates(club.name, candidates, query);

      for (const candidate of ranked) {
        const existing = candidatesById.get(candidate.circolo_id);
        if (!existing || candidate.score > existing.score) {
          candidatesById.set(candidate.circolo_id, candidate);
        }
      }

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    const topCandidates = [...candidatesById.values()]
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "it"))
      .slice(0, candidateLimit);

    results.push({
      fig_club: club.name,
      queries,
      review_status: topCandidates.length ? "weak_candidates_only" : "no_public_results",
      top_candidates: topCandidates
    });

    console.log(`Review progress ${index + 1}/${missingClubs.length}`);
  }

  const summary = {
    total_missing_from_first_sweep: results.length,
    no_public_results: results.filter((row) => row.review_status === "no_public_results").length,
    weak_candidates_only: results.filter((row) => row.review_status === "weak_candidates_only").length
  };

  const csvRows = results.map((row) => ({
    fig_club: row.fig_club,
    review_status: row.review_status,
    top_candidate_1: row.top_candidates[0]?.name || "",
    top_candidate_1_id: row.top_candidates[0]?.circolo_id || "",
    top_candidate_1_score: row.top_candidates[0]?.score || "",
    top_candidate_2: row.top_candidates[1]?.name || "",
    top_candidate_2_id: row.top_candidates[1]?.circolo_id || "",
    top_candidate_2_score: row.top_candidates[1]?.score || "",
    search_queries: row.queries.join(" | ")
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
          gesgolf_clubs_index_url: CLUBS_INDEX_URL,
          first_sweep_coverage_path: coveragePath
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
