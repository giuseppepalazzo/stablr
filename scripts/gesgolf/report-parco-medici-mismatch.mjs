import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { REPORTS_DIR, repoRoot } from "./shared.mjs";

const FIG_PATH = path.join(repoRoot, "data", "fig", "normalized", "parco-de-medici-example.json");
const GES_PATH = path.join(
  repoRoot,
  "data",
  "gesgolf",
  "normalized",
  "asd-golf-club-parco-de-medici",
  "circolo-112.json"
);

const OUTPUT_JSON = path.join(REPORTS_DIR, "parco-de-medici-gesgolf-mismatch.json");
const OUTPUT_MD = path.join(REPORTS_DIR, "parco-de-medici-gesgolf-mismatch.md");

const ROUTE_MAPPING = [
  { ges: "9 Buche Bianco", fig: "Bianco", relation: "direct_route" },
  { ges: "9 Buche Blu", fig: "Blu", relation: "direct_route" },
  { ges: "BIANCO X 2", fig: "9 Buche Bianco 2 Volte", relation: "repeat_route" },
  { ges: "BLU X2", fig: "9 Buche Blu 2 Volte", relation: "repeat_route" },
  { ges: "R-R", fig: "Est (Rosso x 2)", relation: "repeat_route" },
  { ges: "W-BL", fig: "Championship Bianco/Blu", relation: "combination" },
  { ges: "BL-W", fig: "Blu/Bianco (Champ. Invertito)", relation: "combination" },
  { ges: "BL-R", fig: "King Blu/Rosso", relation: "combination" },
  { ges: "W-R", fig: "Queen Bianco/Rosso", relation: "combination" },
  { ges: "Est V-A", fig: "Blu/Bianco (Champ. Invertito)", relation: "alias_candidate" }
];

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&#039;|&#39;/gi, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function teeKey(tee) {
  return `${String(tee.tee_name || "").toLowerCase()}::${String(tee.gender || tee.gender_group || "").toLowerCase()}`;
}

function buildFigIndex(fig) {
  const index = new Map();
  [...fig.routes, ...fig.route_combinations].forEach((route) => {
    index.set(route.name, route);
  });
  return index;
}

function buildGesIndex(ges) {
  const index = new Map();
  ges.playable_courses.forEach((route) => {
    index.set(route.name, route);
  });
  return index;
}

function compareHoles(figRoute, gesRoute) {
  const figHoles = figRoute.holes || [];
  const gesHoles = gesRoute.holes || [];
  const length = Math.max(figHoles.length, gesHoles.length);
  const differences = [];

  for (let index = 0; index < length; index += 1) {
    const figHole = figHoles[index];
    const gesHole = gesHoles[index];

    if (!figHole || !gesHole) {
      differences.push({
        sequence: index + 1,
        type: "missing_hole",
        fig: figHole || null,
        ges: gesHole || null
      });
      continue;
    }

    if (figHole.par !== gesHole.par) {
      differences.push({
        sequence: index + 1,
        type: "par",
        fig: figHole.par,
        ges: gesHole.par
      });
    }

    if (figHole.stroke_index !== gesHole.hcp) {
      differences.push({
        sequence: index + 1,
        type: "stroke_index",
        fig: figHole.stroke_index,
        ges: gesHole.hcp
      });
    }
  }

  return {
    par_match: !differences.some((entry) => entry.type === "par" || entry.type === "missing_hole"),
    stroke_index_match: !differences.some((entry) => entry.type === "stroke_index" || entry.type === "missing_hole"),
    differences
  };
}

function compareTees(figRoute, gesRoute) {
  const figTees = new Map((figRoute.tees || []).map((tee) => [teeKey(tee), tee]));
  const gesTees = new Map(
    (gesRoute.tee_sets || [])
      .filter((tee) => tee.course_rating != null || tee.slope_rating != null)
      .map((tee) => [teeKey(tee), tee])
  );

  const sharedKeys = [...figTees.keys()].filter((key) => gesTees.has(key));
  const differences = [];

  sharedKeys.forEach((key) => {
    const figTee = figTees.get(key);
    const gesTee = gesTees.get(key);

    if (figTee.course_rating !== gesTee.course_rating) {
      differences.push({
        tee: figTee.tee_name,
        gender: figTee.gender || figTee.gender_group || null,
        type: "course_rating",
        fig: figTee.course_rating,
        ges: gesTee.course_rating
      });
    }

    if (figTee.slope_rating !== gesTee.slope_rating) {
      differences.push({
        tee: figTee.tee_name,
        gender: figTee.gender || figTee.gender_group || null,
        type: "slope_rating",
        fig: figTee.slope_rating,
        ges: gesTee.slope_rating
      });
    }
  });

  return {
    shared_tees: sharedKeys.length,
    exact_match: differences.length === 0,
    differences
  };
}

function buildInventorySummary(fig, ges) {
  const figNames = new Set([...fig.routes, ...fig.route_combinations].map((route) => route.name));
  const mappedFigNames = new Set(ROUTE_MAPPING.map((entry) => entry.fig));
  const gesNames = new Set(ges.playable_courses.map((route) => route.name));
  const mappedGesNames = new Set(ROUTE_MAPPING.map((entry) => entry.ges));

  return {
    fig_total_units: figNames.size,
    ges_total_units: gesNames.size,
    mapped_units: ROUTE_MAPPING.length,
    fig_not_mapped: [...figNames].filter((name) => !mappedFigNames.has(name)).sort((a, b) => a.localeCompare(b, "it")),
    ges_not_mapped: [...gesNames].filter((name) => !mappedGesNames.has(name)).sort((a, b) => a.localeCompare(b, "it"))
  };
}

function detectGesAnomalies(ges) {
  return ges.playable_courses
    .map((route) => {
      const zeroParHoles = (route.holes || []).filter((hole) => hole.par === 0).length;
      const zeroHcpHoles = (route.holes || []).filter((hole) => hole.hcp === 0).length;
      const notes = [];

      if (route.holes_count === 18 && zeroParHoles >= 9) {
        notes.push("18 buche dichiarate ma seconda meta' vuota o azzerata");
      }

      if (route.holes_count === 18 && route.total_par != null && route.total_par <= 40) {
        notes.push("par totale anomalo per un 18 buche");
      }

      if (zeroHcpHoles >= 9) {
        notes.push("stroke index assente o azzerato su molte buche");
      }

      return notes.length
        ? {
            name: route.name,
            percorso_id: route.percorso_id,
            notes
          }
        : null;
    })
    .filter(Boolean);
}

function summarizeRoute(mapping, figIndex, gesIndex) {
  const figRoute = figIndex.get(mapping.fig);
  const gesRoute = gesIndex.get(mapping.ges);

  if (!figRoute || !gesRoute) {
    return {
      ...mapping,
      status: "missing_reference",
      fig_found: Boolean(figRoute),
      ges_found: Boolean(gesRoute)
    };
  }

  const holeComparison = compareHoles(figRoute, gesRoute);
  const teeComparison = compareTees(figRoute, gesRoute);
  const status = holeComparison.par_match && holeComparison.stroke_index_match && teeComparison.exact_match
    ? "match"
    : holeComparison.par_match && teeComparison.exact_match
      ? "par_ok_si_diff"
      : "mismatch";

  return {
    ...mapping,
    status,
    fig_holes_count: figRoute.holes_count,
    ges_holes_count: gesRoute.holes_count,
    fig_total_par: figRoute.total_par,
    ges_total_par: gesRoute.total_par,
    hole_comparison: holeComparison,
    tee_comparison: teeComparison
  };
}

function buildMarkdown(report) {
  const lines = [];

  lines.push("# Parco de' Medici: FIG vs GesGolf mismatch report");
  lines.push("");
  lines.push("Questo report e' solo di benchmark. Nessun dato live e' stato aggiornato.");
  lines.push("");
  lines.push("## Vincoli");
  lines.push("");
  lines.push("- Non toccare Mare di Roma.");
  lines.push("- Non toccare Parco de' Medici nel DB live.");
  lines.push("- GesGolf qui e' solo una fonte di confronto tecnico.");
  lines.push("");
  lines.push("## Club");
  lines.push("");
  lines.push(`- FIG: ${report.club.fig_name}`);
  lines.push(`- GesGolf: ${report.club.ges_name}`);
  lines.push(`- Normalized match: ${report.club.normalized_match ? "si" : "no"}`);
  lines.push("");
  lines.push("## Inventario");
  lines.push("");
  lines.push(`- Unita' FIG (routes + combinations): ${report.inventory.fig_total_units}`);
  lines.push(`- Unita' GesGolf: ${report.inventory.ges_total_units}`);
  lines.push(`- Mapping manuale usato nel benchmark: ${report.inventory.mapped_units}`);
  if (report.inventory.fig_not_mapped.length) {
    lines.push(`- FIG non mappati: ${report.inventory.fig_not_mapped.join(", ")}`);
  }
  if (report.inventory.ges_not_mapped.length) {
    lines.push(`- GesGolf non mappati: ${report.inventory.ges_not_mapped.join(", ")}`);
  }
  lines.push("");
  lines.push("## Failed routes GesGolf");
  lines.push("");
  if (report.failed_routes.length) {
    report.failed_routes.forEach((entry) => {
      lines.push(`- ${entry.name} (${entry.percorso_id}): ${entry.error}`);
    });
  } else {
    lines.push("- Nessuno");
  }
  lines.push("");
  lines.push("## Anomalie GesGolf");
  lines.push("");
  if (report.ges_anomalies.length) {
    report.ges_anomalies.forEach((entry) => {
      lines.push(`- ${entry.name} (${entry.percorso_id}): ${entry.notes.join("; ")}`);
    });
  } else {
    lines.push("- Nessuna anomalia rilevata nel benchmark.");
  }
  lines.push("");
  lines.push("## Confronti mappati");
  lines.push("");

  report.route_reports.forEach((entry) => {
    lines.push(`### ${entry.ges} -> ${entry.fig}`);
    lines.push("");
    lines.push(`- Relazione: ${entry.relation}`);
    lines.push(`- Stato: ${entry.status}`);
    if (entry.status !== "missing_reference") {
      lines.push(`- Par totale: FIG ${entry.fig_total_par} / GesGolf ${entry.ges_total_par}`);
      lines.push(`- Buche: FIG ${entry.fig_holes_count} / GesGolf ${entry.ges_holes_count}`);
      lines.push(`- Match par hole-by-hole: ${entry.hole_comparison.par_match ? "si" : "no"}`);
      lines.push(`- Match Stroke Index hole-by-hole: ${entry.hole_comparison.stroke_index_match ? "si" : "no"}`);
      lines.push(`- Match CR/SR tee condivisi: ${entry.tee_comparison.exact_match ? "si" : "no"}`);

      const siDiffs = entry.hole_comparison.differences.filter((diff) => diff.type === "stroke_index");
      const parDiffs = entry.hole_comparison.differences.filter((diff) => diff.type === "par");

      if (parDiffs.length) {
        lines.push(`- Differenze par: ${parDiffs.map((diff) => `#${diff.sequence} FIG ${diff.fig} / GES ${diff.ges}`).join("; ")}`);
      }
      if (siDiffs.length) {
        lines.push(`- Differenze SI: ${siDiffs.map((diff) => `#${diff.sequence} FIG ${diff.fig} / GES ${diff.ges}`).join("; ")}`);
      }
      if (entry.tee_comparison.differences.length) {
        lines.push(
          `- Differenze CR/SR: ${entry.tee_comparison.differences.map((diff) => `${diff.tee} ${diff.gender || ""} ${diff.type} FIG ${diff.fig} / GES ${diff.ges}`).join("; ")}`
        );
      }
    }
    lines.push("");
  });

  lines.push("## Lettura rapida");
  lines.push("");
  lines.push("- Le basi 9 buche e i percorsi ripetuti risultano allineati molto bene.");
  lines.push("- Le combinazioni 18 buche confermano i par ufficiali, ma lo Stroke Index puo' divergere nella seconda meta'.");
  lines.push("- GesGolf espone anche percorsi/alias extra che vanno normalizzati prima di qualunque import.");
  lines.push("- Il percorso GesGolf `INTERNAZIONALI` oggi risponde con HTTP 500, quindi serve gestione robusta dei fallimenti nello scraper.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

async function main() {
  const [figRaw, gesRaw] = await Promise.all([
    readFile(FIG_PATH, "utf-8"),
    readFile(GES_PATH, "utf-8")
  ]);

  const fig = JSON.parse(figRaw);
  const ges = JSON.parse(gesRaw);

  const figIndex = buildFigIndex(fig);
  const gesIndex = buildGesIndex(ges);
  const routeReports = ROUTE_MAPPING.map((mapping) => summarizeRoute(mapping, figIndex, gesIndex));

  const report = {
    generated_at: new Date().toISOString(),
    benchmark_only: true,
    protected_live_clubs: ["Mare di Roma", "Parco de' Medici"],
    club: {
      fig_name: fig.club.name,
      ges_name: ges.club.name,
      fig_name_normalized: normalizeName(fig.club.name),
      ges_name_normalized: normalizeName(ges.club.name),
      normalized_match: normalizeName(ges.club.name).includes(normalizeName(fig.club.name))
    },
    inventory: buildInventorySummary(fig, ges),
    failed_routes: ges.failed_courses || [],
    ges_anomalies: detectGesAnomalies(ges),
    route_reports: routeReports
  };

  await mkdir(REPORTS_DIR, { recursive: true });
  await writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  await writeFile(OUTPUT_MD, buildMarkdown(report), "utf-8");

  console.log(`Saved JSON report to ${path.relative(repoRoot, OUTPUT_JSON)}`);
  console.log(`Saved Markdown report to ${path.relative(repoRoot, OUTPUT_MD)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
