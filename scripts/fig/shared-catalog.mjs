import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);
export const projectRoot = path.resolve(__dirname, "..", "..");

export const FIG_SOURCE_URL =
  "https://www.federgolf.it/attivita-agonistica/servizi-online/tabella-slope-course-rating/";
export const FIG_IFRAME_SOURCE_URL =
  "https://areariservata.federgolf.it/SlopeAndCourseRating/Index";

export const FIG_TEE_COLUMN_ORDER = [
  { tee_name: "Nero", tee_color: "black", default_gender: "men" },
  { tee_name: "Bianco", tee_color: "white", default_gender: "men" },
  { tee_name: "Giallo", tee_color: "yellow", default_gender: "men" },
  { tee_name: "Verde", tee_color: "green", default_gender: "men" },
  { tee_name: "Blu", tee_color: "blue", default_gender: "men" },
  { tee_name: "Rosso", tee_color: "red", default_gender: "women" },
  { tee_name: "Arancio", tee_color: "orange", default_gender: "women" }
];

export function resolveProjectPath(filePath) {
  return path.resolve(projectRoot, filePath);
}

export async function ensureDirectoryForFile(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function writeJsonFile(filePath, data) {
  const absolutePath = resolveProjectPath(filePath);
  await ensureDirectoryForFile(absolutePath);
  await fs.writeFile(absolutePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return absolutePath;
}

export async function readJsonFile(filePath) {
  const absolutePath = resolveProjectPath(filePath);
  const contents = await fs.readFile(absolutePath, "utf8");
  return {
    absolutePath,
    data: JSON.parse(contents)
  };
}

export async function readTextFile(filePath) {
  const absolutePath = resolveProjectPath(filePath);
  const contents = await fs.readFile(absolutePath, "utf8");
  return {
    absolutePath,
    data: contents
  };
}

export function stripHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeWhitespace(value) {
  return stripHtml(value).replace(/\s+/g, " ").trim();
}

export function normalizeClubName(value) {
  return normalizeWhitespace(value)
    .replace(/’/g, "'")
    .replace(/\bde'\b/gi, "De'")
    .replace(/\b([A-ZÀ-ÖØ-Þ']+)\b/g, (match) => {
      if (match.includes("'")) {
        return match
          .split("'")
          .map((part) => (part ? `${part.charAt(0)}${part.slice(1).toLowerCase()}` : ""))
          .join("'");
      }
      return `${match.charAt(0)}${match.slice(1).toLowerCase()}`;
    });
}

export function normalizeNameForMatch(value) {
  return normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

export function slugify(value) {
  return normalizeNameForMatch(value).replace(/\s+/g, "-");
}

export function parseFigNumber(value) {
  const normalized = String(value || "")
    .replace(",", ".")
    .replace(/[^0-9.]/g, "")
    .trim();
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseFigInteger(value) {
  const normalized = String(value || "").replace(/[^0-9]/g, "").trim();
  if (!normalized) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function inferCourseType(name, holesCount) {
  const normalized = normalizeNameForMatch(name);
  if (holesCount === 9) return "single_9";
  if (normalized.includes("/") || normalized.includes("champ") || normalized.includes("king") || normalized.includes("queen")) {
    return "combination_18";
  }
  if (normalized.includes("2 volte") || normalized.includes("x 2") || normalized.includes("x2")) {
    return "repeat_9";
  }
  return holesCount === 18 ? "other_18" : "single_18";
}

export function inferRouteFamily(courseType) {
  if (courseType === "single_9" || courseType === "single_18") return "base";
  if (courseType === "combination_18") return "official";
  return "optional";
}

export function extractRouteNamesFromCourseName(name) {
  const normalized = normalizeWhitespace(name);
  const slashParts = normalized.split("/").map((part) => normalizeWhitespace(part)).filter(Boolean);
  if (slashParts.length >= 2) {
    return slashParts.map((part) =>
      part
        .replace(/\(.*?\)/g, "")
        .replace(/\bchampionship\b/gi, "")
        .replace(/\bchamp\b/gi, "")
        .replace(/\bking\b/gi, "")
        .replace(/\bqueen\b/gi, "")
        .replace(/\b2020\b/g, "")
        .trim()
    ).filter(Boolean);
  }

  const repeatMatch = normalized.match(/\(([^)]+)\)/);
  if (repeatMatch) {
    const inside = normalizeWhitespace(repeatMatch[1]).replace(/\bx\s*2\b/gi, "").trim();
    if (inside) return [inside];
  }

  const explicitBase = normalized.match(/9\s*buche\s+(.+?)(?:\s+2\s+volte)?$/i);
  if (explicitBase) {
    return [normalizeWhitespace(explicitBase[1])];
  }

  return [];
}

export function buildCourseComposition(name, courseType) {
  const baseRoutes = extractRouteNamesFromCourseName(name);
  if (courseType === "combination_18") {
    return {
      kind: "combination",
      base_routes: baseRoutes,
      front_route_name: baseRoutes[0] || null,
      back_route_name: baseRoutes[1] || null
    };
  }

  if (courseType === "repeat_9") {
    return {
      kind: "repeat",
      base_routes: baseRoutes.slice(0, 1),
      repeat_count: 2
    };
  }

  return {
    kind: "single",
    base_routes: baseRoutes.slice(0, 1)
  };
}

export function validateFigCatalogPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Payload FIG catalog mancante o non valido.");
  }
  if (payload.schema_version !== "1.0") {
    throw new Error("schema_version deve essere '1.0'.");
  }
  if (!payload.import_batch || typeof payload.import_batch !== "object") {
    throw new Error("import_batch mancante.");
  }
  if (!Array.isArray(payload.clubs)) {
    throw new Error("clubs deve essere un array.");
  }
  payload.clubs.forEach((club, clubIndex) => {
    const prefix = `clubs[${clubIndex}]`;
    if (!club.source_external_id) throw new Error(`${prefix}.source_external_id mancante.`);
    if (!club.name) throw new Error(`${prefix}.name mancante.`);
    if (!club.name_normalized) throw new Error(`${prefix}.name_normalized mancante.`);
    if (!Array.isArray(club.playable_courses)) {
      throw new Error(`${prefix}.playable_courses deve essere un array.`);
    }
    club.playable_courses.forEach((course, courseIndex) => {
      const coursePrefix = `${prefix}.playable_courses[${courseIndex}]`;
      if (!course.source_external_id) throw new Error(`${coursePrefix}.source_external_id mancante.`);
      if (!course.name) throw new Error(`${coursePrefix}.name mancante.`);
      if (!course.name_normalized) throw new Error(`${coursePrefix}.name_normalized mancante.`);
      if (![9, 18].includes(Number(course.holes_count))) {
        throw new Error(`${coursePrefix}.holes_count deve essere 9 o 18.`);
      }
      if (!["single_9", "single_18", "repeat_9", "combination_18", "other_18"].includes(course.course_type)) {
        throw new Error(`${coursePrefix}.course_type non valido.`);
      }
      if (!["base", "official", "optional"].includes(course.route_family)) {
        throw new Error(`${coursePrefix}.route_family non valido.`);
      }
      if (!Array.isArray(course.tees)) {
        throw new Error(`${coursePrefix}.tees deve essere un array.`);
      }
    });
  });
  return true;
}
