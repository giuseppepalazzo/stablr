import { FIG_IFRAME_SOURCE_URL, FIG_SOURCE_URL, stripHtml, writeJsonFile } from "./shared-catalog.mjs";

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function extractTables(html) {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((match) => match[0]);
}

function extractRows(tableHtml) {
  return [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
}

function extractCells(rowHtml) {
  return [...rowHtml.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((match) => stripHtml(match[1]));
}

async function fetchHtmlFromUrl(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Stablr FIG catalog importer)"
    }
  });

  if (!response.ok) {
    throw new Error(`Fetch FIG fallito: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function main() {
  const outputPath =
    getArgValue("--out") || "data/fig/raw/fig-slope-course-rating-raw.json";
  const sourceUrl = getArgValue("--url") || FIG_IFRAME_SOURCE_URL;

  const html = await fetchHtmlFromUrl(sourceUrl);
  const tables = extractTables(html);
  const tablePayloads = tables.map((tableHtml, tableIndex) => {
    const rows = extractRows(tableHtml).map((rowHtml, rowIndex) => ({
      row_index: rowIndex,
      cells: extractCells(rowHtml)
    }));

    return {
      table_index: tableIndex,
      row_count: rows.length,
      rows
    };
  });

  const payload = {
    schema_version: "1.0",
    source_system: "fig",
    source_page_url: FIG_SOURCE_URL,
    source_url: sourceUrl,
    scraped_at: new Date().toISOString(),
    html_length: html.length,
    table_count: tablePayloads.length,
    tables: tablePayloads
  };

  const savedPath = await writeJsonFile(outputPath, payload);
  console.log(`Raw FIG salvato in ${savedPath}`);
  console.log(`Tabelle trovate: ${tablePayloads.length}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
