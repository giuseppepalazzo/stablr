import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeGesGolfName, repoRoot } from "./shared.mjs";

const TEE_COLOR_MAP = {
  BIANCO: "white",
  GIALLO: "yellow",
  VERDE: "green",
  BLU: "blue",
  ROSSO: "red",
  ARANCIO: "orange"
};

const RAW_DIR = path.join(repoRoot, "data", "gesgolf", "raw");
const NORMALIZED_DIR = path.join(repoRoot, "data", "gesgolf", "normalized");

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#039;|&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&agrave;/gi, "à")
    .replace(/&egrave;/gi, "è")
    .replace(/&igrave;/gi, "ì")
    .replace(/&ograve;/gi, "ò")
    .replace(/&ugrave;/gi, "ù")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú")
    .replace(/&ccedil;/gi, "ç")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(value) {
  return normalizeGesGolfName(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function extractHiddenValue(html, fieldName) {
  const pattern = new RegExp(`name="${fieldName}" id="${fieldName}" value="([^"]*)"`, "i");
  const match = html.match(pattern);
  if (!match) {
    throw new Error(`Campo hidden non trovato: ${fieldName}`);
  }
  return match[1];
}

function extractClubName(html) {
  const match = html.match(/<h2 class="titolo arancio">([\s\S]*?)<\/h2>/i);
  if (!match) {
    throw new Error("Nome club GesGolf non trovato.");
  }
  return decodeHtml(match[1]);
}

function extractOptions(html) {
  return [...html.matchAll(/<option([^>]*)value="(\d+)">([\s\S]*?)<\/option>/gi)].map((match) => ({
    percorso_id: match[2],
    name: decodeHtml(match[3]),
    selected: /selected=/i.test(match[1])
  }));
}

function extractNumberById(html, id) {
  const match = html.match(new RegExp(`id="${id}">(.*?)<`, "i"));
  return match ? Number.parseInt(decodeHtml(match[1]), 10) : null;
}

function extractFirstTableAfterMarker(html, marker) {
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Marker non trovato: ${marker}`);
  }

  const tableStart = html.indexOf("<table", markerIndex);
  const tableEnd = html.indexOf("</table>", tableStart);

  if (tableStart === -1 || tableEnd === -1) {
    throw new Error(`Tabella non trovata dopo marker: ${marker}`);
  }

  return html.slice(tableStart, tableEnd + "</table>".length);
}

function extractAllRows(tableHtml) {
  return [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);
}

function extractCells(rowHtml, tagName = "td") {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  return [...rowHtml.matchAll(regex)].map((match) => decodeHtml(match[1]));
}

function toNullableInteger(value) {
  if (value == null) return null;
  const normalized = String(value).trim().replace(/\./g, "").replace(",", ".");
  if (!normalized || normalized === "-") return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function toNullableNumber(value) {
  if (value == null) return null;
  const normalized = String(value).trim().replace(/\./g, "").replace(",", ".");
  if (!normalized || normalized === "-") return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function inferPlayableKind(courseName, holesCount) {
  const name = normalizeGesGolfName(courseName);
  if (holesCount === 9) return "base_9";
  if (/x ?2|2 volte|x2/.test(name)) return "repeat_18";
  if (/-|\/| internazionali /.test(` ${name} `)) return "combination_18";
  return "official_18";
}

function parseHoleTable(tableHtml) {
  const rows = extractAllRows(tableHtml);
  const headerRow = rows.find((row) => /<th>BUCA<\/th>/i.test(row));

  if (!headerRow) {
    throw new Error("Header tabella buche non trovato.");
  }

  const headerCells = extractCells(headerRow, "th").filter(Boolean);
  const teeColumns = headerCells.slice(1, 7).map((name, index) => ({
    tee_name: name,
    tee_color: TEE_COLOR_MAP[name] || null,
    gender_group: index < 3 ? "men" : "women"
  }));

  const bodyMatch = tableHtml.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  const footerMatch = tableHtml.match(/<tfoot>([\s\S]*?)<\/tfoot>/i);

  const bodyRows = bodyMatch ? extractAllRows(bodyMatch[1]) : [];
  const footerRows = footerMatch ? extractAllRows(footerMatch[1]) : [];

  const holes = bodyRows
    .map((row) => extractCells(row, "td"))
    .filter((cells) => cells.length >= 9)
    .map((cells) => {
      const [holeNumber, ...rest] = cells;
      const teeDistances = {};

      teeColumns.forEach((tee, index) => {
        teeDistances[tee.tee_name] = toNullableInteger(rest[index]);
      });

      return {
        hole_number: toNullableInteger(holeNumber),
        distances: teeDistances,
        par: toNullableInteger(rest[6]),
        hcp: toNullableInteger(rest[7])
      };
    });

  let totals = null;
  if (footerRows.length) {
    const footerCells = extractCells(footerRows[0], "td");
    if (footerCells.length >= 9) {
      const teeDistances = {};
      teeColumns.forEach((tee, index) => {
        teeDistances[tee.tee_name] = toNullableInteger(footerCells[index + 1]);
      });

      totals = {
        label: footerCells[0],
        distances: teeDistances,
        par: toNullableInteger(footerCells[7]),
        hcp: toNullableInteger(footerCells[8])
      };
    }
  }

  return {
    tee_columns: teeColumns,
    holes,
    totals
  };
}

function parseEgaTable(tableHtml, teeColumns) {
  const rows = extractAllRows(tableHtml);
  const allHeaderRows = rows.slice(0, 3);
  const ratingCells = allHeaderRows[1] ? extractCells(allHeaderRows[1], "th") : [];

  const teeRatings = [];
  for (let i = 0; i < teeColumns.length; i += 1) {
    const tee = teeColumns[i];
    const crCell = ratingCells[i * 2] || "";
    const srCell = ratingCells[i * 2 + 1] || "";
    teeRatings.push({
      tee_name: tee.tee_name,
      tee_color: tee.tee_color,
      gender_group: tee.gender_group,
      course_rating: toNullableNumber(crCell.replace(/^CR\s*/i, "")),
      slope_rating: toNullableInteger(srCell.replace(/^SR\s*/i, ""))
    });
  }

  const bodyRows = rows.slice(3).map((row) => extractCells(row, "td")).filter((cells) => cells.length);
  const playingHcpRows = bodyRows.map((cells) => {
    const tees = teeColumns.map((tee, index) => ({
      tee_name: tee.tee_name,
      exact_hcp_range: cells[index * 2] || null,
      playing_hcp: cells[index * 2 + 1] || null
    }));
    return { tees };
  });

  return {
    tee_ratings: teeRatings,
    playing_hcp_rows: playingHcpRows
  };
}

async function fetchClubPage(circoloId, percorsoId = null, pageState = null) {
  const url = `https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=${circoloId}`;
  const headers = {
    "User-Agent": "Stablr GesGolf scraper"
  };

  let response;

  if (!percorsoId || !pageState) {
    response = await fetch(url, { headers });
  } else {
    const form = new URLSearchParams({
      __VIEWSTATE: pageState.viewState,
      __VIEWSTATEGENERATOR: pageState.viewStateGenerator,
      __EVENTVALIDATION: pageState.eventValidation,
      "ctl00$cpCorpo$selPercorso": String(percorsoId)
    });

    response = await fetch(url, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form.toString()
    });
  }

  if (!response.ok) {
    throw new Error(`GesGolf HTTP ${response.status} for circolo ${circoloId}${percorsoId ? ` / percorso ${percorsoId}` : ""}`);
  }

  return response.text();
}

function extractViewState(html) {
  return {
    viewState: extractHiddenValue(html, "__VIEWSTATE"),
    viewStateGenerator: extractHiddenValue(html, "__VIEWSTATEGENERATOR"),
    eventValidation: extractHiddenValue(html, "__EVENTVALIDATION")
  };
}

function detectCourseAnomalies(course) {
  const anomalies = [];
  const zeroParHoles = (course.holes || []).filter((hole) => hole.par === 0).length;
  const zeroHcpHoles = (course.holes || []).filter((hole) => hole.hcp === 0).length;

  if (course.holes_count === 18 && course.total_par != null && course.total_par <= 40) {
    anomalies.push("par_total_anomaly_for_18");
  }
  if (course.holes_count === 18 && zeroParHoles >= 9) {
    anomalies.push("second_half_empty_or_zero");
  }
  if (zeroHcpHoles >= 9) {
    anomalies.push("many_zero_stroke_indexes");
  }

  return anomalies;
}

function parseCoursePage(html, option) {
  const totalPar = extractNumberById(html, "cpCorpo_titPar");
  const holesCount = extractNumberById(html, "cpCorpo_titBuche");
  const holeTable = parseHoleTable(extractFirstTableAfterMarker(html, "BUCHE DEL PERCORSO"));
  const egaTable = parseEgaTable(extractFirstTableAfterMarker(html, "EGA PLAYING HCP"), holeTable.tee_columns);
  const computedPar = holeTable.holes.reduce((sum, hole) => sum + (hole.par || 0), 0);
  const warnings = [];

  if (Number.isInteger(totalPar) && Number.isInteger(computedPar) && computedPar !== totalPar) {
    warnings.push(`Somma par buche (${computedPar}) diversa dal Par dichiarato GesGolf (${totalPar}).`);
  }

  if (Number.isInteger(holesCount) && holeTable.holes.length !== holesCount) {
    warnings.push(`Numero buche estratte (${holeTable.holes.length}) diverso dalle buche dichiarate GesGolf (${holesCount}).`);
  }

  const parsed = {
    percorso_id: option.percorso_id,
    name: option.name,
    holes_count: holesCount,
    total_par: totalPar,
    computed_total_par: computedPar,
    playable_kind: inferPlayableKind(option.name, holesCount),
    holes: holeTable.holes,
    totals: holeTable.totals,
    tee_sets: egaTable.tee_ratings.map((rating) => ({
      ...rating,
      par_total: totalPar,
      total_distance: holeTable.totals?.distances?.[rating.tee_name] ?? null
    })),
    playing_hcp_rows: egaTable.playing_hcp_rows,
    warnings
  };

  const anomalies = detectCourseAnomalies(parsed);
  return {
    ...parsed,
    anomalies,
    status: warnings.length || anomalies.length ? "warning" : "safe"
  };
}

export async function scrapeGesGolfClub({
  circoloId,
  slug = null,
  sourceLabel = "Generic scraper output. No live DB writes.",
  figClub = null,
  persistRaw = true,
  persistNormalized = true
}) {
  const rootHtml = await fetchClubPage(circoloId);
  const clubName = extractClubName(rootHtml);
  const clubSlug = slug || slugify(clubName);
  const pageState = extractViewState(rootHtml);
  const options = extractOptions(rootHtml);

  const rawClubDir = path.join(RAW_DIR, clubSlug);
  const normalizedClubDir = path.join(NORMALIZED_DIR, clubSlug);
  if (persistRaw) {
    await mkdir(rawClubDir, { recursive: true });
    await writeFile(path.join(rawClubDir, `circolo-${circoloId}-default.html`), rootHtml, "utf-8");
  }
  if (persistNormalized) {
    await mkdir(normalizedClubDir, { recursive: true });
  }

  const playableCourses = [];
  const failedCourses = [];

  for (const option of options) {
    try {
      const html = option.selected ? rootHtml : await fetchClubPage(circoloId, option.percorso_id, pageState);
      if (persistRaw) {
        await writeFile(path.join(rawClubDir, `percorso-${option.percorso_id}.html`), html, "utf-8");
      }
      playableCourses.push(parseCoursePage(html, option));
    } catch (error) {
      failedCourses.push({
        percorso_id: option.percorso_id,
        name: option.name,
        error: error instanceof Error ? error.message : String(error),
        status: "error"
      });
    }
  }

  const status = playableCourses.length === 0
    ? "error"
    : failedCourses.length || playableCourses.some((course) => course.status === "warning")
      ? "warning"
      : "safe";

  const payload = {
    schema_version: "1.1",
    source: {
      system: "gesgolf",
      scraped_at: new Date().toISOString(),
      circolo_id: String(circoloId),
      source_url: `https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=${circoloId}`,
      notes: sourceLabel
    },
    club: {
      name: clubName,
      name_normalized: normalizeGesGolfName(clubName),
      source_system: "gesgolf",
      source_external_id: String(circoloId),
      fig_reference: figClub
        ? {
            fig_club_name: figClub.fig_club,
            fig_name_normalized: figClub.fig_name_normalized
          }
        : null
    },
    scrape_status: status,
    playable_courses: playableCourses,
    failed_courses: failedCourses
  };

  let outputPath = null;
  if (persistNormalized) {
    outputPath = path.join(normalizedClubDir, `circolo-${circoloId}.json`);
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  }

  return {
    circolo_id: String(circoloId),
    club: clubName,
    slug: clubSlug,
    scrape_status: status,
    playable_courses: playableCourses.length,
    warning_courses: playableCourses.filter((course) => course.status === "warning").length,
    failed_courses: failedCourses.length,
    output: outputPath ? path.relative(repoRoot, outputPath) : null,
    payload
  };
}
