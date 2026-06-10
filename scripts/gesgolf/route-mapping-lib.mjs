import path from "node:path";

import { FIG_CATALOG_PATH, REPORTS_DIR, repoRoot } from "./shared.mjs";

export const ROUTE_MAPPINGS_DIR = path.join(repoRoot, "data", "gesgolf", "mappings");
export const ROUTE_MAPPINGS_TEMPLATE_JSON = path.join(ROUTE_MAPPINGS_DIR, "route-mapping-template.json");
export const ROUTE_MAPPINGS_TEMPLATE_CSV = path.join(ROUTE_MAPPINGS_DIR, "route-mapping-template.csv");
export const MANUAL_ROUTE_MAPPINGS_PATH = path.join(ROUTE_MAPPINGS_DIR, "manual-route-mappings.json");
export const BATCH_REPORT_PATH = path.join(REPORTS_DIR, "gesgolf-scrape-batch.json");

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function scoreRouteCandidate(gesRoute, figCourse) {
  const gesName = normalize(gesRoute.name);
  const figName = normalize(figCourse.name);

  let score = 0;
  const reasons = [];

  if (Number(gesRoute.holes_count) === Number(figCourse.holes_count)) {
    score += 20;
    reasons.push("same_holes_count");
  }

  if (Number(gesRoute.total_par) === Number(figCourse.total_par)) {
    score += 20;
    reasons.push("same_total_par");
  }

  if (gesName === figName) {
    score += 45;
    reasons.push("exact_name");
  } else if (gesName.includes(figName) || figName.includes(gesName)) {
    score += 28;
    reasons.push("name_contains");
  } else {
    const gesTokens = gesName.split(" ").filter(Boolean);
    const figTokens = figName.split(" ").filter(Boolean);
    const shared = gesTokens.filter((token) => figTokens.includes(token));
    if (shared.length) {
      score += Math.min(20, shared.length * 6);
      reasons.push(`shared_tokens:${shared.join("|")}`);
    }
  }

  if (
    (gesName.includes("x 2") || gesName.includes("x2") || gesName.includes("2 volte")) &&
    (figName.includes("x 2") || figName.includes("x2") || figName.includes("2 volte"))
  ) {
    score += 10;
    reasons.push("repeat_hint");
  }

  if ((gesName.includes("-") || gesName.includes("/")) && figCourse.course_type === "combination_18") {
    score += 10;
    reasons.push("combination_hint");
  }

  return { score, reasons };
}

export function rankRouteCandidates(gesRoute, figCourses) {
  return figCourses
    .map((figCourse) => {
      const { score, reasons } = scoreRouteCandidate(gesRoute, figCourse);
      return {
        fig_course_name: figCourse.name,
        fig_source_external_id: figCourse.source_external_id,
        fig_holes_count: figCourse.holes_count,
        fig_total_par: figCourse.total_par,
        fig_course_type: figCourse.course_type,
        fig_route_family: figCourse.route_family,
        score,
        reasons
      };
    })
    .sort((left, right) => right.score - left.score || left.fig_course_name.localeCompare(right.fig_course_name, "it"));
}

export function buildSuggestedRelation(gesRoute, candidate) {
  if (!candidate) return "review_needed";
  if (gesRoute.holes_count === 9 && candidate.fig_holes_count === 9) return "base_route";
  if (
    normalize(gesRoute.name).includes("x 2") ||
    normalize(gesRoute.name).includes("x2") ||
    normalize(gesRoute.name).includes("2 volte")
  ) {
    return "repeat_route";
  }
  if (candidate.fig_course_type === "combination_18") return "combination_route";
  return "playable_course";
}

export function summarizeMappingConfidence(score) {
  if (score >= 80) return "high";
  if (score >= 55) return "medium";
  if (score > 0) return "low";
  return "none";
}

export async function loadJson(filePath) {
  const text = await import("node:fs/promises").then((fs) => fs.readFile(filePath, "utf-8"));
  return JSON.parse(text);
}

export function buildManualRouteMappingIndex(payload) {
  const index = new Map();
  for (const club of payload?.clubs || []) {
    for (const route of club.routes || []) {
      index.set(`${club.circolo_id}::${normalize(route.ges_route_name)}`, {
        fig_club: club.fig_club,
        fig_course_name: route.fig_course_name,
        relation: route.relation,
        confidence: route.confidence
      });
    }
  }
  return index;
}

export function buildMappingRows({ batchReport, figCatalog, protectedClubs }) {
  const clubs = figCatalog.clubs || [];
  const figByName = new Map(clubs.map((club) => [club.name, club]));
  const rows = [];

  batchReport.results.forEach((batchRow) => {
    if (batchRow.action !== "scraped") return;
    const figClub = figByName.get(batchRow.fig_club);
    if (!figClub) return;

    rows.push({
      type: "club_header",
      fig_club: batchRow.fig_club,
      gesgolf_club: batchRow.gesgolf_club,
      circolo_id: batchRow.circolo_id,
      protected_live: protectedClubs.has(normalize(batchRow.fig_club)),
      scrape_status: batchRow.scrape_status,
      mapping_status: "pending"
    });
  });

  return rows;
}
