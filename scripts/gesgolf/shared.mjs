import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeNameForMatch } from "../fig/shared-catalog.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const repoRoot = path.resolve(__dirname, "..", "..");

export const FIG_CATALOG_PATH = path.join(
  repoRoot,
  "data",
  "fig",
  "normalized",
  "fig-catalog-normalized.json"
);
export const REPORTS_DIR = path.join(repoRoot, "data", "gesgolf", "reports");
export const CLUBS_INDEX_URL = "https://www.gesgolf.it/golfonline/clubs/index.aspx";

const STOPWORDS = new Set([
  "golf",
  "club",
  "circolo",
  "asd",
  "ssd",
  "societa",
  "sportiva",
  "dilettantistica",
  "g",
  "c",
  "gc",
  "country",
  "and",
  "dei",
  "degli",
  "delle",
  "spa",
  "srl"
]);

export function getArgValue(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

export function normalizeGesGolfName(value) {
  return normalizeNameForMatch(
    String(value || "")
      .replace(/&#039;/gi, "'")
      .replace(/&#39;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/&amp;/gi, "&")
  );
}

export function scoreClubMatch(figClubName, gesGolfClubName) {
  const input = normalizeGesGolfName(figClubName);
  const candidate = normalizeGesGolfName(gesGolfClubName);

  if (!input || !candidate) return 0;
  if (input === candidate) return 100;
  if (candidate.startsWith(input)) return 96;
  if (candidate.split(" ").some((token) => token.startsWith(input))) return 90;
  if (candidate.startsWith(input) || input.startsWith(candidate)) return 92;
  if (candidate.includes(input) || input.includes(candidate)) return 84;

  const inputTokens = input.split(" ").filter(Boolean);
  const candidateTokens = candidate.split(" ").filter(Boolean);
  const sharedTokens = inputTokens.filter((token) => candidateTokens.includes(token));

  if (!sharedTokens.length) return 0;

  const coverage = sharedTokens.length / Math.max(inputTokens.length, candidateTokens.length);
  return Math.round(coverage * 75);
}

export function buildSearchQueries(clubName) {
  const normalized = normalizeGesGolfName(clubName);
  const tokens = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token && !STOPWORDS.has(token) && token.length > 1);

  const variants = [];

  if (tokens.length) {
    variants.push(tokens.slice(0, 2).join(" "));
    variants.push(tokens[tokens.length - 1]);
    variants.push(tokens[0]);
    variants.push(tokens.join(" "));
  }

  variants.push(normalized);

  return variants.filter((value, index) => value && variants.indexOf(value) === index).slice(0, 4);
}

function extractHiddenValue(html, fieldName) {
  const pattern = new RegExp(`name="${fieldName}" id="${fieldName}" value="([^"]*)"`, "i");
  const match = html.match(pattern);
  if (!match) {
    throw new Error(`Campo hidden non trovato: ${fieldName}`);
  }
  return match[1];
}

export function extractClubSearchResults(html) {
  return [...html.matchAll(/<a href="default\.aspx\?circolo_id=(\d+)">([^<]+)<\/a>/gi)].map((match) => ({
    circolo_id: match[1],
    name: match[2].trim()
  }));
}

export async function fetchClubsIndexPage() {
  const response = await fetch(CLUBS_INDEX_URL, {
    headers: {
      "User-Agent": "Stablr GesGolf coverage checker"
    }
  });

  if (!response.ok) {
    throw new Error(`Index page HTTP ${response.status}`);
  }

  const html = await response.text();
  return {
    viewState: extractHiddenValue(html, "__VIEWSTATE"),
    viewStateGenerator: extractHiddenValue(html, "__VIEWSTATEGENERATOR"),
    eventValidation: extractHiddenValue(html, "__EVENTVALIDATION")
  };
}

export async function searchGesGolfClub(term, pageState) {
  const form = new URLSearchParams({
    __VIEWSTATE: pageState.viewState,
    __VIEWSTATEGENERATOR: pageState.viewStateGenerator,
    __EVENTVALIDATION: pageState.eventValidation,
    "ctl00$cpCorpo$txtCircolo": term,
    "ctl00$cpCorpo$selRegione": "-1",
    "ctl00$cpCorpo$btnRicerca": "Ricerca"
  });

  const response = await fetch(CLUBS_INDEX_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Stablr GesGolf coverage checker"
    },
    body: form.toString()
  });

  if (!response.ok) {
    throw new Error(`Search HTTP ${response.status} for term "${term}"`);
  }

  const html = await response.text();
  return extractClubSearchResults(html);
}

export async function loadFigClubs() {
  const raw = await readFile(FIG_CATALOG_PATH, "utf-8");
  const payload = JSON.parse(raw);
  const clubs = Array.isArray(payload) ? payload : payload.clubs;

  if (!Array.isArray(clubs)) {
    throw new Error("Catalogo FIG non valido: clubs mancante.");
  }

  return clubs
    .map((club) => ({
      name: club.name,
      name_normalized: club.name_normalized
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "it"));
}

export function rankCandidates(figClubName, candidates, query) {
  return candidates
    .map((candidate) => ({
      circolo_id: candidate.circolo_id,
      name: candidate.name,
      score: scoreClubMatch(figClubName, candidate.name),
      query
    }))
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "it"));
}

export function toCsvValue(value) {
  const normalized = String(value ?? "");
  if (!/[",\n]/.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, '""')}"`;
}

export function buildCsv(rows) {
  if (!rows.length) return "";
  const header = Object.keys(rows[0]);
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(header.map((key) => toCsvValue(row[key])).join(","));
  }
  return `${lines.join("\n")}\n`;
}
